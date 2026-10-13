import { describe, expect, it } from 'vitest';
import { futureDemo } from '../src/demos/future';
import { MotionDirector } from '../src/direction/director';
import type { ImageAsset, MediaPlacement } from '../src/image/types';
import { evaluateScene } from '../src/scene/evaluator';
import { FINAL_IMAGE_TIMING, FinalImageDurationError, finalImagesDuration, withFinalImages } from '../src/scene/final-image';
import type { EvaluatedScene, SceneSpec } from '../src/scene/types';
import { TextDirector } from '../src/text/director';
import { measureGroups } from '../src/typography/measure';

const photo: ImageAsset = { source: 'data:image/png;base64,fixture', width: 1920, height: 1080, name: 'photo.png' };
const video: ImageAsset = { ...photo, name: 'clip.mp4', video: { source: 'data:video/mp4;base64,fixture', duration: 3.75 } };

function expectChoreography(actual: EvaluatedScene, expected: EvaluatedScene): void {
  expect(actual.trackId).toBe(expected.trackId);
  actual.camera.position.forEach((value, index) => expect(value).toBeCloseTo(expected.camera.position[index]!, 10));
  actual.camera.quaternion.forEach((value, index) => expect(value).toBeCloseTo(expected.camera.quaternion[index]!, 10));
  expect(actual.objects.map(object => object.id)).toEqual(expected.objects.map(object => object.id));
  actual.objects.forEach((object, index) => {
    const original = expected.objects[index]!;
    object.position.forEach((value, axis) => expect(value).toBeCloseTo(original.position[axis]!, 10));
    object.rotation.forEach((value, axis) => expect(value).toBeCloseTo(original.rotation[axis]!, 10));
    expect(object.scale).toBeCloseTo(original.scale, 10);
  });
}

