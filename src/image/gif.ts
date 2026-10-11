import { parseGIF, decompressFrame } from 'gifuct-js';
import { ImageImportError, MAX_IMAGE_FILE_BYTES, type ImageAsset } from './types';

export const GIF_IMPORT_LIMITS = Object.freeze({
  frames: 300,
  duration: 30,
  outputEdge: 1024,
  decodedFrameBytes: 32 * 1024 * 1024,
  sourceEdge: 4096,
  sourcePixels: 4 * 1024 * 1024,
  sourceWorkPixels: 64 * 1024 * 1024,
  canvasWorkPixels: 128 * 1024 * 1024,
  blocks: 4096,
});

type RGBA = readonly [number, number, number, number];
interface Dimensions { left: number; top: number; width: number; height: number }
interface GifFrameMetadata extends Dimensions {
  delay: number;
  disposal: number;
  transparentIndex?: number;
  paletteSize: number;
  minCodeSize: number;
  dataStart: number;
  dataEnd: number;
}
export interface GifMetadata {
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  duration: number;
  background: RGBA;
  frames: readonly GifFrameMetadata[];
}

/** Verify the LZW stream using only a bounded 4096-entry length dictionary. */
function validateLzw(bytes: Uint8Array, frame: GifFrameMetadata): void {
  let position = frame.dataStart;
  let remaining = 0;
  let bits = 0;
  let buffer = 0;
  const byte = (): number | undefined => {
    if (remaining === 0) {
      if (position >= frame.dataEnd) return undefined;
      remaining = bytes[position++]!;
      if (remaining === 0) return undefined;
    }
    remaining--;
    return bytes[position++]!;
  };
  const read = (size: number): number | undefined => {
    while (bits < size) {
      const value = byte();
      if (value === undefined) return undefined;
      buffer |= value << bits;
      bits += 8;
    }
    const value = buffer & ((1 << size) - 1);
    buffer >>>= size;
    bits -= size;
    return value;
  };
  const clear = 1 << frame.minCodeSize;
  const end = clear + 1;
  const lengths = new Uint16Array(4096);
  lengths.fill(1, 0, clear);
  let available = clear + 2;
  let codeSize = frame.minCodeSize + 1;
  let previous = -1;
  let pixels = 0;
  for (;;) {
    const code = read(codeSize);
    if (code === undefined) throw new ImageImportError('decode');
    if (code === clear) {
      available = clear + 2;
      codeSize = frame.minCodeSize + 1;
      previous = -1;
      continue;
    }
    if (code === end) {
      if (pixels !== frame.width * frame.height) throw new ImageImportError('decode');
      return;
    }
    if (code > available || (previous === -1 && code >= clear)
      || (code < clear && code >= frame.paletteSize)) throw new ImageImportError('decode');
    const length = code === available ? lengths[previous]! + 1 : lengths[code]!;
    if (!length) throw new ImageImportError('decode');
    pixels += length;
    if (pixels > frame.width * frame.height) throw new ImageImportError('decode');
    if (previous !== -1 && available < 4096) {
      lengths[available++] = lengths[previous]! + 1;
      if (available === 1 << codeSize && codeSize < 12) codeSize++;
    }
    previous = code;
  }
}

