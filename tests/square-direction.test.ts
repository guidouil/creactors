import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FUTURE_QUOTE, futureDemo } from '../src/demos/future';
import { MotionDirector, sceneSignature, stableSeed } from '../src/direction/director';
import { evaluateScene } from '../src/scene/evaluator';
import type { SceneSpec } from '../src/scene/types';
import { TextDirector } from '../src/text/director';
import { DEFAULT_FONT_ID } from '../src/typography/fonts';
import { measureGroups, type MeasuredGroup } from '../src/typography/measure';

function square(text: string, seed = 1, fontId = DEFAULT_FONT_ID) {
  const analysis = TextDirector.analyze(text);
  const measured = measureGroups(analysis, fontId, 'square');
  const spec = MotionDirector.direct(analysis, measured, 'califormandy-sunset', seed, undefined, 'square');
  return { analysis, measured, spec };
}

function cameraFor(spec: SceneSpec, time: number) {
  const state = evaluateScene(spec, time);
  const camera = new PerspectiveCamera(spec.fov, spec.aspect, 0.05, 180);
  camera.position.fromArray(state.camera.position);
  camera.quaternion.fromArray(state.camera.quaternion);
  camera.updateMatrixWorld();
  return { state, camera };
}

function posterTime(spec: SceneSpec, index: number): number {
  const scroll = spec.cameraTracks.find(track => track.id === 'poster-scroll');
  if (!scroll) return spec.posterTime!;
  const y = spec.objects[index]!.assembly!.position[1];
  const progress = Math.max(0, Math.min(1, (scroll.from.position[1] - y) / (scroll.from.position[1] - scroll.to.position[1])));
  return scroll.start + (scroll.end - scroll.start) * progress;
}

function posterCapPixels(spec: SceneSpec, measurement: MeasuredGroup, index: number): number {
  const { state, camera } = cameraFor(spec, posterTime(spec, index));
  const placement = state.objects[index]!;
  const opticalSize = spec.objects[index]!.fontSize * placement.scale;
  const bottom = new Vector3(...placement.position).project(camera);
  const top = new Vector3(placement.position[0], placement.position[1] + measurement.capHeight * opticalSize, placement.position[2]).project(camera);
  return (top.y - bottom.y) * 360 / 2;
}

function expectFramed(spec: SceneSpec, measured: readonly MeasuredGroup[], readable = true): void {
  for (const [index, object] of spec.objects.entries()) {
    const measurement = measured[index]!;
    const label = `${spec.fontId}: ${spec.sourceText} seed ${spec.seed} ${object.id}`;
    const time = (object.readingInterval[0] + object.readingInterval[1]) / 2;
    const { state, camera } = cameraFor(spec, time);
    const placement = state.objects[index]!;
    const rotation = new Quaternion().setFromEuler(new Euler(...placement.rotation));
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const point = new Vector3(x * measurement.width * object.fontSize / 2, y * measurement.height * object.fontSize / 2, 0)
        .multiplyScalar(placement.scale).applyQuaternion(rotation).add(new Vector3(...placement.position)).project(camera);
      expect(Math.abs(point.x), label).toBeLessThan(0.85);
      expect(Math.abs(point.y), label).toBeLessThan(0.65);
    }
    const poster = cameraFor(spec, posterTime(spec, index));
    const assembled = poster.state.objects[index]!;
    const size = object.fontSize * assembled.scale;
    const width = (measurement.width + (object.extruded ? 0.016 : 0)) * size;
    const height = (object.extruded ? measurement.inkHeight + 0.016 : measurement.height) * size;
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const point = new Vector3(x * width / 2, y * height / 2, 0).add(new Vector3(...assembled.position)).project(poster.camera);
      expect(Math.abs(point.x), label).toBeLessThan(0.84);
      expect(point.y, label).toBeGreaterThanOrEqual(-0.64 - 1e-9);
      expect(point.y, label).toBeLessThanOrEqual(0.76 + 1e-9);
    }
    if (readable) expect(posterCapPixels(spec, measurement, index), label).toBeGreaterThanOrEqual(24);
  }
}

