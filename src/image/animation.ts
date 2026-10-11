import type { ImageAsset } from './types';

/** Select by scene time, never by the browser's independent GIF playback clock. */
export function imageFrameIndex(asset: ImageAsset, elapsed: number): number {
  const animation = asset.animation;
  if (!animation || animation.frames.length < 2 || !Number.isFinite(elapsed) || elapsed <= 0) return 0;
  // Subtracting the scene's arrival timestamp can put an exact boundary just
  // below its intended value. Preserve cuts and wraps within numeric precision.
  const remainder = elapsed % animation.duration;
  const phase = animation.duration - remainder < 1e-9 ? 0 : remainder;
  let first = 0, last = animation.frames.length - 1;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (phase + 1e-9 < animation.frames[middle]!.end) last = middle;
    else first = middle + 1;
  }
  return first;
}
