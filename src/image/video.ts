import { BlobSource, CanvasSink, Input, MP4, QTFF, WEBM, type InputVideoTrack, type WrappedCanvas } from 'mediabunny';
import { importImage, MAX_IMAGE_EDGE } from './importer';
import type { ImageAsset } from './types';

export const MAX_VIDEO_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_VIDEO_DURATION = 30;
const MAX_SOURCE_EDGE = 8192;
const MAX_SOURCE_PIXELS = 32 * 1024 * 1024;
const INPUT_FORMATS = [MP4, QTFF, WEBM];
const localSources = new WeakMap<NonNullable<ImageAsset['video']>, Blob>();

export class VideoImportError extends Error {
  constructor(readonly kind: 'size' | 'duration' | 'dimensions' | 'decode') {
    super(`Video import failed: ${kind}`);
    this.name = 'VideoImportError';
  }
}

/** Container signatures decide the importer; names and MIME labels are hints only. */
function videoContainer(bytes: Uint8Array): 'video/mp4' | 'video/webm' | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  // Older QuickTime clips may omit ftyp and begin with one of these atoms.
  if (bytes.length >= 8 && ['moov', 'mdat', 'wide', 'free'].includes(ascii(4, 8))) return 'video/mp4';
  if (bytes.length < 12 || ascii(4, 8) !== 'ftyp') return null;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const brands = [ascii(8, 12)];
  for (let index = 16; index + 4 <= Math.min(bytes.length, boxSize); index += 4) brands.push(ascii(index, index + 4));
  // AVIF/HEIF share the ISO base-media signature but belong to the image importer.
  if (brands.some(brand => ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand))) return null;
  return 'video/mp4';
}

export async function importMedia(file: File): Promise<ImageAsset> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  return videoContainer(bytes) ? importVideo(file) : importImage(file);
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
    throw new VideoImportError('dimensions');
  }
}

function serializeSource(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new VideoImportError('decode'));
    reader.onerror = () => reject(new VideoImportError('decode'));
    reader.onabort = () => reject(new VideoImportError('decode'));
    reader.readAsDataURL(blob);
  });
}

async function videoTrack(input: Input): Promise<InputVideoTrack> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new VideoImportError('decode');
  const [codedWidth, codedHeight, displayWidth, displayHeight] = await Promise.all([
    track.getCodedWidth(), track.getCodedHeight(), track.getDisplayWidth(), track.getDisplayHeight(),
  ]);
  validateDimensions(codedWidth, codedHeight);
  validateDimensions(displayWidth, displayHeight);
  if (!await track.canDecode()) throw new VideoImportError('decode');
  return track;
}

/** Decode one thumbnail, then retain the compressed local clip for timestamp-based playback. */
export async function importVideo(file: File): Promise<ImageAsset> {
  if (file.size > MAX_VIDEO_FILE_BYTES) throw new VideoImportError('size');
  const type = videoContainer(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  if (!type) throw new VideoImportError('decode');
  const blob = new Blob([file], { type });
  const input = new Input({ source: new BlobSource(blob), formats: INPUT_FORMATS });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    return await Promise.race([
      (async () => {
        const track = await videoTrack(input);
        const firstTimestamp = Math.max(0, await track.getFirstTimestamp());
        const endTimestamp = await track.computeDuration();
        const duration = endTimestamp - firstTimestamp;
        if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION) throw new VideoImportError('duration');
        const displayWidth = await track.getDisplayWidth();
        const displayHeight = await track.getDisplayHeight();
        const factor = Math.min(1, MAX_IMAGE_EDGE / Math.max(displayWidth, displayHeight));
        const width = Math.max(1, Math.round(displayWidth * factor));
        const height = Math.max(1, Math.round(displayHeight * factor));
        const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
        const frame = await sink.getCanvas(firstTimestamp);
        if (!frame) throw new VideoImportError('decode');
        canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new VideoImportError('decode');
        context.drawImage(frame.canvas, 0, 0, width, height);
        const source = canvas.toDataURL('image/png');
        if (!source.startsWith('data:image/png;base64,')) throw new VideoImportError('decode');
        const video = { source: await serializeSource(blob), duration };
        localSources.set(video, blob);
        return { source, width, height, name: file.name, video };
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new VideoImportError('decode')), 15_000); }),
    ]);
  } catch (error) {
    if (error instanceof VideoImportError) throw error;
    throw new VideoImportError('decode');
  } finally {
    clearTimeout(timer);
    input.dispose();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

function localVideoBlob(video: NonNullable<ImageAsset['video']>): Blob {
  const cached = localSources.get(video);
  if (cached) return cached;
  // Imported scenes stay offline: reject remote/blob URLs, including stale object URLs.
  const match = /^data:video\/(?:mp4|webm|quicktime);base64,([A-Za-z0-9+/]*={0,2})$/.exec(video.source);
  if (!match || match[1]!.length > Math.ceil(MAX_VIDEO_FILE_BYTES / 3) * 4) throw new VideoImportError('decode');
  const encoded = match[1]!;
  // Decode in small blocks to avoid a second enormous intermediate string.
  const blocks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < encoded.length; offset += 65536) {
    const block = atob(encoded.slice(offset, offset + 65536));
    blocks.push(Uint8Array.from(block, character => character.charCodeAt(0)));
  }
  const blob = new Blob(blocks, { type: video.source.slice(5, video.source.indexOf(';')) });
  if (!blob.size || blob.size > MAX_VIDEO_FILE_BYTES) throw new VideoImportError('size');
  localSources.set(video, blob);
  return blob;
}