describe('square film composition', () => {
  it('keeps the vertical default and authored starter while recomposing the square starter at its original seed', () => {
    const analysis = TextDirector.analyze(FUTURE_QUOTE);
    const measured = measureGroups(analysis);
    const seed = stableSeed(FUTURE_QUOTE);
    const vertical = MotionDirector.direct(analysis, measured, 'califormandy-sunset', seed);
    expect(MotionDirector.direct(analysis, measureGroups(analysis, DEFAULT_FONT_ID, 'vertical'), 'califormandy-sunset', seed, undefined, 'vertical')).toEqual(vertical);
    expect(vertical.objects).toEqual(futureDemo.objects);
    const recomposed = square(FUTURE_QUOTE, seed);
    expect(recomposed.spec.aspect).toBe(1);
    expect(recomposed.spec.seed).toBe(seed);
    expect(recomposed.spec.cameraTracks).not.toEqual(vertical.cameraTracks);
    expect(recomposed.spec.objects.map(object => object.displayText)).not.toEqual(vertical.objects.map(object => object.displayText));
    expectFramed(recomposed.spec, recomposed.measured);
  });

  it('uses wider lines while preserving original words, spaces, accents and complete emoji sequences', () => {
    const text = '  Le futur. Think big. Créons re\u0301ellement 👨‍👩‍👧‍👦 ensemble.  ';
    const analysis = TextDirector.analyze(text);
    const vertical = measureGroups(analysis);
    const { measured, spec } = square(text);
    expect(measured.map(group => group.displayText)).not.toEqual(vertical.map(group => group.displayText));
    expect(measured.reduce((sum, group) => sum + group.lineCount, 0)).toBeLessThan(vertical.reduce((sum, group) => sum + group.lineCount, 0));
    expect(measured.some((group, index) => group.width > vertical[index]!.width)).toBe(true);
    expect(spec.sourceText).toBe(text);
    expect(spec.objects.map(object => object.text).join('')).toBe(text);
    expect(measured.flatMap(group => group.displayText.split(/\s+/u))).toEqual(text.trim().split(/\s+/u));
  });

  it.each([
    FUTURE_QUOTE,
    'The future is not what awaits us. It is what we create.',
    'Less noise. More meaning.',
    'Make your words impossible to ignore.',
  ])('fits reading shots and readable final phrases in the square across fonts and seeds: %s', text => {
    for (const font of [DEFAULT_FONT_ID, 'montserrat-bold', 'bungee', 'black-ops-one', 'press-start-2p']) {
      for (const seed of [1, 3, 7, 11, 20, 77]) {
        const { spec, measured } = square(text, seed, font);
        expect(spec).toEqual(square(text, seed, font).spec);
        expect(spec.aspect).toBe(1);
        expect(spec.duration).toBeLessThanOrEqual(60);
        expect(spec.objects.map(object => object.text).join('')).toBe(text);
        expectFramed(spec, measured);
        for (const track of spec.cameraTracks.filter(track => track.primitive === 'PORTAL')) {
          const index = Number(track.id.split('-').at(-1)) - 1;
          const object = spec.objects[index]!;
          const radius = measured[index]!.portal!.radius;
          const clearance = radius * object.fontSize - 0.008 * object.fontSize - 0.025;
          expect(clearance).toBeGreaterThan(0.05 * Math.tan(spec.fov * Math.PI / 360) * Math.hypot(1, spec.aspect));
        }
      }
    }
  });

  it('passes the larger square near frustum through real counters', () => {
    let portals = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { spec, measured } = square('O. GO.', seed);
      for (const track of spec.cameraTracks.filter(track => track.primitive === 'PORTAL')) {
        portals++;
        const index = Number(track.id.split('-').at(-1)) - 1;
        const object = spec.objects[index]!;
        const radius = measured[index]!.portal!.radius;
        const clearance = radius * object.fontSize - 0.008 * object.fontSize - 0.025;
        expect(clearance).toBeGreaterThan(0.05 * Math.tan(spec.fov * Math.PI / 360) * Math.hypot(1, spec.aspect));
      }
    }
    expect(portals).toBeGreaterThan(0);
  });

  it('preserves the complete readable square poster scan for a long passage', () => {
    const text = Array.from({ length: 10 }, () => 'We create the future together.').join(' ');
    const { spec, measured } = square(text, 11);
    const scroll = spec.cameraTracks.find(track => track.id === 'poster-scroll')!;
    expect(scroll).toBeDefined();
    expect(scroll.to.position[1]).toBeLessThan(scroll.from.position[1]);
    expect(spec.duration).toBeLessThanOrEqual(60);
    expect(spec.objects.map(object => object.text).join('')).toBe(text);
    for (const [index, object] of spec.objects.entries()) {
      expect(object.exit!.start).toBeGreaterThanOrEqual(scroll.end);
      expect(object.readingInterval[1] - object.readingInterval[0]).toBeCloseTo(Math.round(measured[index]!.group.readingDuration * spec.fps) / spec.fps, 7);
    }
    expectFramed(spec, measured);
    const restored: SceneSpec = JSON.parse(JSON.stringify(spec));
    expect(evaluateScene(restored, scroll.start + 0.4)).toEqual(evaluateScene(spec, scroll.start + 0.4));
    expect(sceneSignature(square(text, spec.seed).spec)).toBe(sceneSignature(spec));
  });

  it('uses the square display height when deciding whether a complete poster is readable', () => {
    const analysis = TextDirector.analyze('A. B. C.');
    const measured = measureGroups(analysis, DEFAULT_FONT_ID, 'square').map(group => ({ ...group, width: 3, height: 1.4, inkHeight: 1.3, portal: null }));
    const base = MotionDirector.direct(analysis, measured, 'califormandy-sunset', 1, undefined, 'square');
    expect(base.cameraTracks.some(track => track.id === 'poster-scroll')).toBe(false);
    const referencePixels = Math.min(...measured.map((group, index) => posterCapPixels(base, group, index)));
    const adjusted = (pixels: number) => {
      const measurements = measured.map(group => ({ ...group, capHeight: group.capHeight * pixels / referencePixels }));
      return MotionDirector.direct(analysis, measurements, 'califormandy-sunset', 1, undefined, 'square');
    };
    expect(adjusted(24.1).cameraTracks.some(track => track.id === 'poster-scroll')).toBe(false);
    expect(adjusted(23.9).cameraTracks.some(track => track.id === 'poster-scroll')).toBe(true);
  });

  it('keeps a wide unbroken word and an emoji whole while fitting their square geometry', () => {
    for (const text of ['IMAGINATION'.repeat(5), 'Créons 👨‍👩‍👧‍👦 maintenant.']) {
      const { spec, measured } = square(text);
      expect(spec.objects.map(object => object.text).join('')).toBe(text);
      expect(measured.flatMap(group => group.displayText.split(/\s+/u))).toEqual(text.split(/\s+/u));
      expectFramed(spec, measured, false);
    }
  });
});