describe('media before or after text', () => {
  it('plays the complete opening sequence before exposing text and shifts the inspected timeline', () => {
    const spec = withFinalImages(futureDemo, [photo, photo, photo], 'before');
    const offset = spec.mediaSequence!.textOffset;
    expect(offset).toBeCloseTo(finalImagesDuration(3), 12);
    expect(spec.duration).toBeCloseTo(futureDemo.duration + offset, 12);
    expect(spec.posterTime).toBeCloseTo(futureDemo.posterTime! + offset, 12);
    expect(spec.finalImages![0]!.entrance.start).toBe(0);
    expect(evaluateScene(spec, 0).finalImages![0]!.scale).toBe(0);
    expect(spec.finalImages!.at(-1)!.exit.end + FINAL_IMAGE_TIMING.blank).toBeCloseTo(offset, 12);
    for (let frame = 0; frame / spec.fps < offset; frame++) {
      const state = evaluateScene(spec, frame / spec.fps);
      expect(state.objects.every(object => object.scale === 0)).toBe(true);
      expect(state.camera).toEqual(evaluateScene(futureDemo, 0).camera);
    }
    const blank = evaluateScene(spec, offset - FINAL_IMAGE_TIMING.blank / 2);
    expect(blank.finalImages!.every(image => !image.visible)).toBe(true);
    expect(blank.objects.every(object => object.scale === 0)).toBe(true);
    expectChoreography(evaluateScene(spec, offset), evaluateScene(futureDemo, 0));
    expect(spec.objects[0]!.readingInterval).toEqual(futureDemo.objects[0]!.readingInterval.map(time => time + offset));
    expect(spec.objects[0]!.entrance!.start).toBe(futureDemo.objects[0]!.entrance!.start + offset);
    expect(spec.objects[0]!.assembly!.end).toBe(futureDemo.objects[0]!.assembly!.end + offset);
    expect(spec.objects[0]!.exit!.start).toBe(futureDemo.objects[0]!.exit!.start + offset);
    expect(spec.cameraTracks.slice(1).map(track => track.start)).toEqual(futureDemo.cameraTracks.map(track => track.start + offset));
    expect(spec.chapters.map(chapter => chapter.time)).toEqual(spec.chapters.map(chapter => chapter.time).sort((a, b) => a - b));
    expect(evaluateScene(spec, spec.duration).finalImages!.every(image => !image.visible)).toBe(true);
    expectChoreography(evaluateScene(spec, spec.duration), evaluateScene(futureDemo, futureDemo.duration));
  });

  it('preserves every authored text frame after the opening media handoff', () => {
    const spec = withFinalImages(futureDemo, [video, photo], 'before');
    const offset = spec.mediaSequence!.textOffset;
    for (let frame = 0; frame <= futureDemo.duration * futureDemo.fps; frame++) {
      const time = frame / futureDemo.fps;
      expectChoreography(evaluateScene(spec, offset + time), evaluateScene(futureDemo, time));
      expect(evaluateScene(spec, offset + time).finalImages!.every(image => !image.visible)).toBe(true);
    }
  });

  it('retains focused-camera motion, impacts, rolled orientation and secret keyframes', () => {
    const analysis = TextDirector.analyze('Les mots ont le vertige.');
    const directed = MotionDirector.direct(analysis, measureGroups(analysis), 'califormandy-sunset', 7);
    const base: SceneSpec = {
      ...directed,
      cameraTracks: directed.cameraTracks.map((track, index) => index === 0 ? {
        ...track, focusObjectId: directed.objects[0]!.id, rollTurns: 1,
        impact: { start: track.start, end: track.end, rotation: [0.1, 0.05, 0.02], displacement: [0.01, 0.02, 0.01] },
      } : track),
    };
    const spec = withFinalImages(base, [photo], 'before');
    const offset = spec.mediaSequence!.textOffset;
    expect(spec.cameraTracks[1]!.impact!.start).toBe(base.cameraTracks[0]!.impact!.start + offset);
    for (let frame = 0; frame <= base.duration * base.fps; frame++) {
      expectChoreography(evaluateScene(spec, offset + frame / base.fps), evaluateScene(base, frame / base.fps));
    }
  });

  it('restores exact choreography on removal, replacement and repeated placement switches', () => {
    const saved = JSON.stringify(futureDemo);
    const after = withFinalImages(futureDemo, [photo, video]);
    const before = withFinalImages(after, [photo, video], 'before');
    expect(before).toEqual(withFinalImages(futureDemo, [photo, video], 'before'));
    expect(withFinalImages(before, [photo, video], 'after')).toEqual(after);
    expect(withFinalImages(before, [])).toStrictEqual(futureDemo);
    expect(withFinalImages(before, [photo], 'before')).toEqual(withFinalImages(futureDemo, [photo], 'before'));
    const restored: SceneSpec = JSON.parse(JSON.stringify(before));
    expect(withFinalImages(restored, [])).toStrictEqual(futureDemo);
    expect(withFinalImages(restored, [photo], 'after')).toEqual(withFinalImages(futureDemo, [photo]));
    expect(JSON.stringify(futureDemo)).toBe(saved);
    expect(withFinalImages(futureDemo, [], 'before')).toBe(futureDemo);
  });

  it('keeps media placement deterministic after serialization and shuffled seeking', () => {
    const spec = withFinalImages(futureDemo, [video, photo], 'before');
    const restored: SceneSpec = JSON.parse(JSON.stringify(spec));
    const offset = spec.mediaSequence!.textOffset;
    const times = [0, 0.4, 1.7, offset - 0.01, offset, offset + 0.24, offset + 8.9, spec.duration];
    const states = times.map(time => evaluateScene(spec, time));
    for (const index of [7, 0, 5, 2, 4, 1, 6, 3]) expect(evaluateScene(restored, times[index]!)).toEqual(states[index]);
  });

  it.each<MediaPlacement>(['before', 'after'])('holds the complete video before its exit with %s placement', placement => {
    const spec = withFinalImages(futureDemo, [photo, video], placement);
    const image = spec.finalImages![1]!;
    expect(image.exit.start - image.entrance.end).toBeCloseTo(video.video!.duration, 12);
    const firstVideo = withFinalImages(futureDemo, [video], placement).finalImages![0]!;
    expect(firstVideo.exit.start - firstVideo.entrance.end).toBeGreaterThanOrEqual(video.video!.duration);
    for (const duration of [0, -1, NaN, Infinity]) {
      expect(() => withFinalImages(futureDemo, [{ ...video, video: { source: video.video!.source, duration } }], placement)).toThrow(RangeError);
    }
  });

  it('enforces the complete sixty-second limit for opening media without truncating text', () => {
    const openingDuration = finalImagesDuration(1);
    const maximum: SceneSpec = { ...futureDemo, duration: 60 - openingDuration };
    expect(withFinalImages(maximum, [photo], 'before').duration).toBe(60);
    expect(() => withFinalImages({ ...maximum, duration: maximum.duration + 0.01 }, [photo], 'before')).toThrow(FinalImageDurationError);
    expect(() => withFinalImages(futureDemo, [{ ...video, video: { source: video.video!.source, duration: 60 } }], 'before')).toThrow(FinalImageDurationError);
    expect(() => withFinalImages(futureDemo, [photo], 'invalid' as MediaPlacement)).toThrow(RangeError);
  });
});