/** Inspect every block and all resource limits before any pixel allocation. */
export function inspectGIF(bytes: Uint8Array): GifMetadata {
  if (bytes.byteLength > MAX_IMAGE_FILE_BYTES) throw new ImageImportError('size');
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (!['GIF87a', 'GIF89a'].includes(signature) || bytes.length < 13) throw new ImageImportError('decode');
  let cursor = 6;
  const read = (): number => {
    if (cursor >= bytes.length) throw new ImageImportError('decode');
    return bytes[cursor++]!;
  };
  const word = () => read() | read() << 8;
  const skip = (size: number) => {
    if (cursor + size > bytes.length) throw new ImageImportError('decode');
    cursor += size;
  };
  const subBlocks = () => {
    let count = 0;
    for (;;) {
      const size = read();
      if (!size) return count;
      skip(size);
      count += size;
    }
  };
  const width = word();
  const height = word();
  if (!width || !height || width > GIF_IMPORT_LIMITS.sourceEdge || height > GIF_IMPORT_LIMITS.sourceEdge
    || width * height > GIF_IMPORT_LIMITS.sourcePixels) throw new ImageImportError('dimensions');
  const packed = read();
  const backgroundIndex = read();
  read(); // Pixel aspect ratio does not change the stored raster dimensions.
  const globalPaletteSize = packed & 0x80 ? 1 << ((packed & 7) + 1) : 0;
  if (globalPaletteSize && backgroundIndex >= globalPaletteSize) throw new ImageImportError('decode');
  const paletteStart = cursor;
  skip(globalPaletteSize * 3);
  const background: RGBA = globalPaletteSize && backgroundIndex < globalPaletteSize
    ? [bytes[paletteStart + backgroundIndex * 3]!, bytes[paletteStart + backgroundIndex * 3 + 1]!, bytes[paletteStart + backgroundIndex * 3 + 2]!, 255]
    : [0, 0, 0, 0];
  const frames: GifFrameMetadata[] = [];
  let delay = 0;
  let disposal = 0;
  let transparentIndex: number | undefined;
  let durationCentiseconds = 0;
  let sourceWork = 0;
  let blocks = 0;
  for (;;) {
    if (++blocks > GIF_IMPORT_LIMITS.blocks) throw new ImageImportError('animation');
    const block = read();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = read();
      if (label === 0xf9) {
        if (read() !== 4) throw new ImageImportError('decode');
        const controls = read();
        disposal = controls >> 2 & 7;
        if (disposal > 3) throw new ImageImportError('decode');
        delay = word();
        const index = read();
        transparentIndex = controls & 1 ? index : undefined;
        if (read() !== 0) throw new ImageImportError('decode');
      } else if (label === 0xff) {
        if (read() !== 11) throw new ImageImportError('decode');
        skip(11);
        subBlocks();
      } else if (label === 0xfe) subBlocks();
      // Unknown extensions can stall gifuct's parser; plain-text graphics also
      // cannot be reproduced as image patches. Reject both before parsing.
      else throw new ImageImportError('decode');
      continue;
    }
    if (block !== 0x2c) throw new ImageImportError('decode');
    const left = word();
    const top = word();
    const frameWidth = word();
    const frameHeight = word();
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) {
      throw new ImageImportError('dimensions');
    }
    const flags = read();
    const localPaletteSize = flags & 0x80 ? 1 << ((flags & 7) + 1) : 0;
    const paletteSize = localPaletteSize || globalPaletteSize;
    if (!paletteSize || (transparentIndex !== undefined && transparentIndex >= paletteSize)) throw new ImageImportError('decode');
    skip(localPaletteSize * 3);
    const minCodeSize = read();
    if (minCodeSize < 2 || minCodeSize > 8) throw new ImageImportError('decode');
    const dataStart = cursor;
    if (!subBlocks()) throw new ImageImportError('decode');
    const normalizedDelay = delay <= 1 ? 10 : delay;
    durationCentiseconds += normalizedDelay;
    sourceWork += frameWidth * frameHeight;
    // Even tiny patches require a full-canvas upload, resampling and possible
    // disposal-3 snapshot. Bound that work separately from LZW patch pixels.
    if (frames.length >= GIF_IMPORT_LIMITS.frames || durationCentiseconds > GIF_IMPORT_LIMITS.duration * 100
      || sourceWork > GIF_IMPORT_LIMITS.sourceWorkPixels
      || width * height * (frames.length + 1) > GIF_IMPORT_LIMITS.canvasWorkPixels) throw new ImageImportError('animation');
    frames.push({ left, top, width: frameWidth, height: frameHeight, delay: normalizedDelay, disposal,
      transparentIndex, paletteSize, minCodeSize, dataStart, dataEnd: cursor });
    delay = 0;
    disposal = 0;
    transparentIndex = undefined;
  }
  if (!frames.length) throw new ImageImportError('decode');
  for (const frame of frames) validateLzw(bytes, frame);
  const factor = Math.min(1, GIF_IMPORT_LIMITS.outputEdge / Math.max(width, height),
    Math.sqrt(GIF_IMPORT_LIMITS.decodedFrameBytes / (width * height * 4 * frames.length)));
  return {
    width, height, outputWidth: Math.max(1, Math.floor(width * factor)), outputHeight: Math.max(1, Math.floor(height * factor)),
    duration: durationCentiseconds / 100,
    // Transparent GIFs retain an alpha background instead of an opaque matte.
    background: frames[0]!.transparentIndex === undefined ? background : [0, 0, 0, 0], frames,
  };
}

interface CompositedFrame { dims: Dimensions; patch: Uint8ClampedArray; disposalType: number }

/** GIF transparency overlays existing pixels; disposal happens before the next patch. */
export class GifCompositor {
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private previous?: { dims: Dimensions; disposal: number; snapshot?: Uint8ClampedArray };

