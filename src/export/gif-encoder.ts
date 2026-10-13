/** The compressed GIF would exceed the caller's file-size budget. */
export class GifSizeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`GIF output exceeds ${maxBytes} bytes.`);
    this.name = 'GifSizeError';
  }
}

export interface GifEncoderOptions {
  width: number;
  height: number;
  /** Hard cap, including headers, palettes and the trailer. */
  maxBytes: number;
  paletteSize?: 128 | 256;
  /** GIF frames are opaque. Partial alpha is composited against this matte. */
  matte?: readonly [number, number, number];
}

const MAX_FRAME_PIXELS = 4 * 1024 * 1024;
const CHUNK_BYTES = 16 * 1024;

/** Chunked output avoids a growing JavaScript number array or retained frames. */
class GifBytes {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private current?: Uint8Array<ArrayBuffer>;
  private position = 0;
  length = 0;

  constructor(private readonly maxBytes: number) {}

  byte(value: number): void {
    if (this.length >= this.maxBytes) throw new GifSizeError(this.maxBytes);
    if (!this.current || this.position === this.current.length) {
      this.current = new Uint8Array(Math.min(CHUNK_BYTES, this.maxBytes - this.length));
      this.chunks.push(this.current);
      this.position = 0;
    }
    this.current[this.position++] = value;
    this.length++;
  }

  word(value: number): void { this.byte(value & 255); this.byte(value >>> 8); }
  ascii(value: string): void { for (let index = 0; index < value.length; index++) this.byte(value.charCodeAt(index)); }

  finish(): Uint8Array<ArrayBuffer> {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      const used = Math.min(chunk.length, this.length - offset);
      result.set(chunk.subarray(0, used), offset);
      offset += used;
    }
    this.chunks.length = 0;
    this.current = undefined;
    return result;
  }
}

interface QuantizedFrame {
  pixels: Uint8Array;
  palette: Uint8Array;
  tableBits: number;
}

interface ColorBox {
  start: number;
  end: number;
  population: number;
  axis: 0 | 1 | 2;
  score: number;
}

function opaqueColor(rgba: Uint8ClampedArray, offset: number, matte: readonly [number, number, number]): number {
  const alpha = rgba[offset + 3]!;
  if (alpha === 255) return rgba[offset]! << 16 | rgba[offset + 1]! << 8 | rgba[offset + 2]!;
  const inverse = 255 - alpha;
  const red = Math.round((rgba[offset]! * alpha + matte[0] * inverse) / 255);
  const green = Math.round((rgba[offset + 1]! * alpha + matte[1] * inverse) / 255);
  const blue = Math.round((rgba[offset + 2]! * alpha + matte[2] * inverse) / 255);
  return red << 16 | green << 8 | blue;
}

function colorBin(color: number): number {
  return (color >>> 19) << 10 | (color >>> 11 & 31) << 5 | (color >>> 3 & 31);
}

function paletteFor(colors: readonly number[]): { palette: Uint8Array; tableBits: number } {
  const tableBits = Math.max(1, Math.ceil(Math.log2(colors.length)));
  const palette = new Uint8Array((1 << tableBits) * 3);
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index]!;
    palette[index * 3] = color >>> 16;
    palette[index * 3 + 1] = color >>> 8 & 255;
    palette[index * 3 + 2] = color & 255;
  }
  return { palette, tableBits };
}

/**
 * Preserve simple typography palettes exactly. For photographic frames, weighted
 * median cut uses a bounded 32K-bin histogram. Bins map directly to palette
 * entries, avoiding a pixels × 256 nearest-color search on every frame.
 */
