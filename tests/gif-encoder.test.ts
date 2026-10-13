import { describe, expect, it } from 'vitest';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { GifEncoder, GifSizeError } from '../src/export/gif-encoder';
import { inspectGIF } from '../src/image/gif';

type Color = readonly [number, number, number, number];
const red: Color = [255, 0, 0, 255];
const green: Color = [0, 255, 0, 255];
const blue: Color = [0, 0, 255, 255];
const budget = 2 * 1024 * 1024;

function raster(width: number, height: number, pixel: (x: number, y: number) => Color): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(pixel(x, y), (y * width + x) * 4);
  return rgba;
}

function decode(bytes: Uint8Array<ArrayBuffer>) {
  const parsed = parseGIF(bytes.buffer);
  // The independent bounded importer verifies every LZW code and exact decoded
  // pixel count, whereas a permissive decoder alone can hide truncation.
  inspectGIF(bytes);
  return { parsed, frames: decompressFrames(parsed, true) };
}

function randomIndices(length: number, size: number): Uint8Array {
  const indices = new Uint8Array(length);
  let seed = 0x5f3759df;
  for (let index = 0; index < length; index++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    indices[index] = (seed >>> 0) % size;
  }
  return indices;
}

describe('incremental GIF89a encoding', () => {
  it('round-trips opaque complete frames, exact colors, delays and an infinite loop', () => {
    const encoder = new GifEncoder({ width: 5, height: 3, maxBytes: budget });
    const first = raster(5, 3, x => x < 2 ? red : blue);
    const second = raster(5, 3, () => green);
    encoder.addFrame(first, 7);
    encoder.addFrame(second, 20);
    const bytes = encoder.finish();
    const { parsed, frames } = decode(bytes);
    expect(parsed.header).toEqual({ signature: 'GIF', version: '89a' });
    expect(parsed.lsd).toMatchObject({ width: 5, height: 3 });
    expect(Array.from(bytes.slice(-1))).toEqual([0x3b]);
    const loop = parsed.frames.find(frame => 'application' in frame);
    expect(loop).toBeDefined();
    if (!loop || !('application' in loop)) throw new Error('Missing loop extension.');
    expect(loop.application.id).toBe('NETSCAPE2.0');
    expect(Array.from(loop.application.blocks)).toEqual([1, 0, 0]);
    expect(frames.map(frame => frame.delay)).toEqual([70, 200]);
    expect(frames.map(frame => frame.dims)).toEqual([
      { width: 5, height: 3, left: 0, top: 0 }, { width: 5, height: 3, left: 0, top: 0 },
    ]);
    expect(frames.every(frame => frame.disposalType === 1 && frame.transparentIndex === undefined)).toBe(true);
    expect(frames[0]!.patch).toEqual(first);
    expect(frames[1]!.patch).toEqual(second);
  });

  it('consumes frame buffers immediately so callers can reuse and mutate the raster', () => {
    const encoder = new GifEncoder({ width: 2, height: 2, maxBytes: budget });
    const reused = raster(2, 2, () => red);
    encoder.addFrame(reused, 10);
    reused.set(raster(2, 2, () => green));
    encoder.addFrame(reused, 10);
    reused.fill(0);
    const { frames } = decode(encoder.finish());
    expect(frames[0]!.patch).toEqual(raster(2, 2, () => red));
    expect(frames[1]!.patch).toEqual(raster(2, 2, () => green));
  });

  it('preserves distinct flat colors that occupy the same coarse quantization bin', () => {
    const colors: Color[] = [[250, 251, 252, 255], [251, 252, 253, 255], [252, 253, 254, 255], [253, 254, 255, 255]];
    const input = raster(16, 1, x => colors[x % colors.length]!);
    const encoder = new GifEncoder({ width: 16, height: 1, maxBytes: budget });
    encoder.addFrame(input, 10);
    expect(decode(encoder.finish()).frames[0]!.patch).toEqual(input);
  });

  it.each([2, 16, 128, 256])('decodes dictionary growth, 12-bit boundaries and resets for %i colors', size => {
    const width = 256, height = 256;
    const indices = randomIndices(width * height, size);
    const input = raster(width, height, (x, y) => {
      const value = indices[y * width + x]!;
      return [value, value, value, 255];
    });
    const encoder = new GifEncoder({ width, height, maxBytes: budget });
    encoder.addFrame(input, 4);
    const bytes = encoder.finish();
    expect(decode(bytes).frames[0]!.patch).toEqual(input);
    // Noise exercises multiple image sub-blocks instead of a single tiny stream.
    expect(bytes.length).toBeGreaterThan(255);
  });

  it('handles the LZW previous-string-plus-first-byte case and long repeated runs', () => {
    const input = raster(128, 64, (x, y) => y < 32 ? red : x % 2 ? blue : red);
    const encoder = new GifEncoder({ width: 128, height: 64, maxBytes: budget });
    encoder.addFrame(input, 10);
    const bytes = encoder.finish();
    expect(decode(bytes).frames[0]!.patch).toEqual(input);
    expect(bytes.length).toBeLessThan(input.length / 20);
  });

  it.each([128, 256] as const)('bounds the %i-color photographic palette while preserving bright typography', paletteSize => {
    const width = 128, height = 128;
    const input = raster(width, height, (x, y) => x >= 40 && x < 88 && y >= 40 && y < 88
      ? [255, 255, 255, 255] : [x * 2, y * 2, (x + y) & 255, 255]);
    const encoder = new GifEncoder({ width, height, maxBytes: budget, paletteSize });
    encoder.addFrame(input, 10);
    const { frames } = decode(encoder.finish());
    const frame = frames[0]!;
    expect(frame.colorTable.length).toBeLessThanOrEqual(paletteSize);
    let totalError = 0;
    for (let offset = 0; offset < input.length; offset += 4) {
      expect(frame.patch[offset + 3]).toBe(255);
      for (let channel = 0; channel < 3; channel++) totalError += Math.abs(input[offset + channel]! - frame.patch[offset + channel]!);
    }
    expect(totalError / (width * height * 3)).toBeLessThan(12);
    const textOffset = (64 * width + 64) * 4;
    expect(Array.from(frame.patch.slice(textOffset, textOffset + 4))).toEqual([255, 255, 255, 255]);
  });

  it('composites partial transparency onto the requested opaque matte', () => {
    const encoder = new GifEncoder({ width: 3, height: 1, maxBytes: budget, matte: [255, 255, 255] });
    encoder.addFrame(Uint8ClampedArray.from([255, 0, 0, 128, 30, 50, 70, 0, 0, 0, 255, 255]), 10);
    expect(Array.from(decode(encoder.finish()).frames[0]!.patch)).toEqual([255, 127, 127, 255, 255, 255, 255, 255, 0, 0, 255, 255]);
  });

  it('enforces the byte budget including the final trailer and invalidates a failed encoder', () => {
    const frame = raster(16, 16, () => red);
    const encode = (maxBytes: number) => {
      const encoder = new GifEncoder({ width: 16, height: 16, maxBytes });
      encoder.addFrame(frame, 10);
      return encoder;
    };
    const expected = encode(budget).finish();
    expect(encode(expected.length).finish()).toEqual(expected);
    const missingTrailerBudget = encode(expected.length - 1);
    expect(() => missingTrailerBudget.finish()).toThrow(GifSizeError);
    expect(() => missingTrailerBudget.addFrame(frame, 10)).toThrow('no longer writable');
    const tooSmall = new GifEncoder({ width: 16, height: 16, maxBytes: 40 });
    expect(() => tooSmall.addFrame(frame, 10)).toThrow(GifSizeError);
    expect(() => tooSmall.finish()).toThrow('no longer writable');
    expect(() => new GifEncoder({ width: 1, height: 1, maxBytes: 31 })).toThrow(GifSizeError);
  });

  it('rejects invalid dimensions, delay and frame inputs before encoding', () => {
    for (const [width, height] of [[0, 1], [1.5, 1], [65536, 1], [4096, 4096]]) {
      expect(() => new GifEncoder({ width, height, maxBytes: budget })).toThrow(RangeError);
    }
    expect(() => new GifEncoder({ width: 1, height: 1, maxBytes: 0 })).toThrow(RangeError);
    const encoder = new GifEncoder({ width: 1, height: 1, maxBytes: budget });
    expect(() => encoder.finish()).toThrow('at least one frame');
    expect(() => encoder.addFrame(new Uint8ClampedArray(8), 10)).toThrow(RangeError);
    for (const delay of [0, 1.5, NaN, 65536]) expect(() => encoder.addFrame(new Uint8ClampedArray(4), delay)).toThrow(RangeError);
    // A bad caller input does not poison a still-usable encoder.
    encoder.addFrame(Uint8ClampedArray.from(red), 10);
    expect(decode(encoder.finish()).frames).toHaveLength(1);
    expect(() => encoder.finish()).toThrow('no longer writable');
  });
});
