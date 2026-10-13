import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MotionDirector, sceneSignature } from '../src/direction/director';
import { applySecretFilm, findSecretFilm, type SecretFilmId } from '../src/direction/secrets';
import { evaluateScene } from '../src/scene/evaluator';
import { withFinalImages } from '../src/scene/final-image';
import type { SceneSpec, Vec3 } from '../src/scene/types';
import { TextDirector } from '../src/text/director';
import { measureGroups, type MeasuredGroup } from '../src/typography/measure';

const phrases: readonly [SecretFilmId, string, string][] = [
  ['gravity', 'La gravité est une suggestion.', 'Gravity is a suggestion.'],
  ['boomerang', 'Les mots reviennent toujours.', 'Words always come back.'],
  ['vertigo', 'Les mots ont le vertige.', 'Words are feeling dizzy.'],
  ['tunnel', 'Il y a un monde derrière les lettres.', 'There is a world behind the letters.'],
  ['supernova', 'Une petite phrase peut devenir une supernova.', 'A little sentence can become a supernova.'],
  ['seventh-face', 'Même le hasard cache quelque chose.', 'Even chance is hiding something.'],
];

function undecorated(text: string, seed = 1, measurementOverrides: Partial<MeasuredGroup> = {}) {
  const analysis = TextDirector.analyze(text);
  const measured = measureGroups(analysis).map(group => ({ ...group, ...measurementOverrides }));
  // The public director decorates secret phrases. Retain the same measured
  // words while bypassing recognition to inspect the underlying choreography.
  const ordinaryAnalysis = { ...analysis, sourceText: 'An ordinary production.' };
  const spec = { ...MotionDirector.direct(ordinaryAnalysis, measured, 'califormandy-sunset', seed), sourceText: text };
  return { spec, analysis, measured };
}