function quantize(rgba: Uint8ClampedArray, paletteSize: number, matte: readonly [number, number, number]): QuantizedFrame {
  const exact = new Map<number, number>();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const color = opaqueColor(rgba, offset, matte);
    if (!exact.has(color)) exact.set(color, exact.size);
    if (exact.size > paletteSize) break;
  }
  const pixels = new Uint8Array(rgba.length / 4);
  if (exact.size <= paletteSize) {
    for (let offset = 0; offset < rgba.length; offset += 4) pixels[offset / 4] = exact.get(opaqueColor(rgba, offset, matte))!;
    return { pixels, ...paletteFor([...exact.keys()]) };
  }

  const counts = new Uint32Array(32768);
  const red = new Uint32Array(32768);
  const green = new Uint32Array(32768);
  const blue = new Uint32Array(32768);
  const occupied = new Uint16Array(32768);
  let occupiedCount = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const color = opaqueColor(rgba, offset, matte);
    const bin = colorBin(color);
    if (counts[bin] === 0) occupied[occupiedCount++] = bin;
    counts[bin] = counts[bin]! + 1;
    red[bin] = red[bin]! + (color >>> 16);
    green[bin] = green[bin]! + (color >>> 8 & 255);
    blue[bin] = blue[bin]! + (color & 255);
  }
  const channels = [red, green, blue] as const;
  const average = (bin: number, axis: number) => channels[axis]![bin]! / counts[bin]!;
  const box = (start: number, end: number): ColorBox => {
    let population = 0;
    const minimum = [255, 255, 255];
    const maximum = [0, 0, 0];
    for (let index = start; index < end; index++) {
      const bin = occupied[index]!;
      population += counts[bin]!;
      for (let axis = 0; axis < 3; axis++) {
        const value = average(bin, axis);
        minimum[axis] = Math.min(minimum[axis]!, value);
        maximum[axis] = Math.max(maximum[axis]!, value);
      }
    }
    // Give green/red more influence while still allocating distinct blue hues.
    const ranges = [(maximum[0]! - minimum[0]!) * 0.8, maximum[1]! - minimum[1]!, (maximum[2]! - minimum[2]!) * 0.6];
    let axis: 0 | 1 | 2 = 0;
    if (ranges[1]! > ranges[axis]!) axis = 1;
    if (ranges[2]! > ranges[axis]!) axis = 2;
    return { start, end, population, axis, score: end - start > 1 ? ranges[axis]! * Math.sqrt(population) : 0 };
  };
  const boxes = [box(0, occupiedCount)];
  while (boxes.length < paletteSize) {
    let selected = -1;
    let bestScore = 0;
    for (let index = 0; index < boxes.length; index++) {
      if (boxes[index]!.score > bestScore) { selected = index; bestScore = boxes[index]!.score; }
    }
    if (selected === -1) break;
    const current = boxes[selected]!;
    occupied.subarray(current.start, current.end).sort((a, b) => average(a, current.axis) - average(b, current.axis));
    let population = 0;
    let split = current.start;
    do { population += counts[occupied[split++]!]!; }
    while (population < current.population / 2 && split < current.end - 1);
    split = Math.min(split, current.end - 1);
    boxes[selected] = box(current.start, split);
    boxes.push(box(split, current.end));
  }
  const mapping = new Uint8Array(32768);
  const colors: number[] = [];
  for (let index = 0; index < boxes.length; index++) {
    const current = boxes[index]!;
    let sumRed = 0, sumGreen = 0, sumBlue = 0;
    for (let cursor = current.start; cursor < current.end; cursor++) {
      const bin = occupied[cursor]!;
      mapping[bin] = index;
      sumRed += red[bin]!; sumGreen += green[bin]!; sumBlue += blue[bin]!;
    }
    colors.push(Math.round(sumRed / current.population) << 16 | Math.round(sumGreen / current.population) << 8 | Math.round(sumBlue / current.population));
  }
  for (let offset = 0; offset < rgba.length; offset += 4) pixels[offset / 4] = mapping[colorBin(opaqueColor(rgba, offset, matte))]!;
  return { pixels, ...paletteFor(colors) };
}

/** GIF LZW, with 255-byte data sub-blocks and a bounded 4096-entry dictionary. */
function writeLzw(output: GifBytes, pixels: Uint8Array, minimumCodeSize: number): void {
  output.byte(minimumCodeSize);
  const block = new Uint8Array(255);
  let blockLength = 0;
  let bitBuffer = 0;
  let bitCount = 0;
  const flushBlock = () => {
    if (!blockLength) return;
    output.byte(blockLength);
    for (let index = 0; index < blockLength; index++) output.byte(block[index]!);
    blockLength = 0;
  };
  const packedByte = (value: number) => {
    block[blockLength++] = value;
    if (blockLength === 255) flushBlock();
  };
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  let codeSize = minimumCodeSize + 1;
  let decoderAvailable = clear + 2;
  let decoderHasPrevious = false;
  // Track the reader's dictionary independently: its first literal does not
  // add an entry, so it grows one emitted code behind the encoder dictionary.
  const code = (value: number) => {
    bitBuffer |= value << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) { packedByte(bitBuffer & 255); bitBuffer >>>= 8; bitCount -= 8; }
    if (value === clear) {
      codeSize = minimumCodeSize + 1;
      decoderAvailable = clear + 2;
      decoderHasPrevious = false;
    } else if (value !== end) {
      if (decoderHasPrevious && decoderAvailable < 4096) {
        decoderAvailable++;
        if (decoderAvailable === 1 << codeSize && codeSize < 12) codeSize++;
      }
      decoderHasPrevious = true;
    }
  };
  const dictionary = new Map<number, number>();
  let nextCode = clear + 2;
  code(clear);
  let prefix = pixels[0]!;
  for (let index = 1; index < pixels.length; index++) {
    const literal = pixels[index]!;
    const key = prefix << 8 | literal;
    const found = dictionary.get(key);
    if (found !== undefined) { prefix = found; continue; }
    code(prefix);
    if (nextCode < 4096) dictionary.set(key, nextCode++);
    else { code(clear); dictionary.clear(); nextCode = clear + 2; }
    prefix = literal;
  }
  code(prefix);
  code(end);
  if (bitCount) packedByte(bitBuffer & 255);
  flushBlock();
  output.byte(0);
}