  constructor(readonly width: number, readonly height: number, private readonly background: RGBA) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.fill({ left: 0, top: 0, width, height });
  }

  private fill(dims: Dimensions): void {
    for (let y = dims.top; y < dims.top + dims.height; y++) for (let x = dims.left; x < dims.left + dims.width; x++) {
      const offset = (y * this.width + x) * 4;
      this.pixels.set(this.background, offset);
    }
  }

  push(frame: CompositedFrame): Uint8ClampedArray<ArrayBuffer> {
    if (this.previous?.disposal === 2) this.fill(this.previous.dims);
    else if (this.previous?.disposal === 3 && this.previous.snapshot) this.pixels.set(this.previous.snapshot);
    const snapshot = frame.disposalType === 3 ? this.pixels.slice() : undefined;
    const { dims, patch } = frame;
    for (let y = 0; y < dims.height; y++) for (let x = 0; x < dims.width; x++) {
      const source = (y * dims.width + x) * 4;
      if (!patch[source + 3]) continue;
      const target = ((y + dims.top) * this.width + x + dims.left) * 4;
      this.pixels[target] = patch[source]!;
      this.pixels[target + 1] = patch[source + 1]!;
      this.pixels[target + 2] = patch[source + 2]!;
      this.pixels[target + 3] = patch[source + 3]!;
    }
    this.previous = { dims, disposal: frame.disposalType, snapshot };
    return this.pixels;
  }
}

/** Decode and composite sequentially, retaining bounded complete PNG frames. */
export async function importGIF(buffer: ArrayBuffer, name: string): Promise<ImageAsset> {
  let sourceCanvas: HTMLCanvasElement | undefined;
  let outputCanvas: HTMLCanvasElement | undefined;
  try {
    const metadata = inspectGIF(new Uint8Array(buffer));
    const parsed = parseGIF(buffer);
    const compressedFrames = parsed.frames.filter((frame): frame is Parameters<typeof decompressFrame>[0] => 'image' in frame);
    if (compressedFrames.length !== metadata.frames.length) throw new ImageImportError('decode');
    sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = metadata.width;
    sourceCanvas.height = metadata.height;
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = metadata.outputWidth;
    outputCanvas.height = metadata.outputHeight;
    const sourceContext = sourceCanvas.getContext('2d');
    const outputContext = outputCanvas.getContext('2d');
    if (!sourceContext || !outputContext) throw new ImageImportError('decode');
    outputContext.imageSmoothingQuality = 'high';
    const compositor = new GifCompositor(metadata.width, metadata.height, metadata.background);
    const imageData = new ImageData(compositor.pixels, metadata.width, metadata.height);
    const frames: { source: string; end: number }[] = [];
    let endCentiseconds = 0;
    for (let index = 0; index < compressedFrames.length; index++) {
      const controls = metadata.frames[index]!;
      const compressed = compressedFrames[index]!;
      // Keep GCE scope across intervening comments/application extensions even
      // when gifuct's parsed frame structure puts them in separate objects.
      compressed.gce = {
        byteSize: 4, codes: [0x21, 0xf9], delay: controls.delay, terminator: 0,
        transparentColorIndex: controls.transparentIndex ?? 0,
        extras: { future: 0, userInput: false, transparentColorGiven: controls.transparentIndex !== undefined, disposal: controls.disposal },
      };
      const frame = decompressFrame(compressed, parsed.gct, true);
      compositor.push(frame);
      sourceContext.putImageData(imageData, 0, 0);
      outputContext.clearRect(0, 0, metadata.outputWidth, metadata.outputHeight);
      outputContext.drawImage(sourceCanvas, 0, 0, metadata.outputWidth, metadata.outputHeight);
      const source = outputCanvas.toDataURL('image/png');
      if (!source.startsWith('data:image/png;base64,')) throw new ImageImportError('decode');
      endCentiseconds += controls.delay;
      frames.push({ source, end: endCentiseconds / 100 });
      // Give the browser a chance to paint its import state and release the
      // preceding frame's LZW/patch arrays before decoding another frame.
      if ((index + 1) % 8 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return { source: frames[0]!.source, width: metadata.outputWidth, height: metadata.outputHeight, name,
      ...(frames.length > 1 ? { animation: { duration: metadata.duration, frames } } : {}) };
  } catch (error) {
    if (error instanceof ImageImportError) throw error;
    throw new ImageImportError('decode');
  } finally {
    if (sourceCanvas) sourceCanvas.width = sourceCanvas.height = 0;
    if (outputCanvas) outputCanvas.width = outputCanvas.height = 0;
  }
}
