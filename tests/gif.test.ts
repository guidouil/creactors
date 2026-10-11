import { describe, expect, it } from 'vitest';
import { parseGIF, decompressFrame } from 'gifuct-js';
import { GIF_IMPORT_LIMITS, GifCompositor, importGIF, inspectGIF } from '../src/image/gif';

type Color = readonly [number, number, number, number];
const red: Color = [255, 0, 0, 255];
const green: Color = [0, 255, 0, 255];
const blue: Color = [0, 0, 255, 255];
const transparent: Color = [0, 0, 0, 0];

interface FrameFixture {
  width?: number; height?: number; left?: number; top?: number;
  delay?: number; disposal?: number; transparentIndex?: number;
  pixels?: readonly number[];
  codes?: readonly (readonly [number, number])[];
  palette?: readonly (readonly [number, number, number])[];
  interlaced?: boolean;
  comments?: number;
}

function packedCodes(codes: readonly (readonly [number, number])[]): number[] {
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const [code, size] of codes) {
    buffer |= code << bits;
    bits += size;
    while (bits >= 8) { bytes.push(buffer & 255); buffer >>>= 8; bits -= 8; }
  }
  if (bits) bytes.push(buffer & 255);
  return bytes;
}

/** Tiny authored GIFs; no fixture/encoder dependency or remote downloads. */
function gif(frames: readonly FrameFixture[], width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const bytes = [...new TextEncoder().encode('GIF89a')];
  const word = (value: number) => bytes.push(value & 255, value >> 8);
  word(width); word(height);
  bytes.push(0x80, 0, 0, 0, 0, 0, 255, 0, 0); // Global black/red palette.
  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 4, (frame.disposal ?? 1) << 2 | (frame.transparentIndex === undefined ? 0 : 1));
    word(frame.delay ?? 10);
    bytes.push(frame.transparentIndex ?? 0, 0);
    for (let index = 0; index < (frame.comments ?? 0); index++) bytes.push(0x21, 0xfe, 1, 65, 0);
    bytes.push(0x2c);
    word(frame.left ?? 0); word(frame.top ?? 0);
    word(frame.width ?? 1); word(frame.height ?? 1);
    bytes.push((frame.interlaced ? 0x40 : 0) | (frame.palette ? 0x80 | (Math.log2(frame.palette.length) - 1) : 0));
    if (frame.palette) bytes.push(...frame.palette.flat());
    bytes.push(2);
    const codes = frame.codes ?? [...(frame.pixels ?? [1]).flatMap(pixel => [[4, 3], [pixel, 3]] as const), [5, 3] as const];
    const data = packedCodes(codes);
    for (let start = 0; start < data.length; start += 255) {
      const chunk = data.slice(start, start + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

function decode(bytes: Uint8Array<ArrayBuffer>) {
  const parsed = parseGIF(bytes.buffer);
  const frame = parsed.frames.find((item): item is Parameters<typeof decompressFrame>[0] => 'image' in item)!;
  return decompressFrame(frame, parsed.gct, true);
}

function patch(colors: readonly Color[], left = 0, disposalType = 1) {
  return { dims: { left, top: 0, width: colors.length, height: 1 }, patch: Uint8ClampedArray.from(colors.flat()), disposalType };
}

describe('bounded local GIF import', () => {
  it('validates real dictionary growth, references and a LZW code-size increase', () => {
    const bytes = gif([{ width: 7, codes: [[4, 3], [0, 3], [1, 3], [6, 3], [8, 4], [5, 4]] }], 7);
    expect(inspectGIF(bytes).frames).toHaveLength(1);
    expect(decode(bytes).pixels).toEqual([0, 1, 0, 1, 0, 1, 0]);
  });

  it('accepts interlaced GIFs with local palettes and the original raster aspect', () => {
    const bytes = gif([{ width: 2, height: 4, interlaced: true,
      palette: [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]],
      pixels: [0, 0, 2, 2, 1, 1, 3, 3] }], 2, 4);
    const metadata = inspectGIF(bytes);
    expect([metadata.width, metadata.height, metadata.outputWidth, metadata.outputHeight]).toEqual([2, 4, 2, 4]);
    const decoded = decode(bytes);
    expect(decoded.pixels).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(Array.from(decoded.patch.slice(16, 24))).toEqual([...green, ...green]);
  });

  it('normalizes absent/zero/one-centisecond delays to 100 milliseconds', () => {
    const metadata = inspectGIF(gif([{ delay: 0 }, { delay: 1 }, { delay: 2 }]));
    expect(metadata.frames.map(frame => frame.delay)).toEqual([10, 10, 2]);
    expect(metadata.duration).toBe(0.22);
  });

  it('keeps graphic controls scoped across multiple intervening comments', () => {
    const metadata = inspectGIF(gif([{ delay: 7, disposal: 3, transparentIndex: 0, comments: 2 }]));
    expect(metadata.frames[0]).toMatchObject({ delay: 7, disposal: 3, transparentIndex: 0 });
    expect(metadata.background).toEqual(transparent);
  });

  it('reduces output resolution to respect both the edge and total decoded-frame budgets', () => {
    const metadata = inspectGIF(gif(Array.from({ length: 300 }, () => ({})), 512, 512));
    expect(metadata.outputWidth).toBeLessThan(512);
    expect(metadata.outputWidth).toBe(metadata.outputHeight);
    expect(metadata.outputWidth * metadata.outputHeight * 4 * metadata.frames.length).toBeLessThanOrEqual(GIF_IMPORT_LIMITS.decodedFrameBytes);
    expect(inspectGIF(gif([{}], 4096, 1)).outputWidth).toBe(1024);
  });

  it('rejects duration, frame count and cumulative source work before pixel decompression', async () => {
    const excessive = [
      gif([{ delay: 3001 }]),
      gif(Array.from({ length: 301 }, () => ({ delay: 2 }))),
      // Deliberately undersized LZW payload: complexity must be rejected first,
      // without letting the declared 4MP patches allocate any decoded pixels.
      gif(Array.from({ length: 17 }, () => ({ width: 2048, height: 2048 })), 2048, 2048),
    ];
    for (const bytes of excessive) {
      await expect(importGIF(bytes.buffer, 'large.gif')).rejects.toMatchObject({ kind: 'animation' });
    }
    await expect(importGIF(gif([{}], 4097, 1).buffer, 'wide.gif')).rejects.toMatchObject({ kind: 'dimensions' });
  });

  it('bounds full-canvas composition even when every patch contains only one pixel', async () => {
    // Patch work is just 300 pixels, but uploads/resampling would touch 1.2B.
    const bytes = gif(Array.from({ length: 300 }, () => ({})), 4096, 1024);
    await expect(importGIF(bytes.buffer, 'large-canvas.gif')).rejects.toMatchObject({ kind: 'animation' });
    // The exact 128MP boundary remains valid, without allocating source pixels.
    const atLimit = inspectGIF(gif(Array.from({ length: 32 }, () => ({})), 4096, 1024));
    expect(atLimit.width * atLimit.height * atLimit.frames.length).toBe(GIF_IMPORT_LIMITS.canvasWorkPixels);
    expect(() => inspectGIF(gif(Array.from({ length: 33 }, () => ({})), 4096, 1024))).toThrow('animation');
  });

  it('rejects truncated blocks, illegal LZW references and missing end codes', () => {
    const bytes = gif([{}]);
    expect(() => inspectGIF(bytes.slice(0, -1))).toThrow('decode');
    expect(() => inspectGIF(gif([{ codes: [[4, 3], [7, 3], [5, 3]] }]))).toThrow('decode');
    expect(() => inspectGIF(gif([{ codes: [[4, 3], [1, 3]] }]))).toThrow('decode');
    expect(() => inspectGIF(gif([{ codes: [[4, 3], [5, 3]] }]))).toThrow('decode');
  });

  it('rejects out-of-bounds patches and unsupported extensions before invoking the parser', async () => {
    await expect(importGIF(gif([{ width: 2 }]).buffer, 'broken.gif')).rejects.toMatchObject({ kind: 'dimensions' });
    const valid = gif([{}]);
    const unknownExtension = Uint8Array.from([...valid.slice(0, 19), 0x21, 0x02, 0, ...valid.slice(19)]);
    await expect(importGIF(unknownExtension.buffer, 'broken.gif')).rejects.toMatchObject({ kind: 'decode' });
  });
});

describe('GIF compositing', () => {
  it('overlays partial transparent patches while preserving earlier pixels', () => {
    const compositor = new GifCompositor(3, 1, transparent);
    compositor.push(patch([red, red, red]));
    expect(Array.from(compositor.push(patch([transparent, green], 1)))).toEqual([...red, ...red, ...green]);
  });

  it('restores just the departing rectangle to the logical background for disposal 2', () => {
    const compositor = new GifCompositor(3, 1, blue);
    compositor.push(patch([red], 1, 2));
    expect(Array.from(compositor.push(patch([transparent])))).toEqual([...blue, ...blue, ...blue]);
    const alphaCompositor = new GifCompositor(2, 1, transparent);
    alphaCompositor.push(patch([red], 0, 2));
    expect(Array.from(alphaCompositor.push(patch([green], 1)))).toEqual([...transparent, ...green]);
  });

  it('restores the complete preceding image for disposal 3', () => {
    const compositor = new GifCompositor(3, 1, transparent);
    compositor.push(patch([red, red, red]));
    compositor.push(patch([green], 1, 3));
    expect(Array.from(compositor.push(patch([blue])))).toEqual([...blue, ...red, ...red]);
  });
});
