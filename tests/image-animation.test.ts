import { describe, expect, it } from 'vitest';
import { futureDemo } from '../src/demos/future';
import { imageFrameIndex } from '../src/image/animation';
import type { ImageAsset } from '../src/image/types';
import { FinalImageDurationError, withFinalImages } from '../src/scene/final-image';

const still: ImageAsset = { source: 'red', width: 100, height: 100, name: 'photo.png' };
const gif: ImageAsset = {
  ...still, name: 'animation.gif',
  animation: { duration: 1, frames: [
    { source: 'red', end: 0.2 }, { source: 'green', end: 0.5 }, { source: 'blue', end: 1 },
  ] },
};

describe('animated final images', () => {
  it('uses variable GIF delays and wraps consistently when seeking in either direction', () => {
    const samples = [0, 0.199, 0.2, 0.499, 0.5, 0.999, 1, 1.2, 1.5, 3.999, 4];
    const expected = [0, 0, 1, 1, 2, 2, 0, 1, 2, 2, 0];
    expect(samples.map(time => imageFrameIndex(gif, time))).toEqual(expected);
    expect([...samples].reverse().map(time => imageFrameIndex(gif, time))).toEqual([...expected].reverse());
    expect(imageFrameIndex(gif, 10.1 + 0.2 - 10.1)).toBe(1);
    expect(imageFrameIndex(gif, 10.1 + 1 - 10.1)).toBe(0);
  });

  it('shows the first frame during arrival and leaves still photographs unchanged', () => {
    for (const time of [-10, -0.01, 0, NaN]) expect(imageFrameIndex(gif, time)).toBe(0);
    expect(imageFrameIndex(still, 100)).toBe(0);
  });

  it('gives every GIF a full cycle and starts the next media at the previous departure', () => {
    const longer: ImageAsset = { ...gif, animation: { duration: 3, frames: [{ source: 'red', end: 1 }, { source: 'blue', end: 3 }] } };
    const sequence = withFinalImages(futureDemo, [still, gif, still, longer]);
    const images = sequence.finalImages!;
    expect(images.map(image => image.asset.name)).toEqual(['photo.png', 'animation.gif', 'photo.png', 'animation.gif']);
    expect(images[0]!.exit.start).toBe(withFinalImages(futureDemo, [still]).finalImages![0]!.exit.start);
    for (let index = 1; index < images.length; index++) {
      const image = images[index]!;
      expect(image.entrance.start).toBe(images[index - 1]!.exit.start);
      expect(image.exit.start - image.entrance.end).toBeCloseTo(Math.max(0.45, image.asset.animation?.duration ?? 0), 10);
    }
    expect(sequence.duration).toBeCloseTo(images.at(-1)!.exit.end + 0.15, 10);
    expect(sequence.objects).toBe(futureDemo.objects);
    expect(withFinalImages(sequence, [])).toEqual(futureDemo);
    expect(withFinalImages(sequence, [still])).toEqual(withFinalImages(futureDemo, [still]));
  });

  it('protects the complete text and rejects GIF endings beyond the film limit', () => {
    const long: ImageAsset = { ...gif, animation: { duration: 30, frames: [{ source: 'red', end: 30 }] } };
    expect(() => withFinalImages(futureDemo, [long, long])).toThrow(FinalImageDurationError);
    expect(() => withFinalImages(futureDemo, [{ ...gif, animation: { duration: 0, frames: [] } }])).toThrow(RangeError);
  });
});
