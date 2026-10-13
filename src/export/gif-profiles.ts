import { filmFormat } from '../scene/format';

/** The strictest of the mobile X and LinkedIn animated-GIF upload budgets. */
export const GIF_MAX_BYTES = 4_999_999;
export const GIF_MAX_FRAMES = 350;
export const GIF_MAX_TOTAL_PIXELS = 36_152_320;

export interface GifExportProfile {
  format: 'gif';
  width: number;
  height: number;
  /** Average rate; GIF stores each frame's duration in hundredths of a second. */
  fps: number;
  frameCount: number;
  paletteSize: 128 | 256;
  maxBytes: number;
}

const qualitySteps = [
  { scale: 1, fps: 12, paletteSize: 256 },
  { scale: 0.8, fps: 10, paletteSize: 256 },
  { scale: 2 / 3, fps: 8, paletteSize: 256 },
  { scale: 8 / 15, fps: 6, paletteSize: 128 },
  { scale: 0.4, fps: 4, paletteSize: 128 },
  { scale: 0.3, fps: 3, paletteSize: 128 },
  { scale: 7 / 30, fps: 2, paletteSize: 128 },
] as const;

function framesFor(duration: number, fps: number): number {
  const centiseconds = Math.max(1, Math.round(duration * 100));
  // Avoid the very short delays which GIF players often replace with 100 ms.
  return Math.max(1, Math.min(GIF_MAX_FRAMES, Math.floor(duration * fps + 1e-9), Math.floor(centiseconds / 2)));
}

function dimensions(longEdge: number, square: boolean, frameCount: number): [number, number] {
  if (square) {
    const edge = Math.max(1, Math.min(Math.floor(longEdge), Math.floor(Math.sqrt(GIF_MAX_TOTAL_PIXELS / frameCount))));
    return [edge, edge];
  }
  // Multiples of 9 × 16 keep the authored camera aspect exact at every quality.
  const units = Math.max(1, Math.min(Math.floor(longEdge / 16), Math.floor(Math.sqrt(GIF_MAX_TOTAL_PIXELS / (frameCount * 144)))));
  return [units * 9, units * 16];
}

/** Smaller retries preserve every second of the scene and stay within upload budgets. */
export function candidateGifProfiles(duration: number, aspect: number): GifExportProfile[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new RangeError('GIF duration must be between zero and sixty seconds.');
  const square = filmFormat(aspect) === 'square';
  const initialFrames = framesFor(duration, qualitySteps[0].fps);
  const [, initialLongEdge] = dimensions(480, square, initialFrames);
  const seen = new Set<string>();
  const profiles: GifExportProfile[] = [];
  for (const step of qualitySteps) {
    const frameCount = framesFor(duration, step.fps);
    const [width, height] = dimensions(initialLongEdge * step.scale, square, frameCount);
    const key = `${width}/${height}/${frameCount}/${step.paletteSize}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({ format: 'gif', width, height, fps: frameCount / duration, frameCount, paletteSize: step.paletteSize, maxBytes: GIF_MAX_BYTES });
  }
  return profiles;
}

/** Distribute centisecond rounding across the whole film, keeping its full duration. */
export function gifFrameTiming(index: number, frameCount: number, duration: number): { time: number; delayCentiseconds: number } {
  const total = Math.max(1, Math.round(duration * 100));
  return {
    time: index * duration / frameCount,
    delayCentiseconds: Math.round((index + 1) * total / frameCount) - Math.round(index * total / frameCount),
  };
}
