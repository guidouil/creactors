import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DIRECTION_STYLES, MotionDirector, nextRemixSeed, sceneSignature, stableSeed, TooLongTextError } from '../src/direction/director';
import { FUTURE_QUOTE, futureDemo } from '../src/demos/future';
import { evaluateScene } from '../src/scene/evaluator';
import { TextDirector } from '../src/text/director';
import { measureGroups, measureLine } from '../src/typography/measure';

const corpus = [
  "Le futur n'est pas ce qui nous attend. C'est ce que nous créons.",
  "L'intelligence artificielle ne remplace pas les créateurs. Elle en crée de nouveaux.",
  'Et si tout commençait maintenant ?', "On ne voit bien qu'avec le cœur.",
  "L'imagination est plus importante que le savoir.",
  'The future is not what awaits us. It is what we create.',
  "AI doesn't replace creators. It creates more of them.",
  'What if everything started now?', 'Less noise. More meaning.', 'Make your words impossible to ignore.',
];

function direct(text: string, seed = 1, previousSignature?: string | readonly string[]) {
  const analysis = TextDirector.analyze(text);
  const measured = measureGroups(analysis);
  return { spec: MotionDirector.direct(analysis, measured, 'califormandy-sunset', seed, previousSignature), analysis, measured };
}

describe('measured typography and procedural direction', () => {
  it('measures actual kerning and closed counters from the pinned font', () => {
    expect(measureLine('AV').width).toBeLessThan(measureLine('A V').width);
    expect(measureLine('O').counters).not.toHaveLength(0);
    expect(measureLine('I').counters).toHaveLength(0);
    expect(measureLine('é').width).toBeCloseTo(measureLine('e\u0301').width, 8);
    expect(measureLine('👨‍👩‍👧‍👦').width).toBeCloseTo(1.15, 8);
  });

  it.each(corpus)('produces readable deterministic variations across 20 seeds: %s', text => {
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const { spec, measured } = direct(text, seed);
      expect(spec.objects.map(object => object.text).join('')).toBe(text);
      expect(spec.duration).toBeGreaterThan(3);
      expect(spec.duration).toBeLessThanOrEqual(15);
      expect(spec).toEqual(direct(text, seed).spec);
      signatures.add(sceneSignature(spec));
      let previousEnd = 0;
      for (const track of spec.cameraTracks) {
        expect(track.start).toBeCloseTo(previousEnd, 8);
        expect(track.end).toBeGreaterThan(track.start);
        expect(track.start * 30).toBeCloseTo(Math.round(track.start * 30), 7);
        previousEnd = track.end;
      }
      expect(previousEnd).toBe(spec.duration);
      // Real perspective projection verifies a reading hold, not an arbitrary
      // font-size limit disconnected from the phone viewport.
      for (let index = 0; index < spec.objects.length; index++) {
        const object = spec.objects[index]!;
        const measurement = measured[index]!;
        const time = (object.readingInterval[0] + object.readingInterval[1]) / 2;
        const state = evaluateScene(spec, time);
        const camera = new PerspectiveCamera(spec.fov, spec.aspect, 0.05, 180);
        camera.position.fromArray(state.camera.position);
        camera.quaternion.fromArray(state.camera.quaternion);
        camera.updateMatrixWorld();
        const objectState = state.objects[index]!;
        const rotation = new Quaternion().setFromEuler(new Euler(...object.rotation));
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
          const point = new Vector3(x * measurement.width * object.fontSize / 2, y * measurement.height * object.fontSize / 2, 0).applyQuaternion(rotation).add(new Vector3(...objectState.position)).project(camera);
          expect(Math.abs(point.x)).toBeLessThan(0.85);
          expect(Math.abs(point.y)).toBeLessThan(0.65);
        }
        expect(object.readingInterval[1] - object.readingInterval[0]).toBeGreaterThanOrEqual(0.89);
      }
      const arbitrary = spec.duration * 0.43;
      const first = evaluateScene(spec, arbitrary);
      evaluateScene(spec, spec.duration);
      evaluateScene(spec, 0);
      expect(evaluateScene(spec, arbitrary)).toEqual(first);
      const end = evaluateScene(spec, spec.duration - 1 / 30);
      expect(end.objects.every(object => object.position[2] > end.camera.position[2])).toBe(true);
      const beginning = evaluateScene(spec, 0);
      expect(beginning.objects.every(object => object.position[2] > beginning.camera.position[2])).toBe(true);
    }
    expect(signatures.size).toBeGreaterThanOrEqual(16);
  });

  it('keeps the approved authored scene as the default interpretation', () => {
    expect(direct(FUTURE_QUOTE, stableSeed(FUTURE_QUOTE)).spec).toEqual({ ...futureDemo, themeId: 'califormandy-sunset', seed: futureDemo.seed });
    const override = TextDirector.analyze(FUTURE_QUOTE, 'en');
    const explicit = MotionDirector.direct(override, measureGroups(override), 'califormandy-sunset', stableSeed(FUTURE_QUOTE));
    expect(explicit.inputLanguage).toBe('en');
    expect(explicit.objects).toEqual(futureDemo.objects);
  });

  it('uses real eligible counters for portals and bounds tunnel choreography', () => {
    let portals = 0;
    let tunnels = 0;
    for (const text of corpus) for (let seed = 1; seed <= 20; seed++) {
      const { spec, measured } = direct(text, seed);
      for (let index = 0; index < spec.cameraTracks.length; index++) {
        const track = spec.cameraTracks[index]!;
        const previous = spec.cameraTracks[index - 1];
        if (previous && !track.cutBefore) expect(track.from).toEqual(previous.to);
        if (track.primitive === 'TUNNEL') {
          tunnels++;
          expect(track.controls).toBeDefined();
          expect(track.to.position[2]).toBeLessThan(track.from.position[2] - 30);
          expect(track.end - track.start).toBeLessThanOrEqual(1.01);
        }
        if (track.primitive !== 'PORTAL') continue;
        portals++;
        const objectIndex = Number(track.id.split('-').at(-1)) - 1;
        const object = spec.objects[objectIndex]!;
        const aperture = measured[objectIndex]!.portal!;
        expect(object.extruded).toBe(true);
        expect(object.rotation).toEqual([0, 0, 0]);
        const clearance = aperture.radius * object.fontSize - 0.008 * object.fontSize - 0.025;
        const nearFrustumCorner = 0.05 * Math.tan(spec.fov * Math.PI / 360) * Math.hypot(1, spec.aspect);
        expect(clearance).toBeGreaterThan(nearFrustumCorner);
        const centerX = object.position[0] + aperture.center[0] * object.fontSize;
        const centerY = object.position[1] + aperture.center[1] * object.fontSize;
        for (const pose of [track.from, track.to]) {
          expect(pose.position[0]).toBeCloseTo(centerX, 9);
          expect(pose.position[1]).toBeCloseTo(centerY, 9);
          expect(pose.target[0]).toBeCloseTo(centerX, 9);
          expect(pose.target[1]).toBeCloseTo(centerY, 9);
        }
        expect(track.from.position[2]).toBeGreaterThan(object.position[2] + object.extrusionDepth);
        expect(track.to.position[2]).toBeLessThan(object.position[2] - object.extrusionDepth);
        const next = spec.objects[objectIndex + 1]!;
        const nextRead = spec.cameraTracks.find(candidate => candidate.id === `read-${objectIndex + 1}`)!;
        expect(nextRead.from.position[2]).toBeLessThan(object.position[2] - object.extrusionDepth);
        expect(next.position[2]).toBeLessThan(nextRead.from.position[2]);
      }
    }
    expect(portals).toBeGreaterThan(0);
    expect(tunnels).toBeGreaterThan(0);
  });

  it('keeps final poster ink within safe margins and lettering readable at phone size', () => {
    for (const text of corpus) for (let seed = 1; seed <= 20; seed++) {
      const { spec, measured } = direct(text, seed);
      const state = evaluateScene(spec, spec.posterTime!);
      const camera = new PerspectiveCamera(spec.fov, spec.aspect, 0.05, 180);
      camera.position.fromArray(state.camera.position);
      camera.quaternion.fromArray(state.camera.quaternion);
      camera.updateMatrixWorld();
      const visible = spec.objects.map((object, index) => ({ object, index })).filter(({ object }) => object.assembly!.position[0] > -20);
      expect(visible.length).toBeGreaterThan(0);
      for (const { object, index } of visible) {
        const placement = state.objects[index]!;
        const measurement = measured[index]!;
        const opticalSize = object.fontSize * placement.scale;
        // Real projection of the conservative visible ink rectangle, including
        // the final plane depth. Font size by itself says nothing about a phone.
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
          const point = new Vector3(x * measurement.width * opticalSize / 2, y * measurement.inkHeight * opticalSize / 2, 0).add(new Vector3(...placement.position)).project(camera);
          expect(point.x, `${text} seed ${seed} ${object.id}`).toBeGreaterThanOrEqual(-0.84);
          expect(point.x, `${text} seed ${seed} ${object.id}`).toBeLessThanOrEqual(0.84);
          expect(point.y, `${text} seed ${seed} ${object.id}`).toBeGreaterThanOrEqual(-0.64);
          expect(point.y, `${text} seed ${seed} ${object.id}`).toBeLessThanOrEqual(0.76);
        }
        const bottom = new Vector3(...placement.position).project(camera);
        const top = new Vector3(placement.position[0], placement.position[1] + measurement.capHeight * opticalSize, placement.position[2]).project(camera);
        const phoneCapPixels = (top.y - bottom.y) * 640 / 2;
        expect(phoneCapPixels, `${text} seed ${seed} ${object.id}`).toBeGreaterThanOrEqual(24);
      }
      // The enlarged portal hero cannot dictate the final optical size.
      expect(new Set(visible.map(({ object, index }) => Math.round(object.fontSize * state.objects[index]!.scale * 1000))).size).toBe(1);
    }
  });

  it('remixes choreography substantially while preserving theme-independent geometry', () => {
    const text = 'Less noise. More meaning.';
    const initial = direct(text, stableSeed(text));
    const signature = sceneSignature(initial.spec);
    const remix = direct(text, nextRemixSeed(text, initial.spec.seed), signature);
    expect(sceneSignature(remix.spec)).not.toBe(signature);
    expect(remix.spec.objects.map(object => object.text).join('')).toBe(text);
    const mono = MotionDirector.direct(initial.analysis, initial.measured, 'monochrome', initial.spec.seed);
    expect(mono.objects).toEqual(initial.spec.objects);
    expect(mono.cameraTracks).toEqual(initial.spec.cameraTracks);
  });

  it('varies color distributions and conclusion inks without adjacent role repeats', () => {
    const patterns = new Set<string>();
    const conclusions = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const { spec } = direct(corpus[1]!, seed);
      const roles = spec.objects.map(object => object.colorRole);
      patterns.add(roles.join(','));
      conclusions.add(roles.at(-1)!);
      for (let index = 1; index < roles.length; index++) expect(roles[index]).not.toBe(roles[index - 1]);
      expect(spec.objects.at(-1)!.extruded).toBe(true);
      const recolored = { ...spec, objects: spec.objects.map(object => ({ ...object, colorRole: 'white' as const })) };
      expect(sceneSignature(recolored)).toBe(sceneSignature(spec));
    }
    expect(patterns.size).toBeGreaterThanOrEqual(40);
    expect(conclusions).toEqual(new Set(['pink', 'white', 'coral', 'cyan']));
  });

  it('covers independent discrete direction choices across 100 seeds with real motion differences', () => {
    const samples = Array.from({ length: 100 }, (_, index) => direct(corpus[1]!, index + 1).spec);
    for (const name of Object.keys(DIRECTION_STYLES) as (keyof typeof DIRECTION_STYLES)[]) {
      expect(new Set(samples.map(spec => spec.directionStyle![name]))).toEqual(new Set(DIRECTION_STYLES[name]));
    }
    expect(new Set(samples.map(spec => JSON.stringify(spec.directionStyle))).size).toBeGreaterThanOrEqual(95);
    expect(new Set(samples.map(spec => JSON.stringify(spec.objects[0]!.entrance!.rotation))).size).toBeGreaterThanOrEqual(8);
    const finaleShapes = new Map<string, Set<string>>();
    for (const spec of samples) {
      const finale = spec.directionStyle!.finale;
      const shapes = finaleShapes.get(finale) ?? new Set<string>();
      shapes.add(JSON.stringify(spec.objects[0]!.exit));
      finaleShapes.set(finale, shapes);
      const fullRolls = spec.cameraTracks.filter(track => track.rollTurns);
      expect(fullRolls.length).toBeLessThanOrEqual(1);
      for (const track of fullRolls) expect(track.end - track.start).toBeGreaterThanOrEqual(1);
      for (const track of spec.cameraTracks.filter(track => track.primitive === 'PORTAL')) {
        expect(track.rollTurns).toBeUndefined();
        expect(track.impact).toBeUndefined();
        expect(track.from.roll).toBe(0); expect(track.to.roll).toBe(0);
      }
    }
    expect(finaleShapes.size).toBe(5);
    for (const shapes of finaleShapes.values()) expect(shapes.size).toBeGreaterThan(5);
  });

  it('keeps reading holds motionless and lands an impact before the stable poster', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { spec } = direct(corpus[1]!, seed);
      for (const track of spec.cameraTracks.filter(track => track.primitive === 'HOLD' && track.id !== 'loop-seam')) {
        const earlier = evaluateScene(spec, track.start + (track.end - track.start) * 0.12);
        const later = evaluateScene(spec, track.start + (track.end - track.start) * 0.88);
        expect(later.objects).toEqual(earlier.objects);
        expect(later.camera.position).toEqual(earlier.camera.position);
        expect(later.camera.fov).toBe(earlier.camera.fov);
        later.camera.quaternion.forEach((value, index) => expect(value).toBeCloseTo(earlier.camera.quaternion[index]!, 14));
      }
      const impact = spec.objects[0]!.impact!;
      const poster = spec.cameraTracks.find(track => track.id === 'poster')!;
      expect(impact.end).toBe(poster.start);
      expect(impact.end - impact.start).toBeCloseTo(0.3, 7);
      const pulse = evaluateScene(spec, impact.start + (impact.end - impact.start) * 0.19);
      const landed = evaluateScene(spec, poster.start);
      expect(Math.abs(pulse.objects[0]!.scale - landed.objects[0]!.scale)).toBeGreaterThan(0.015);
      expect(spec.posterTime).toBeGreaterThan(poster.start);
      expect(poster.end - poster.start).toBeCloseTo(0.4, 8);
      expect(spec.posterTime).toBeLessThan(poster.end);
    }
  });

  it('ends with a brief visual punctuation rather than a second reading or padded earlier holds', () => {
    const texts = [...corpus, 'Oui.', Array.from({ length: 12 }, () => 'We create the future together.').join(' ')];
    for (const text of texts) for (let seed = 1; seed <= 20; seed++) {
      const { spec, measured } = direct(text, seed);
      const reveal = spec.cameraTracks.find(track => track.id === 'reveal-flight')!;
      const landing = spec.cameraTracks.find(track => track.id === 'reveal-impact')!;
      const poster = spec.cameraTracks.find(track => track.id === 'poster')!;
      const expectedReveal = spec.directionStyle!.reveal === 'spiral' ? 1.35 : 1.1;
      expect(landing.end - reveal.start).toBeCloseTo(Math.round(expectedReveal * 30) / 30, 7);
      expect(poster.start).toBe(landing.end);
      expect(poster.end - poster.start).toBeCloseTo(0.4, 7);
      const lastRead = spec.objects.at(-1)!.readingInterval;
      expect(reveal.start).toBe(lastRead[1]);
      for (let index = 0; index < measured.length; index++) {
        const interval = spec.objects[index]!.readingInterval;
        const requiredReading = Math.round(measured[index]!.group.readingDuration * 30) / 30;
        expect(interval[1] - interval[0]).toBeCloseTo(requiredReading, 7);
      }
      expect(spec.objects.map(object => object.text).join('')).toBe(text);
      const snapshot = evaluateScene(spec, spec.posterTime!);
      [spec.duration, 0, reveal.start, poster.end].forEach(time => evaluateScene(spec, time));
      expect(evaluateScene(spec, spec.posterTime!)).toEqual(snapshot);
    }
    expect(direct('Oui.').spec.duration).toBeLessThan(6);
  });

  it('clears the complete rotated/scaled geometry at both loop endpoints', () => {
    for (const text of [corpus[1]!, 'IMAGINATION'.repeat(5), Array.from({ length: 12 }, () => 'We create the future together.').join(' ')]) for (let seed = 1; seed <= 20; seed++) {
      const { spec, measured } = direct(text, seed);
      for (const time of [0, spec.duration - 2 / 30, spec.duration - 1 / 30]) {
        const state = evaluateScene(spec, time);
        const cameraOrientation = new Quaternion(...state.camera.quaternion).invert();
        for (let index = 0; index < spec.objects.length; index++) {
          const object = spec.objects[index]!;
          const value = state.objects[index]!;
          const rotation = new Quaternion().setFromEuler(new Euler(...value.rotation));
          for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
            const corner = new Vector3(x * measured[index]!.width * object.fontSize / 2, y * measured[index]!.height * object.fontSize / 2, z * Math.max(0.02, object.extrusionDepth / 2)).multiplyScalar(value.scale).applyQuaternion(rotation).add(new Vector3(...value.position)).sub(new Vector3(...state.camera.position)).applyQuaternion(cameraOrientation);
            expect(corner.z, `${text} seed${seed} ${object.id} time${time}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('avoids recent dominant style combinations rather than accepting tiny spatial jitter', () => {
    const text = corpus[1]!;
    let seed = 5;
    const recent: string[] = [];
    let previous: ReturnType<typeof direct>['spec']['directionStyle'];
    for (let remix = 0; remix < 30; remix++) {
      const spec = direct(text, seed, recent).spec;
      const signature = sceneSignature(spec);
      const style = spec.directionStyle!;
      expect(spec).toEqual(direct(text, seed, recent).spec);
      const matching = (other: typeof style) => Number(other.entry === style.entry) + Number(other.transition === style.transition) + Number(other.finale === style.finale);
      for (const old of recent) expect(matching(JSON.parse(old).styles)).toBeLessThan(3);
      if (previous) expect(matching(previous)).toBeLessThan(2);
      recent.push(signature); if (recent.length > 5) recent.shift();
      previous = style;
      seed = nextRemixSeed(text, seed);
    }
  });

  it('reconstructs a history-rejected remix from its accepted seed alone', () => {
    const text = corpus[1]!;
    const original = direct(text, 6);
    const retried = direct(text, original.spec.seed, [sceneSignature(original.spec)]);
    expect(retried.spec.seed).not.toBe(original.spec.seed);
    expect(retried.spec).toEqual(direct(text, retried.spec.seed).spec);
    const mono = MotionDirector.direct(retried.analysis, retried.measured, 'monochrome', retried.spec.seed);
    expect(mono.objects).toEqual(retried.spec.objects);
    expect(mono.cameraTracks).toEqual(retried.spec.cameraTracks);
    expect(direct(FUTURE_QUOTE, stableSeed(FUTURE_QUOTE), []).spec.objects).toEqual(futureDemo.objects);
    const remixedAuthored = direct(FUTURE_QUOTE, stableSeed(FUTURE_QUOTE), [sceneSignature(futureDemo)]).spec;
    expect(remixedAuthored.seed).not.toBe(futureDemo.seed);
    expect(remixedAuthored).toEqual(direct(FUTURE_QUOTE, remixedAuthored.seed).spec);
  });

  it('adapts longer passages and rejects a passage over 60 seconds without truncation', () => {
    const text = Array.from({ length: 12 }, () => 'We create the future together.').join(' ');
    const longer = direct(text);
    expect(longer.spec.duration).toBeGreaterThan(15);
    expect(longer.spec.duration).toBeLessThanOrEqual(60);
    expect(longer.spec.objects.map(object => object.text).join('')).toBe(text);
    expect(() => direct(Array.from({ length: 80 }, () => 'We create the future together.').join(' '))).toThrow(TooLongTextError);
  });

  it('handles one word, large unbroken words and mixed emoji without geometry fallback', () => {
    for (const text of ['Oui.', 'IMAGINATION'.repeat(5), 'Créons 👨‍👩‍👧‍👦 maintenant.']) {
      const { spec, measured } = direct(text);
      expect(spec.objects.map(object => object.text).join('')).toBe(text);
      expect(measured.every(group => group.width <= 6.05)).toBe(true);
      if (text.includes('👨')) expect(spec.objects.find(object => object.text.includes('👨'))!.extruded).toBe(false);
    }
  });
});
