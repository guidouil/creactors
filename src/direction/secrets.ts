import type { CameraTrack, MotionKeyframe, SceneObject, SceneSpec, Vec3 } from '../scene/types';

export type SecretFilmId = 'gravity' | 'boomerang' | 'vertigo' | 'tunnel' | 'supernova' | 'seventh-face';

interface SecretFilm {
  id: SecretFilmId;
  name: { fr: string; en: string };
  phrases: readonly string[];
}

const films: readonly SecretFilm[] = [
  { id: 'gravity', name: { fr: 'Gravité facultative', en: 'Optional gravity' }, phrases: [
    'La gravité est une suggestion.', 'Gravity is a suggestion.', 'Gravity is just a suggestion.',
  ] },
  { id: 'boomerang', name: { fr: 'Retour des mots', en: 'Word boomerang' }, phrases: [
    'Les mots reviennent toujours.', 'Words always come back.', 'Words always return.',
  ] },
  { id: 'vertigo', name: { fr: 'Vertige typographique', en: 'Typographic vertigo' }, phrases: [
    'Les mots ont le vertige.', 'Words are feeling dizzy.', 'Words have vertigo.',
  ] },
  { id: 'tunnel', name: { fr: 'De l’autre côté des lettres', en: 'Beyond the letters' }, phrases: [
    'Il y a un monde derrière les lettres.', 'There is a world behind the letters.', "There's a world behind the letters.",
  ] },
  { id: 'supernova', name: { fr: 'Supernova', en: 'Supernova' }, phrases: [
    'Une petite phrase peut devenir une supernova.', 'A little sentence can become a supernova.', 'A small sentence can become a supernova.',
  ] },
  { id: 'seventh-face', name: { fr: 'La septième face', en: 'The seventh face' }, phrases: [
    'Même le hasard cache quelque chose.', 'Even chance is hiding something.', 'Even randomness hides something.',
  ] },
];

function normalizePhrase(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[’‘ʼ]/gu, "'").replace(/\s+/gu, ' ').trim()
    .replace(/[\s.!?…,:;]+$/u, '');
}

const phraseIndex = new Map(films.flatMap(film => film.phrases.map(phrase => [normalizePhrase(phrase), film] as const)));

/** A whole secret phrase unlocks a film; ordinary mentions remain ordinary text. */
export function findSecretFilm(text: string): { id: SecretFilmId; name: { fr: string; en: string } } | null {
  const film = phraseIndex.get(normalizePhrase(text));
  return film ? { id: film.id, name: { ...film.name } } : null;
}

function add(point: Vec3, x = 0, y = 0, z = 0): Vec3 {
  return [point[0] + x, point[1] + y, point[2] + z];
}

