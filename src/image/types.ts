export const MAX_IMAGE_COUNT = 5;
export const MAX_IMAGE_FILE_BYTES = 16 * 1024 * 1024;

export class ImageImportError extends Error {
  constructor(readonly kind: 'size' | 'dimensions' | 'decode' | 'animation') {
    super(`Image import failed: ${kind}`);
    this.name = 'ImageImportError';
  }
}

/** A bounded, orientation-correct raster stored locally for preview and export. */
export interface ImageAsset {
  source: string;
  width: number;
  height: number;
  name: string;
  /** Source attribution for a GIF selected from GIPHY. */
  attribution?: {
    provider: 'giphy';
    id: string;
    pageUrl: string;
    creatorName?: string;
    creatorUrl?: string;
  };
  /** Complete composited PNG frames, selected from absolute animation time. */
  animation?: {
    duration: number;
    frames: readonly { source: string; end: number }[];
  };
}
