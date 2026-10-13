export const MAX_IMAGE_COUNT = 5;
export const MAX_IMAGE_FILE_BYTES = 16 * 1024 * 1024;
export type MediaPlacement = 'before' | 'after';

export class ImageImportError extends Error {
  constructor(readonly kind: 'size' | 'dimensions' | 'decode' | 'animation') {
    super(`Image import failed: ${kind}`);
    this.name = 'ImageImportError';
  }
}

/** A bounded local thumbnail with optional GIF frames or an encoded video clip. */
export interface ImageAsset {
  source: string;
  width: number;
  height: number;
  name: string;
  /** Local encoded video; source above remains its still gallery thumbnail. */
  video?: {
    source: string;
    duration: number;
  };
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