function mix(a: Vec3, b: Vec3, amount: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

/** Size gestures in the portrait frame, rather than in arbitrary world units. */
function frameSize(object: SceneObject, index: number, spec: SceneSpec, poster = false) {
  const track = spec.cameraTracks.find(track => track.id === (poster ? 'poster' : `read-${index}`));
  const p = poster ? object.assembly?.position ?? object.position : object.position;
  const distance = Math.max(6, (track?.to.position[2] ?? p[2] + 18) - p[2]);
  const height = distance * Math.tan(spec.fov * Math.PI / 360);
  return { distance, height, width: height * spec.aspect };
}

function secretEntrance(object: SceneObject, index: number, spec: SceneSpec, id: SecretFilmId): SceneObject['entrance'] {
  if (!object.entrance) return undefined;
  const original = object.entrance;
  const p = object.position;
  const side = (index % 2 ? -1 : 1) * (spec.directionStyle?.handedness ?? 1);
  const { distance: d, width: w, height: h } = frameSize(object, index, spec);
  const start = index === 0 ? original.start : Math.max(original.start, spec.objects[index - 1]?.readingInterval[1] ?? original.start);
  const end = object.readingInterval[0];
  if (end <= start) return original;
  const point = (at: number, x: number, y: number, z: number, turn: number, scale: number): MotionKeyframe => ({
    at, position: add(p, x, y, z), rotation: [0, 0, turn], scale: object.scale * scale,
  });
  let keyframes: MotionKeyframe[];
  switch (id) {
    case 'gravity':
      keyframes = [point(.16, side * w * .1, -h * .36, -d * .45, -side * .2, .68),
        point(.5, -side * w * .08, h * .14, -d * .15, side * .15, .86),
        point(.8, 0, -h * .04, 0, -side * .04, .98)];
      break;
    case 'boomerang':
      keyframes = [point(.16, -side * w * .32, h * .08, -d * .35, -side * .3, .58),
        point(.44, side * w * .32, h * .03, -d * .12, side * .24, .7),
        point(.72, -side * w * .12, -h * .03, -d * .05, -side * .1, .88)];
      break;
    case 'vertigo':
      keyframes = [point(.16, 0, 0, -d * .5, side * Math.PI * 1.5, .5),
        point(.5, 0, 0, -d * .3, side * Math.PI * .65, .58),
        point(.82, 0, 0, -d * .06, side * .15, .88)];
      break;
    case 'tunnel':
      keyframes = [point(.16, 0, 0, -d * 1.8, 0, .6),
        point(.5, 0, 0, -d * .65, 0, .8), point(.8, 0, 0, -d * .12, 0, 1)];
      break;
    case 'supernova':
      keyframes = [point(.16, 0, 0, -d * .6, 0, .18),
        point(.38, 0, 0, -d * .3, 0, .26),
        point(.7, 0, 0, -d * .1, -side * .08, 1.06)];
      break;
    case 'seventh-face':
      keyframes = [point(.16, -side * w * .16, h * .18, -d * .35, side * Math.PI * 2 / 7, .58),
        point(.5, side * w * .16, -h * .1, -d * .12, -side * Math.PI / 7, .76),
        point(.78, -side * w * .05, h * .02, -d * .05, side * .14, .9)];
      break;
  }
  // Only the initial plane is behind the opening camera. The first visible beat
  // is small and inside the frame; subsequent beats have time to be seen.
  // Cross the lens at zero scale to avoid a one-frame wall of oversized letters.
  return { ...original, start, end, rotation: [0, 0, 0], scale: 0,
    controls: undefined, keyframes: [point(.08, 0, 0, -d * .8, 0, 0), ...keyframes], easing: 'smooth' };
}

function secretExit(object: SceneObject, index: number, spec: SceneSpec, id: SecretFilmId): SceneObject['exit'] {
  if (!object.exit) return undefined;
  const original = object.exit;
  const p = object.assembly?.position ?? object.position;
  const scale = object.assembly?.scale ?? object.scale;
  const side = (index % 2 ? -1 : 1) * (spec.directionStyle?.handedness ?? 1);
  const { distance: d, width: w, height: h } = frameSize(object, index, spec, true);
  const point = (at: number, position: Vec3, turn: number, size = 1): MotionKeyframe => ({
    at, position, rotation: [0, 0, turn], scale: scale * size,
  });
  // A long poster can keep scanning after its opening hold. Preserve the real
  // departure boundary so the secret gesture cannot interrupt that reading.
  const start = Math.min(...spec.objects.flatMap(object => object.exit ? [object.exit.start] : []));
  const cameraY = spec.cameraTracks.at(-1)?.to.position[1] ?? 0;
  const relativeY = p[1] - cameraY;
  let keyframes: MotionKeyframe[];
  switch (id) {
    case 'gravity':
      keyframes = [point(.22, add(p, side * w * .06, h * .1), side * .08, .96),
        point(.55, add(p, -side * w * .08, h * .24, -d * .06), -side * .12, .82),
        point(.78, add(p, 0, h * .4, -d * .12), side * .18, .58)];
      break;
    case 'boomerang':
      keyframes = [point(.24, add(p, side * w * .24, h * .04, -d * .08), side * .22, .8),
        point(.5, add(p, -side * w * .24, -h * .04, -d * .08), -side * .22, .8),
        point(.74, p, 0)];
      break;
    case 'vertigo': {
      const orbit = (angle: number): Vec3 => [p[0] * Math.cos(angle) - relativeY * Math.sin(angle),
        cameraY + p[0] * Math.sin(angle) + relativeY * Math.cos(angle), p[2] - d * .2];
      keyframes = [point(.22, orbit(side * Math.PI * .4), side * Math.PI * .4, .62),
        point(.52, orbit(side * Math.PI * 1.6), side * Math.PI * 1.6, .62),
        point(.76, p, side * Math.PI * 2, .75)];
      break;
    }
    case 'tunnel':
      keyframes = [point(.3, [p[0] * .65, cameraY + relativeY * .65, p[2] - d * .35], 0, .8),
        point(.65, [p[0] * .2, cameraY + relativeY * .2, p[2] - d * .7], 0, .55),
        point(.8, [p[0] * .1, cameraY + relativeY * .1, p[2] - d * .8], 0, .4)];
      break;
    case 'supernova': {
      const angle = index * Math.PI * 2 / spec.objects.length + (spec.seed % 7) * Math.PI / 7;
      keyframes = [point(.24, [p[0] * .55, cameraY + relativeY * .55, p[2] - d * .14], 0, .36),
        point(.44, [p[0] * .25, cameraY + relativeY * .25, p[2] - d * .18], 0, .25),
        point(.76, add(p, Math.cos(angle) * w * .3, Math.sin(angle) * h * .22), side * .2, .85)];
      break;
    }
    case 'seventh-face':
      keyframes = Array.from({ length: 7 }, (_, step) => {
        const angle = side * (step + 1) * Math.PI * 2 / 7;
        return { ...point((step + 1) * .1, add(p, Math.sin(angle) * w * .14, (Math.cos(angle) - 1) * h * .08, -d * .15),
          angle, .62), easing: 'linear' as const };
      });
      break;
  }
  // The visible gesture completes before the final rush through the lens. Its
  // terminal plane remains safely behind the camera for looping/photo endings.
  const turn = id === 'vertigo' || id === 'seventh-face' ? side * Math.PI * 2 : 0;
  return { ...original, start, to: [p[0], p[1], original.to[2]], rotation: [0, 0, turn],
    scale, controls: undefined, keyframes, easing: 'cinematic' };
}

function secretTrack(track: CameraTrack, spec: SceneSpec, id: SecretFilmId): CameraTrack {
  if (track.primitive === 'HOLD' || track.primitive === 'CUT' || track.primitive === 'PORTAL') return track;
  const direction = spec.directionStyle?.handedness ?? 1;
  // Keep endpoint poses and portal crossings: flourishes always settle into
  // the existing reading shot, without throwing the camera out of the frame.
  const base = { ...track, rollTurns: undefined };
  const distance = Math.max(8, track.to.position[2] - track.to.target[2]);
  const h = distance * Math.tan(spec.fov * Math.PI / 360);
  const w = h * spec.aspect;
  if (id === 'gravity' && track.id === 'impact') return {
    ...base, easing: 'smooth', impact: undefined, trackTarget: true,
    controls: [add(mix(track.from.position, track.to.position, .3), -direction * w * .08, h * .12),
      add(mix(track.from.position, track.to.position, .7), direction * w * .06, -h * .06)],
  };
  if (id === 'boomerang' && track.id === 'reveal-flight') return {
    ...base, controls: [add(mix(track.from.position, track.to.position, .3), direction * w * .18, h * .04, 2),
      add(mix(track.from.position, track.to.position, .7), -direction * w * .18, -h * .04, 2)],
  };
  if (id === 'vertigo' && track.id === 'reveal-flight') return {
    ...base, rollTurns: direction,
    controls: [add(mix(track.from.position, track.to.position, .3), 0, 0, 2),
      add(mix(track.from.position, track.to.position, .7), 0, 0, 2)],
  };
  if (id === 'tunnel' && track.id.startsWith('travel-')) return { ...base, primitive: 'TUNNEL' };
  if (id === 'supernova' && track.id.startsWith('finale-')) return {
    ...base, impact: { start: track.start, end: Math.min(track.end, track.start + .3),
      displacement: [0, 0, -.4], rotation: [direction * .012, 0, direction * .02] },
  };
  if (id === 'seventh-face' && track.id === 'reveal-flight') return {
    ...base, controls: [add(mix(track.from.position, track.to.position, .3), direction * w * .12, -h * .08, 2),
      add(mix(track.from.position, track.to.position, .7), -direction * w * .12, h * .08, 2)],
  };
  return base;
}

/** Transform serializable choreography once; export and seeking share the effect. */
export function applySecretFilm(spec: SceneSpec): SceneSpec {
  const film = findSecretFilm(spec.sourceText);
  if (!film || spec.secretFilm === film.id) return spec;
  const objects = spec.objects.map((object, index): SceneObject => ({
    ...object,
    entrance: secretEntrance(object, index, spec, film.id),
    exit: secretExit(object, index, spec, film.id),
    ...(film.id === 'seventh-face' ? { colorRole: index % 2 ? 'white' : 'violet' } : {}),
    ...(film.id === 'supernova' && object.impact ? {
      impact: { ...object.impact, displacement: [0, 0, 0.85], rotation: [0, 0, index % 2 ? 0.055 : -0.055], scale: 0.24 },
    } : {}),
  }));
  return {
    ...spec, generatorVersion: `${spec.generatorVersion}+secrets-2`, secretFilm: film.id, objects,
    cameraTracks: spec.cameraTracks.map(track => secretTrack(track, spec, film.id)),
    ...(spec.directionStyle ? { directionStyle: {
      ...spec.directionStyle,
      entry: `${film.id}:${spec.directionStyle.entry}`,
      transition: `${film.id}:${spec.directionStyle.transition}`,
      finale: `${film.id}:${spec.directionStyle.finale}`,
    } } : {}),
  };
}