/**
 * Incremental, browser/worker-compatible GIF89a encoder. Each addFrame consumes
 * the complete RGBA raster synchronously and retains only compressed bytes.
 * Local palettes avoid retaining or pre-scanning an entire animation. The GIF
 * loops forever, uses opaque full frames, and carries exact centisecond delays.
 * Callers should yield between frames or run this class in a worker. After a
 * size error, discard the instance and retry with a smaller export profile.
 */
export class GifEncoder {
  private readonly output: GifBytes;
  private readonly paletteSize: number;
  private readonly matte: readonly [number, number, number];
  private readonly pixels: number;
  private frames = 0;
  private closed = false;
  private failed = false;

  constructor(private readonly options: GifEncoderOptions) {
    const { width, height, maxBytes } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535
      || width * height > MAX_FRAME_PIXELS) throw new RangeError('GIF dimensions exceed the frame pixel limit.');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('GIF byte budget must be a positive integer.');
    if (options.paletteSize !== undefined && options.paletteSize !== 128 && options.paletteSize !== 256) throw new RangeError('GIF palette must have 128 or 256 colors.');
    this.matte = options.matte ? [...options.matte] : [0, 0, 0];
    if (this.matte.length !== 3 || this.matte.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new RangeError('Invalid GIF matte.');
    this.paletteSize = options.paletteSize ?? 256;
    this.pixels = width * height;
    this.output = new GifBytes(maxBytes);
    this.output.ascii('GIF89a');
    this.output.word(width); this.output.word(height);
    this.output.byte(0x70); // Eight-bit color resolution, per-frame palettes.
    this.output.byte(0); this.output.byte(0);
    this.output.byte(0x21); this.output.byte(0xff); this.output.byte(11);
    this.output.ascii('NETSCAPE2.0');
    this.output.byte(3); this.output.byte(1); this.output.word(0); this.output.byte(0);
  }

  addFrame(rgba: Uint8ClampedArray, delayCentiseconds: number): void {
    if (this.closed || this.failed) throw new Error('GIF encoder is no longer writable.');
    if (rgba.length !== this.pixels * 4) throw new RangeError('GIF frame does not match the configured dimensions.');
    if (!Number.isInteger(delayCentiseconds) || delayCentiseconds < 1 || delayCentiseconds > 65535) throw new RangeError('GIF delay must be between 1 and 65535 centiseconds.');
    const frame = quantize(rgba, this.paletteSize, this.matte);
    try {
      this.output.byte(0x21); this.output.byte(0xf9); this.output.byte(4); this.output.byte(4); // Disposal 1; opaque complete raster.
      this.output.word(delayCentiseconds); this.output.byte(0); this.output.byte(0);
      this.output.byte(0x2c); this.output.word(0); this.output.word(0);
      this.output.word(this.options.width); this.output.word(this.options.height);
      this.output.byte(0x80 | frame.tableBits - 1);
      for (const value of frame.palette) this.output.byte(value);
      writeLzw(this.output, frame.pixels, Math.max(2, frame.tableBits));
      this.frames++;
    } catch (error) { this.failed = true; throw error; }
  }

  finish(): Uint8Array<ArrayBuffer> {
    if (this.closed || this.failed) throw new Error('GIF encoder is no longer writable.');
    if (!this.frames) throw new Error('GIF requires at least one frame.');
    try {
      this.output.byte(0x3b);
      this.closed = true;
      return this.output.finish();
    } catch (error) { this.failed = true; throw error; }
  }
}
