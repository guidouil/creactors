import { describe, expect, it } from 'vitest';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { futureDemo } from '../src/demos/future';
import { MotionDirector } from '../src/direction/director';
import type { ImageAsset } from '../src/image/types';
import { evaluateScene } from '../src/scene/evaluator';
import { FINAL_IMAGE_BRIDGE_ENTRANCE, FINAL_IMAGE_DURATION, FINAL_IMAGE_STRIDE, FINAL_IMAGE_TIMING, FinalImageDurationError, finalImagesDuration, withFinalImages } from '../src/scene/final-image';
import type { SceneSpec } from '../src/scene/types';
import { TextDirector } from '../src/text/director';
import { measureGroups, measureLine } from '../src/typography/measure';

const asset: ImageAsset = { source: 'data:image/png;base64,fixture', width: 1920, height: 1080, name: 'finale.png' };

function cameraFor(spec: SceneSpec, time: number): PerspectiveCamera {
  const state = evaluateScene(spec, time);
  const camera = new PerspectiveCamera(spec.fov, spec.aspect, 0.05, 180);
  camera.position.fromArray(state.camera.position);
  camera.quaternion.fromArray(state.camera.quaternion);
  camera.updateMatrixWorld();
  return camera;
}

describe('optional final image choreography', () => {
  it('preserves every text object, reading frame, poster and original camera motion', () => {
    const spec = withFinalImages(futureDemo, [asset]);
    const image = spec.finalImages![0]!;
    expect(image.entrance.start).toBe(10.2);
    expect(image.entrance.end).toBeCloseTo(10.6, 12);
    expect(image.exit.start).toBeCloseTo(11.4, 12);
    expect(spec.duration).toBeCloseTo(12.15, 12);
    expect(spec.objects).toBe(futureDemo.objects);
    expect(spec.sourceText).toBe(futureDemo.sourceText);
    expect(spec.objects.map(object => object.text).join('')).toBe(futureDemo.objects.map(object => object.text).join(''));
    for (let frame = 0; frame < futureDemo.duration * futureDemo.fps; frame++) {
      const time = frame / futureDemo.fps;
      const state = evaluateScene(spec, time);
      const { finalImages, ...before } = state;
      if (time < image.entrance.start) expect(finalImages?.[0]?.visible).toBe(false);
      expect(before).toEqual(evaluateScene(futureDemo, time));
    }
    expect(evaluateScene(spec, futureDemo.posterTime!).finalImages?.[0]?.visible).toBe(false);
    expect(spec.cameraTracks.slice(0, -1)).toEqual(futureDemo.cameraTracks);
    expect(spec.chapters.map(chapter => chapter.time)).toEqual(spec.chapters.map(chapter => chapter.time).sort((a, b) => a - b));
  });

  it.each([
    'La gravité est une suggestion.', 'Les mots reviennent toujours.', 'Les mots ont le vertige.',
    'Il y a un monde derrière les lettres.', 'Une petite phrase peut devenir une supernova.',
    'Même le hasard cache quelque chose.',
  ])('keeps the visible secret departure unobstructed before the first photo: %s', text => {
    for (const seed of [1, 7, 11]) {
      const analysis = TextDirector.analyze(text);
      const base = MotionDirector.direct(analysis, measureGroups(analysis), 'califormandy-sunset', seed);
      const saved = JSON.stringify(base);
      const spec = withFinalImages(base, [asset, { ...asset, name: 'next.png' }]);
      const first = spec.finalImages![0]!;
      const gestureEnd = Math.max(...base.objects.map(object => {
        const exit = object.exit!;
        return exit.start + (exit.end - exit.start) * exit.keyframes!.at(-1)!.at;
      }));
      expect(first.entrance.start).toBeCloseTo(gestureEnd, 12);
      expect(first.entrance.end - first.entrance.start).toBeCloseTo(FINAL_IMAGE_BRIDGE_ENTRANCE, 12);
      // The photo must not cover any frame of the visible text motif, including
      // a later object's final beat. State preservation alone would miss that.
      const start = Math.min(...base.objects.map(object => object.exit!.start));
      for (let frame = Math.ceil(start * spec.fps); frame / spec.fps < gestureEnd; frame++) {
        const time = frame / spec.fps;
        const { finalImages, ...state } = evaluateScene(spec, time);
        expect(finalImages![0]!.visible).toBe(false);
        expect(state).toEqual(evaluateScene(base, time));
      }
      for (const object of base.objects) for (const keyframe of object.exit!.keyframes!) {
        const time = object.exit!.start + (object.exit!.end - object.exit!.start) * keyframe.at;
        const photo = evaluateScene(spec, time).finalImages![0]!;
        expect(!photo.visible || photo.scale === 0).toBe(true);
      }
      expect(evaluateScene(spec, base.posterTime!).finalImages![0]!.visible).toBe(false);
      expect(first.exit.start - first.entrance.end).toBeGreaterThanOrEqual(FINAL_IMAGE_TIMING.hold - 1e-10);
      expect(spec.finalImages![1]!.entrance.start).toBe(first.exit.start);
      expect(spec.objects).toBe(base.objects);
      expect(withFinalImages(spec, [])).toEqual(base);
      expect(withFinalImages(spec, [asset]).duration).toBe(withFinalImages(base, [asset]).duration);
      expect(JSON.stringify(base)).toBe(saved);
    }
  });

  it('retains the existing text/photo bridge for departures without intermediate beats', () => {
    const empty: SceneSpec = {
      ...futureDemo,
      objects: futureDemo.objects.map(object => ({ ...object, exit: { ...object.exit!, keyframes: [] } })),
    };
    const legacy = withFinalImages(futureDemo, [asset]);
    const spec = withFinalImages(empty, [asset]);
    expect(spec.finalImages).toEqual(legacy.finalImages);
    expect(spec.duration).toBe(legacy.duration);
    expect(spec.posterTime).toBe(legacy.posterTime);
  });

  it('includes the delayed first photo arrival in the sixty-second limit', () => {
    const lateGesture = (duration: number): SceneSpec => ({
      ...futureDemo, duration,
      objects: futureDemo.objects.map(object => ({ ...object, exit: {
        ...object.exit!, start: duration - .9, end: duration - .1,
        keyframes: [{ at: .9, position: object.assembly!.position }],
      } })),
    });
    // The last beat is 0.18 s before the base end, so the 0.4 s arrival extends
    // beyond it. A full hold, departure and blank still follow that arrival.
    const extension = FINAL_IMAGE_BRIDGE_ENTRANCE - .18
      + FINAL_IMAGE_TIMING.hold + FINAL_IMAGE_TIMING.exit + FINAL_IMAGE_TIMING.blank;
    const maximumBase = 60 - extension;
    expect(withFinalImages(lateGesture(maximumBase), [asset]).duration).toBeCloseTo(60, 12);
    expect(() => withFinalImages(lateGesture(maximumBase + .01), [asset])).toThrow(FinalImageDurationError);
  });

  it('is empty at both loop ends and physically passes behind the frozen camera', () => {
    const spec = withFinalImages(futureDemo, [asset]);
    const image = spec.finalImages![0]!;
    expect(evaluateScene(spec, 0).finalImages?.[0]?.visible).toBe(false);
    const arrival = evaluateScene(spec, image.entrance.start).finalImages![0]!;
    expect(arrival.scale).toBe(0);
    expect(evaluateScene(spec, image.entrance.end).finalImages?.[0]?.scale).toBe(1);
    const landed = evaluateScene(spec, image.exit.start);
    const travelled = evaluateScene(spec, image.exit.end);
    const inCameraSpace = new Vector3(...travelled.finalImages![0]!.position)
      .sub(new Vector3(...travelled.camera.position))
      .applyQuaternion(new Quaternion(...travelled.camera.quaternion).invert());
    expect(inCameraSpace.z).toBeCloseTo(5, 12);
    expect(travelled.finalImages?.[0]?.visible).toBe(false);
    expect(travelled.objects).toEqual(landed.objects);
    expect(spec.duration - image.exit.end).toBeCloseTo(FINAL_IMAGE_TIMING.blank, 12);
    for (let frame = 0; frame < FINAL_IMAGE_TIMING.blank * spec.fps; frame++) {
      expect(evaluateScene(spec, spec.duration - frame / spec.fps).finalImages?.[0]?.visible).toBe(false);
    }
  });

  it('fits square, landscape and portrait images intact with any final camera rotation', () => {
    const pose = { position: [4, -3, 7] as const, target: [-5, 8, -2] as const, roll: 1.17 };
    const rotated: SceneSpec = {
      ...futureDemo,
      cameraTracks: [{ id: 'rotated', start: 0, end: futureDemo.duration, primitive: 'HOLD', from: pose, to: pose, easing: 'linear', rollTurns: 1 }],
    };
    for (const [width, height] of [[1920, 1080], [1080, 1920], [1000, 1000], [30, 3000], [3000, 30]]) {
      const spec = withFinalImages(rotated, [{ ...asset, width, height }]);
      const image = spec.finalImages![0]!;
      const state = evaluateScene(spec, spec.posterTime!);
      const camera = cameraFor(spec, spec.posterTime!);
      expect(image.width / image.height).toBeCloseTo(width / height, 12);
      const rotation = new Quaternion().setFromEuler(new Euler(...state.finalImages![0]!.rotation));
      const normal = new Vector3(0, 0, 1).applyQuaternion(rotation);
      const facingCamera = new Vector3(...state.camera.position).sub(new Vector3(...state.finalImages![0]!.position)).normalize();
      expect(normal.dot(facingCamera)).toBeCloseTo(1, 12);
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        const projected = new Vector3(x * image.width / 2, y * image.height / 2, 0)
          .applyQuaternion(rotation).add(new Vector3(...state.finalImages![0]!.position)).project(camera);
        expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.820000001);
        expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.640000001);
      }
      const originalEnd = evaluateScene(rotated, rotated.duration);
      expect(new Quaternion(...originalEnd.camera.quaternion).angleTo(new Quaternion(...state.camera.quaternion))).toBeLessThan(1e-7);
      expect(state.camera.position).toEqual(originalEnd.camera.position);
    }
  });

  it('has deterministic absolute state after shuffled scrubbing and serialization', () => {
    const spec = withFinalImages(futureDemo, Array.from({ length: 5 }, (_, index) => ({ ...asset, name: `photo-${index}.png` })));
    const restored: SceneSpec = JSON.parse(JSON.stringify(spec));
    for (let frame = 0; frame <= spec.duration * spec.fps; frame++) {
      const time = frame / spec.fps;
      const expected = evaluateScene(spec, time);
      [spec.duration, 0, imageTime(spec, 0.5), imageTime(spec, 2.3), 3].forEach(other => evaluateScene(spec, other));
      expect(evaluateScene(restored, time)).toEqual(expected);
      expected.finalImages!.forEach(transform => {
        [...transform.position, ...transform.rotation, transform.scale].forEach(value => expect(Number.isFinite(value)).toBe(true));
      });
    }
  });

  it('removes/replaces an image without extending duration again or mutating the source', () => {
    const untouched = JSON.stringify(futureDemo);
    expect(withFinalImages(futureDemo, [])).toBe(futureDemo);
    const first = withFinalImages(futureDemo, [asset]);
    const replacement = withFinalImages(first, [{ ...asset, name: 'replacement.png', width: 1080, height: 1920 }]);
    expect(replacement.duration).toBe(first.duration);
    expect(replacement.cameraTracks).toHaveLength(futureDemo.cameraTracks.length + 1);
    expect(replacement.chapters).toHaveLength(futureDemo.chapters.length + 3);
    expect(replacement.finalImages?.[0]?.asset.name).toBe('replacement.png');
    const removed = withFinalImages(first, []);
    expect(removed.duration).toBe(futureDemo.duration);
    expect(removed.cameraTracks).toEqual(futureDemo.cameraTracks);
    expect(removed.chapters).toEqual(futureDemo.chapters);
    expect(removed.posterTime).toBe(futureDemo.posterTime);
    expect(removed.finalImages).toBeUndefined();
    expect(JSON.stringify(futureDemo)).toBe(untouched);
  });

  it('rejects an overlong film without deleting words and accepts exactly 60 seconds', () => {
    const maximumBase = 60 - FINAL_IMAGE_TIMING.hold - FINAL_IMAGE_TIMING.exit;
    expect(withFinalImages({ ...futureDemo, duration: maximumBase }, [asset]).duration).toBeCloseTo(60, 12);
    expect(() => withFinalImages({ ...futureDemo, duration: maximumBase + 0.01 }, [asset])).toThrow(FinalImageDurationError);
    expect(() => withFinalImages({ ...futureDemo, duration: 60 }, [asset])).toThrow(FinalImageDurationError);
    expect(() => withFinalImages(futureDemo, [{ ...asset, width: 0 }])).toThrow(RangeError);
  });

  it('shows up to five photos in order with a spatial handoff and frozen text movement', () => {
    const assets = Array.from({ length: 5 }, (_, index) => ({ ...asset, name: `photo-${index}.png` }));
    const spec = withFinalImages(futureDemo, assets);
    expect(spec.duration).toBeCloseTo(withFinalImages(futureDemo, [asset]).duration + 4 * FINAL_IMAGE_STRIDE, 12);
    expect(finalImagesDuration(5)).toBeCloseTo(6.5, 12);
    expect(spec.finalImages?.map(image => image.asset.name)).toEqual(assets.map(image => image.name));
    expect(spec.cameraTracks).toHaveLength(futureDemo.cameraTracks.length + 1);
    const finalWords = evaluateScene(futureDemo, futureDemo.duration).objects;
    for (let index = 0; index < assets.length; index++) {
      const image = spec.finalImages![index]!;
      const state = evaluateScene(spec, Math.max(image.entrance.end, futureDemo.duration) + FINAL_IMAGE_TIMING.hold / 2);
      expect(state.objects).toEqual(finalWords);
      expect(state.finalImages!.filter(image => image.visible).map(image => image.id)).toEqual([image.id]);
      if (index === 0) expect(image.entrance.start).toBeCloseTo(10.2, 12);
      else expect(image.entrance.start).toBeCloseTo(spec.finalImages![index - 1]!.exit.start, 12);
      const next = spec.finalImages![index + 1];
      if (next) {
        expect(next.entrance.start).toBeCloseTo(image.exit.start, 12);
        const handoff = evaluateScene(spec, image.exit.start + FINAL_IMAGE_TIMING.exit / 2);
        expect(handoff.finalImages!.filter(image => image.visible).map(image => image.id)).toEqual([image.id, next.id]);
        const incoming = handoff.finalImages![index + 1]!;
        expect(incoming.scale).toBeGreaterThan(0);
        expect(incoming.scale).toBeLessThan(1);
        const cameraSpace = new Vector3(...incoming.position).sub(new Vector3(...handoff.camera.position))
          .applyQuaternion(new Quaternion(...handoff.camera.quaternion).invert());
        expect(cameraSpace.z).toBeLessThan(-9);
        expect(evaluateScene(spec, image.exit.end).finalImages![index + 1]!.visible).toBe(true);
      }
    }
    const removed = withFinalImages(spec, []);
    expect(removed.duration).toBe(futureDemo.duration);
    expect(removed.chapters).toEqual(futureDemo.chapters);
    expect(() => withFinalImages(futureDemo, [...assets, asset])).toThrow(RangeError);
    const replacement = withFinalImages(spec, assets.slice(0, 2));
    expect(replacement.duration).toBe(withFinalImages(futureDemo, assets.slice(0, 2)).duration);
    expect(replacement.chapters).toHaveLength(futureDemo.chapters.length + 6);
    const maximumBase = 60 - FINAL_IMAGE_TIMING.hold - FINAL_IMAGE_TIMING.exit - 4 * FINAL_IMAGE_STRIDE;
    expect(withFinalImages({ ...futureDemo, duration: maximumBase }, assets).duration).toBeCloseTo(60, 12);
    expect(() => withFinalImages({ ...futureDemo, duration: maximumBase + 0.01 }, assets)).toThrow(FinalImageDurationError);
  });

  it('leaves no extended empty projected gap between incoming and outgoing photographs', () => {
    const dimensions = [[1920, 1080], [1080, 1920], [1000, 1000], [3000, 30], [30, 3000]];
    const assets = dimensions.map(([width, height], index) => ({ ...asset, width: width!, height: height!, name: `photo-${index}.png` }));
    const spec = withFinalImages(futureDemo, assets);
    const first = spec.finalImages![0]!;
    const last = spec.finalImages!.at(-1)!;
    let emptyFrames = 0;
    let longestGap = 0;
    for (let frame = Math.ceil(first.entrance.end * spec.fps); frame <= last.exit.start * spec.fps; frame++) {
      const useful = spec.finalImages!.some((_, index) => projectedFraction(spec, frame / spec.fps, index) >= 0.15);
      emptyFrames = useful ? 0 : emptyFrames + 1;
      longestGap = Math.max(longestGap, emptyFrames / spec.fps);
    }
    expect(longestGap).toBeLessThanOrEqual(FINAL_IMAGE_TIMING.blank);
    expect(evaluateScene(spec, spec.duration).finalImages!.every(image => !image.visible)).toBe(true);
    expect(evaluateScene(spec, spec.duration - FINAL_IMAGE_TIMING.blank / 2).finalImages!.every(image => !image.visible)).toBe(true);
  });

  it('calculates an overlapping sequence duration and rejects invalid photo counts', () => {
    expect(finalImagesDuration(0)).toBe(0);
    expect(finalImagesDuration(1)).toBe(FINAL_IMAGE_DURATION);
    for (let count = 2; count <= 5; count++) {
      expect(finalImagesDuration(count) - finalImagesDuration(count - 1)).toBeCloseTo(FINAL_IMAGE_STRIDE, 12);
      const spec = withFinalImages(futureDemo, Array.from({ length: count }, () => asset));
      expect(spec.duration - spec.finalImages!.at(-1)!.exit.end).toBeCloseTo(FINAL_IMAGE_TIMING.blank, 12);
    }
    for (const count of [-1, 0.5, 6, NaN, Infinity]) expect(() => finalImagesDuration(count)).toThrow(RangeError);
  });

  it('bridges the text rush to its first photo across the bilingual corpus and every ending style', () => {
    const corpus = [
      "Le futur n'est pas ce qui nous attend. C'est ce que nous créons.",
      "L'intelligence artificielle ne remplace pas les créateurs. Elle en crée de nouveaux.",
      'Et si tout commençait maintenant ?', "On ne voit bien qu'avec le cœur.",
      "L'imagination est plus importante que le savoir.",
      'The future is not what awaits us. It is what we create.',
      "AI doesn't replace creators. It creates more of them.",
      'What if everything started now?', 'Less noise. More meaning.', 'Make your words impossible to ignore.',
    ];
    const styles = new Set<string>();
    for (const text of corpus) for (let seed = 1; seed <= 20; seed++) {
      const analysis = TextDirector.analyze(text);
      const base = MotionDirector.direct(analysis, measureGroups(analysis), 'califormandy-sunset', seed);
      styles.add(base.directionStyle!.finale);
      assertTextPhotoBridge(base);
    }
    assertTextPhotoBridge(futureDemo);
    expect(styles.size).toBe(5);
  });

  it('uses the safe append fallback when no final departure can be identified', () => {
    const base: SceneSpec = { ...futureDemo, objects: futureDemo.objects.map(({ exit: _exit, ...object }) => object) };
    const spec = withFinalImages(base, [asset]);
    expect(spec.finalImages![0]!.entrance.start).toBe(base.duration);
    expect(spec.duration).toBeCloseTo(base.duration + FINAL_IMAGE_DURATION, 12);
    expect(withFinalImages(spec, [])).toEqual(base);
  });
});