/** A clip plays once from its first frame, then holds its last frame during departure. */
export function videoFrameTime(duration: number, elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.min(elapsed, Math.max(0, duration - 1e-7));
}

export interface PreparedVideoFrames {
  drawFrame(elapsed: number, context: CanvasRenderingContext2D, isCurrent?: () => boolean): Promise<boolean>;
  dispose(): void;
}

/** Keep only current/lookahead canvases; sequential playback reuses one decoder. */
export async function prepareVideoFrames(asset: ImageAsset): Promise<PreparedVideoFrames> {
  if (!asset.video) throw new VideoImportError('decode');
  if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width <= 0 || asset.height <= 0
    || Math.max(asset.width, asset.height) > MAX_IMAGE_EDGE) throw new VideoImportError('dimensions');
  const input = new Input({ source: new BlobSource(localVideoBlob(asset.video)), formats: INPUT_FORMATS });
  try {
    const track = await videoTrack(input);
    const start = Math.max(0, await track.getFirstTimestamp());
    const end = await track.computeDuration();
    const duration = end - start;
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION) throw new VideoImportError('duration');
    const sink = new CanvasSink(track, { width: asset.width, height: asset.height, fit: 'fill', poolSize: 2 });
    let iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
    let current: WrappedCanvas | null = null;
    let next: WrappedCanvas | null = null;
    let previousTime = -Infinity;
    let drawnTimestamp = -Infinity;
    let disposed = false;
    let tail = Promise.resolve();
    return {
      drawFrame(elapsed, context, isCurrent = () => true) {
        let changed = false;
        const operation = tail.then(async () => {
          if (disposed) return;
          const timestamp = start + videoFrameTime(duration, elapsed);
          if (!iterator || timestamp < previousTime - 1e-9 || timestamp - previousTime > 1) {
            await iterator?.return();
            iterator = sink.canvases(timestamp, end);
            const first = await iterator.next();
            current = first.done ? null : first.value;
            const second = await iterator.next();
            next = second.done ? null : second.value;
          }
          while (next && next.timestamp <= timestamp + 1e-9) {
            current = next;
            const result = await iterator!.next();
            next = result.done ? null : result.value;
          }
          previousTime = timestamp;
          if (!current) throw new VideoImportError('decode');
          if (disposed || !isCurrent() || current.timestamp === drawnTimestamp) return;
          context.clearRect(0, 0, context.canvas.width, context.canvas.height);
          context.drawImage(current.canvas, 0, 0, context.canvas.width, context.canvas.height);
          drawnTimestamp = current.timestamp;
          changed = true;
        });
        tail = operation.catch(() => {});
        return operation.then(() => changed);
      },
      dispose() {
        disposed = true;
        input.dispose();
        void iterator?.return().catch(() => {});
        iterator = null; current = next = null;
      },
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
}