describe('hidden exportable films', () => {
  it.each(phrases)('recognizes %s only as a complete French or English phrase', (id, fr, en) => {
    expect(findSecretFilm(fr)?.id).toBe(id);
    expect(findSecretFilm(en)?.id).toBe(id);
    expect(findSecretFilm(`  ${fr.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll(' ', '  ')}!?  `)?.id).toBe(id);
    expect(findSecretFilm(`Voici : ${fr}`)).toBeNull();
    expect(findSecretFilm(`${en} Another thought.`)).toBeNull();
    const name = findSecretFilm(fr)!.name;
    expect(name.fr.length).toBeGreaterThan(0);
    expect(name.en.length).toBeGreaterThan(0);
  });

  it('accepts typographic apostrophes without broad keyword matching', () => {
    expect(findSecretFilm('There’s a world behind the letters…')?.id).toBe('tunnel');
    for (const text of ['', 'gravity', 'supernova', 'vertige', 'Le hasard est partout.', 'Words always come back to haunt us.']) {
      expect(findSecretFilm(text)).toBeNull();
      const ordinary = undecorated(text || 'Un film ordinaire.').spec;
      expect(applySecretFilm(ordinary)).toBe(ordinary);
    }
  });

  it.each(phrases)('keeps %s deterministic, immutable and fully readable across seeds', (id, fr, en) => {
    for (const text of [fr, en]) for (const seed of [1, 3, 7, 11]) {
      const { spec: base, measured } = undecorated(text, seed);
      const saved = JSON.stringify(base);
      const spec = applySecretFilm(base);
      expect(spec.secretFilm).toBe(id);
      expect(spec.generatorVersion).toBe(`${base.generatorVersion}+secrets-2`);
      expect(applySecretFilm(base)).toEqual(spec);
      expect(applySecretFilm(spec)).toBe(spec);
      expect(JSON.stringify(base)).toBe(saved);
      expect(spec.sourceText).toBe(text);
      expect(spec.objects.map(object => object.text).join('')).toBe(text);
      expect(spec.objects.map(object => object.displayText)).toEqual(base.objects.map(object => object.displayText));
      expect(spec.duration).toBe(base.duration);
      expect(spec.posterTime).toBe(base.posterTime);
      expect(spec.chapters).toEqual(base.chapters);
      expect(spec.cameraTracks.map(track => [track.start, track.end])).toEqual(base.cameraTracks.map(track => [track.start, track.end]));
      expect(evaluateScene(spec, spec.posterTime!)).toEqual(evaluateScene(base, base.posterTime!));
      expect(spec.cameraTracks.at(-1)).toEqual(base.cameraTracks.at(-1));
      for (let index = 0; index < spec.objects.length; index++) {
        const object = spec.objects[index]!;
        expect(object.readingInterval).toEqual(base.objects[index]!.readingInterval);
        for (const fraction of [0, 0.5, 1 - 1e-6]) {
          const time = object.readingInterval[0] + (object.readingInterval[1] - object.readingInterval[0]) * fraction;
          const state = evaluateScene(spec, time);
          const original = evaluateScene(base, time);
          expect(state.objects[index]).toEqual(original.objects[index]);
          expect(state.camera).toEqual(original.camera);
          const camera = new PerspectiveCamera(spec.fov, spec.aspect, 0.05, 180);
          camera.position.fromArray(state.camera.position);
          camera.quaternion.fromArray(state.camera.quaternion);
          camera.updateMatrixWorld();
          const rotation = new Quaternion().setFromEuler(new Euler(...object.rotation));
          for (const x of [-1, 1]) for (const y of [-1, 1]) {
            const point = new Vector3(x * measured[index]!.width * object.fontSize / 2, y * measured[index]!.height * object.fontSize / 2, 0)
              .applyQuaternion(rotation).add(new Vector3(...state.objects[index]!.position)).project(camera);
            expect(Math.abs(point.x)).toBeLessThan(0.85);
            expect(Math.abs(point.y)).toBeLessThan(0.65);
          }
        }
      }
      for (const time of [0, spec.duration - 1 / spec.fps, spec.duration]) {
        const state = evaluateScene(spec, time);
        expect(state.objects.every(object => object.position[2] > state.camera.position[2])).toBe(true);
      }
      const boundaries = spec.cameraTracks.flatMap(track => [track.start, (track.start + track.end) / 2, track.end]);
      for (const time of boundaries) expect(allFinite(evaluateScene(spec, time))).toBe(true);
      const arbitrary = spec.duration * 0.31;
      const first = evaluateScene(spec, arbitrary);
      evaluateScene(spec, spec.duration);
      evaluateScene(spec, 0);
      expect(evaluateScene(spec, arbitrary)).toEqual(first);
    }
  });

  it.each(phrases)('keeps the visible %s finale inside the portrait frame before its rush', (_id, fr, en) => {
    for (const text of [fr, en]) for (const seed of [1, 7, 11, 771]) {
      const { spec: base, measured } = undecorated(text, seed);
      const spec = applySecretFilm(base);
      for (const fraction of [.18, .3, .5, .65, .7]) {
        const exit = spec.objects[0]!.exit!;
        const state = evaluateScene(spec, exit.start + (exit.end - exit.start) * fraction);
        const camera = new PerspectiveCamera(spec.fov, spec.aspect, .05, 180);
        camera.position.fromArray(state.camera.position);
        camera.quaternion.fromArray(state.camera.quaternion);
        camera.updateMatrixWorld();
        state.objects.forEach((object, index) => {
          const authored = spec.objects[index]!;
          const rotation = new Quaternion().setFromEuler(new Euler(...object.rotation));
          for (const x of [-1, 1]) for (const y of [-1, 1]) {
            const point = new Vector3(x * measured[index]!.width * authored.fontSize * object.scale / 2,
              y * measured[index]!.height * authored.fontSize * object.scale / 2, 0)
              .applyQuaternion(rotation).add(new Vector3(...object.position)).project(camera);
            expect(Math.abs(point.x), `${text}, seed ${seed}, at ${fraction}`).toBeLessThan(1);
            expect(Math.abs(point.y), `${text}, seed ${seed}, at ${fraction}`).toBeLessThan(1);
            expect(point.z).toBeGreaterThan(-1);
            expect(point.z).toBeLessThan(1);
          }
        });
      }
    }
  });

  it('brings the boomerang words back to the settled poster before they leave', () => {
    const spec = applySecretFilm(undecorated('Les mots reviennent toujours.', 7).spec);
    const exit = spec.objects[0]!.exit!;
    const poster = evaluateScene(spec, spec.posterTime!).objects;
    const at = (fraction: number) => evaluateScene(spec, exit.start + (exit.end - exit.start) * fraction).objects;
    const outgoing = at(.24);
    const returning = at(.5);
    for (let index = 0; index < poster.length; index++) {
      const centre = poster[index]!.position[0];
      expect((outgoing[index]!.position[0] - centre) * (returning[index]!.position[0] - centre)).toBeLessThan(0);
    }
    at(.74).forEach((object, index) => {
      object.position.forEach((value, axis) => expect(value).toBeCloseTo(poster[index]!.position[axis]!, 10));
      object.rotation.forEach((value, axis) => expect(value).toBeCloseTo(poster[index]!.rotation[axis]!, 10));
      expect(object.scale).toBeCloseTo(poster[index]!.scale, 10);
    });
  });

  it.each([
    'Il y a un monde derrière les lettres.', 'Une petite phrase peut devenir une supernova.', 'Words always come back.',
  ])('finishes the complete final scan before its secret gesture and photographs: %s', text => {
    for (const seed of [1, 11, 77]) {
      // The ordinary font fits these short phrases. Simulate a tall text block
      // whose small capitals would become unreadable if the full stack shrank.
      const { spec: base } = undecorated(text, seed, { width: 3, height: 8, inkHeight: 8, portal: null });
      const secret = applySecretFilm(base);
      const scroll = secret.cameraTracks.find(track => track.id === 'poster-scroll')!;
      const end = secret.cameraTracks.find(track => track.id === 'poster-end')!;
      expect(scroll).toBeDefined();
      expect(end).toBeDefined();
      for (const object of secret.objects) expect(object.exit!.start).toBe(end.end);
      for (let frame = Math.ceil(scroll.start * secret.fps); frame / secret.fps < end.end; frame++) {
        const time = frame / secret.fps;
        expect(evaluateScene(secret, time).objects).toEqual(evaluateScene(base, time).objects);
      }
      const extended = withFinalImages(secret, [{ source: 'data:image/png;base64,fixture', width: 1920, height: 1080, name: 'secret.png' }]);
      expect(extended.finalImages![0]!.entrance.start).toBeGreaterThan(end.end);
      expect(evaluateScene(extended, (scroll.start + scroll.end) / 2).finalImages![0]!.visible).toBe(false);
      expect(withFinalImages(extended, [])).toEqual(secret);
    }
  });

  it.each(phrases)('keeps ordinary %s phrases in a static final poster', (_id, fr, en) => {
    for (const text of [fr, en]) for (const seed of [1, 11, 77]) {
      const secret = applySecretFilm(undecorated(text, seed).spec);
      expect(secret.cameraTracks.some(track => track.id === 'poster-scroll' || track.id === 'poster-end')).toBe(false);
      const poster = secret.cameraTracks.find(track => track.id === 'poster')!;
      const first = evaluateScene(secret, poster.start);
      const last = evaluateScene(secret, poster.end - 1e-7);
      expect(last.objects).toEqual(first.objects);
      expect(last.camera).toEqual(first.camera);
      for (const object of secret.objects) expect(object.exit!.start).toBeGreaterThanOrEqual(poster.end);
    }
  });

  it.each(phrases)('centers the %s finale on the camera after a vertical poster pan', (_id, text) => {
    const { spec: base } = undecorated(text, 7);
    const shift = -12;
    const move = (point: Vec3): Vec3 => [point[0], point[1] + shift, point[2]];
    const translated: SceneSpec = {
      ...base,
      objects: base.objects.map(object => ({
        ...object, position: move(object.position),
        assembly: object.assembly ? { ...object.assembly, position: move(object.assembly.position) } : undefined,
      })),
      cameraTracks: base.cameraTracks.map(track => ({
        ...track,
        from: { ...track.from, position: move(track.from.position), target: move(track.from.target) },
        to: { ...track.to, position: move(track.to.position), target: move(track.to.target) },
        controls: track.controls ? [move(track.controls[0]), move(track.controls[1])] : undefined,
      })),
    };
    const secret = applySecretFilm(base);
    const shifted = applySecretFilm(translated);
    const exit = secret.objects[0]!.exit!;
    for (const fraction of [.18, .3, .5, .7, .9, 1]) {
      const time = exit.start + (exit.end - exit.start) * fraction;
      const original = evaluateScene(secret, time);
      const moved = evaluateScene(shifted, time);
      original.objects.forEach((object, index) => {
        object.position.forEach((value, axis) => expect(moved.objects[index]!.position[axis]).toBeCloseTo(value + (axis === 1 ? shift : 0), 10));
        expect(moved.objects[index]!.rotation).toEqual(object.rotation);
        expect(moved.objects[index]!.scale).toBe(object.scale);
      });
      original.camera.position.forEach((value, axis) => expect(moved.camera.position[axis]).toBeCloseTo(value + (axis === 1 ? shift : 0), 10));
      expect(new Quaternion(...moved.camera.quaternion).angleTo(new Quaternion(...original.camera.quaternion))).toBeLessThan(1e-7);
    }
  });

  it('settles camera orientations at track boundaries, including generated portals', () => {
    let portals = 0;
    for (const [, text] of phrases) for (let seed = 1; seed <= 24; seed++) {
      const secret = applySecretFilm(undecorated(text, seed).spec);
      portals += secret.cameraTracks.filter(track => track.primitive === 'PORTAL').length;
      for (let index = 1; index < secret.cameraTracks.length; index++) {
        const track = secret.cameraTracks[index]!;
        const previous = secret.cameraTracks[index - 1]!;
        if (track.cutBefore) continue;
        expect(track.from).toEqual(previous.to);
        const before = evaluateScene(secret, track.start - 1e-7).camera;
        const after = evaluateScene(secret, track.start).camera;
        expect(new Vector3(...before.position).distanceTo(new Vector3(...after.position))).toBeLessThan(0.005);
        expect(Math.abs(new Quaternion(...before.quaternion).dot(new Quaternion(...after.quaternion)))).toBeGreaterThan(1 - 1e-5);
      }
    }
    expect(portals).toBeGreaterThan(0);
  });

  it('authors six different physical paths, beyond metadata or palette changes', () => {
    const base = undecorated('La gravité est une suggestion.', 7).spec;
    const paths = phrases.map(([, text]) => {
      const spec = applySecretFilm({ ...base, sourceText: text });
      return JSON.stringify({ objects: spec.objects.map(({ entrance, exit, impact }) => ({ entrance, exit, impact })), tracks: spec.cameraTracks });
    });
    expect(new Set(paths).size).toBe(6);
  });

  it.each(phrases)('keeps %s compatible with optional final photographs and removal', (_id, text) => {
    const secret = applySecretFilm(undecorated(text, 7).spec);
    const extended = withFinalImages(secret, [{ source: 'data:image/png;base64,fixture', width: 1920, height: 1080, name: 'secret.png' }]);
    expect(extended.secretFilm).toBe(secret.secretFilm);
    expect(extended.sourceText).toBe(text);
    expect(extended.objects).toEqual(secret.objects);
    expect(extended.finalImages![0]!.entrance.start).toBeGreaterThan(secret.posterTime!);
    expect(withFinalImages(extended, [])).toEqual(secret);
    for (const object of secret.objects) {
      const time = (object.readingInterval[0] + object.readingInterval[1]) / 2;
      const { finalImages, ...state } = evaluateScene(extended, time);
      expect(state).toEqual(evaluateScene(secret, time));
      expect(finalImages![0]!.visible).toBe(false);
    }
    expect(evaluateScene(extended, extended.duration).finalImages![0]!.visible).toBe(false);
  });

  it.each(phrases)('applies %s through the director and preserves remix variation', (id, text) => {
    const analysis = TextDirector.analyze(text);
    const measured = measureGroups(analysis);
    const history: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const spec = MotionDirector.direct(analysis, measured, 'califormandy-sunset', seed, history);
      expect(spec.secretFilm).toBe(id);
      expect(MotionDirector.direct(analysis, measured, 'califormandy-sunset', spec.seed)).toEqual(spec);
      const signature = sceneSignature(spec);
      expect(history).not.toContain(signature);
      history.push(signature);
    }
  });
});

function allFinite(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFinite);
  if (value && typeof value === 'object') return Object.values(value).every(allFinite);
  return true;
}