function imageTime(spec: SceneSpec, offset: number): number {
  return spec.finalImages![0]!.entrance.start + offset;
}

function assertTextPhotoBridge(base: SceneSpec): void {
  const spec = withFinalImages(base, [asset]);
  const first = spec.finalImages![0]!;
  const lastTextExit = Math.max(...base.objects.map(object => object.exit!.end));
  expect(first.entrance.start).toBeLessThan(lastTextExit);
  expect(first.entrance.end).toBeLessThanOrEqual(lastTextExit + 1 / spec.fps);
  expect(first.exit.start - lastTextExit).toBeGreaterThanOrEqual(FINAL_IMAGE_TIMING.hold - 1e-10);
  for (const object of base.objects) for (const time of object.readingInterval) {
    const { finalImages, ...state } = evaluateScene(spec, time);
    expect(state).toEqual(evaluateScene(base, time));
    expect(finalImages![0]!.visible).toBe(false);
  }
  expect(evaluateScene(spec, base.posterTime!).finalImages![0]!.visible).toBe(false);
  expect(spec.cameraTracks.slice(0, -1)).toEqual(base.cameraTracks);
  let gap = 0;
  for (let frame = Math.ceil(first.entrance.start * spec.fps); frame <= first.exit.start * spec.fps; frame++) {
    const time = frame / spec.fps;
    const useful = projectedFraction(spec, time, 0) >= 0.15 || projectedTextFraction(spec, time) >= 0.15;
    gap = useful ? 0 : gap + 1;
    expect(gap / spec.fps, `empty bridge ${base.sourceText} ${base.seed}/${base.directionStyle?.finale ?? 'authored'} at ${time}, first ${first.entrance.start}→${first.entrance.end}, image ${projectedFraction(spec, time, 0)}, text ${projectedTextFraction(spec, time)}`).toBeLessThanOrEqual(1 / spec.fps);
  }
}

