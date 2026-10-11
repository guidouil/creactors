import { ImageImportError, MAX_IMAGE_FILE_BYTES, type ImageAsset } from './types';
import { importGIF } from './gif';

export { ImageImportError, MAX_IMAGE_FILE_BYTES } from './types';
export const MAX_IMAGE_EDGE = 2048;
const MAX_SOURCE_PIXELS = 64 * 1024 * 1024;
const MAX_SOURCE_EDGE = 16384;

/** Only raster formats; file extensions and MIME labels are not trusted. */
function rasterType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    // AVIF's major/compatible brands, excluding its animated sequence brand.
    const brands = [ascii(8, 12)];
    for (let index = 16; index + 4 <= bytes.length; index += 4) brands.push(ascii(index, index + 4));
    if (brands.includes('avif') && !brands.includes('avis')) return 'image/avif';
  }
  return null;
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
    throw new ImageImportError('dimensions');
  }
}

/** Decode once, preserve EXIF orientation/transparency and bound GPU memory. */
export async function importImage(file: File): Promise<ImageAsset> {
  if (file.size > MAX_IMAGE_FILE_BYTES) throw new ImageImportError('size');
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const type = rasterType(header);
  if (!type) throw new ImageImportError('decode');
  if (type === 'image/gif') return importGIF(await file.arrayBuffer(), file.name);
  // Reject oversized PNGs before allocating their decoded pixel buffer.
  if (type === 'image/png' && header.length >= 24) {
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    validateDimensions(view.getUint32(16), view.getUint32(20));
  }
  const sourceUrl = URL.createObjectURL(file.type === type ? file : new Blob([file], { type }));
  const image = new Image();
  image.decoding = 'async';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    image.src = sourceUrl;
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ImageImportError('decode')), 15000); }),
    ]);
    validateDimensions(image.naturalWidth, image.naturalHeight);
    const factor = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * factor));
    const height = Math.max(1, Math.round(image.naturalHeight * factor));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new ImageImportError('decode');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    const source = canvas.toDataURL('image/png');
    canvas.width = canvas.height = 0;
    if (!source.startsWith('data:image/png;base64,')) throw new ImageImportError('decode');
    return { source, width, height, name: file.name };
  } catch (error) {
    if (error instanceof ImageImportError) throw error;
    throw new ImageImportError('decode');
  } finally {
    clearTimeout(timer);
    image.src = '';
    URL.revokeObjectURL(sourceUrl);
  }
}