function projectedTextFraction(spec: SceneSpec, time: number): number {
  const state = evaluateScene(spec, time);
  const camera = cameraFor(spec, time);
  return Math.max(...spec.objects.map((object, index) => {
    const transform = state.objects[index]!;
    const centre = new Vector3(...transform.position).applyMatrix4(camera.matrixWorldInverse);
    if (centre.z >= -camera.near) return 0;
      const lines = (object.displayText ?? object.text).split('\n').map(line => measureLine(line));
    const width = Math.max(...lines.map(line => line.width));
    const height = 0.7 + (lines.length - 1) * 0.95;
    const rotation = new Quaternion().setFromEuler(new Euler(...transform.rotation));
    const corners = [-1, 1].flatMap(x => [-1, 1].map(y =>
      new Vector3(x * width * object.fontSize * transform.scale / 2, y * height * object.fontSize * transform.scale / 2, 0)
        .applyQuaternion(rotation).add(new Vector3(...transform.position)).project(camera)));
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    const projectedWidth = (Math.min(1, Math.max(...xs)) - Math.max(-1, Math.min(...xs))) / 2;
    const projectedHeight = (Math.min(1, Math.max(...ys)) - Math.max(-1, Math.min(...ys))) / 2;
    return projectedWidth > 0 && projectedHeight > 0 ? Math.max(projectedWidth, projectedHeight) : 0;
  }));
}

/** Actual projected size, excluding a still-visible plane which has passed behind the lens. */
function projectedFraction(spec: SceneSpec, time: number, index: number): number {
  const state = evaluateScene(spec, time);
  const transform = state.finalImages![index]!;
  if (!transform.visible || transform.scale <= 0) return 0;
  const camera = cameraFor(spec, time);
  const centre = new Vector3(...transform.position).applyMatrix4(camera.matrixWorldInverse);
  if (centre.z >= -camera.near) return 0;
  const image = spec.finalImages![index]!;
  const rotation = new Quaternion().setFromEuler(new Euler(...transform.rotation));
  const corners = [-1, 1].flatMap(x => [-1, 1].map(y =>
    new Vector3(x * image.width * transform.scale / 2, y * image.height * transform.scale / 2, 0)
      .applyQuaternion(rotation).add(new Vector3(...transform.position)).project(camera)));
  const widths = corners.map(point => point.x);
  const heights = corners.map(point => point.y);
  const width = (Math.min(1, Math.max(...widths)) - Math.max(-1, Math.min(...widths))) / 2;
  const height = (Math.min(1, Math.max(...heights)) - Math.max(-1, Math.min(...heights))) / 2;
  return Math.max(width, height);
}
