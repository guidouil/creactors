import type { CameraTrack, SceneObject, SceneSpec, Vec3 } from '../scene/types';

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

function secretEntrance(object: SceneObject, index: number, spec: SceneSpec, id: SecretFilmId): SceneObject['entrance'] {
  if (!object.entrance) return undefined;
  const original = object.entrance;
  const p = object.position;
  const side = (index % 2 ? -1 : 1) * (spec.directionStyle?.handedness ?? 1);
  // Keep every starting plane behind the opening camera. Later words perform
  // their arrival immediately before their own hold, instead of off screen.
  const previous = spec.objects[index - 1];
  const start = index === 0 ? original.start : Math.max(original.start, previous?.readingInterval[1] ?? original.start);
  const end = object.readingInterval[0];
  if (end <= start) return original;
  const base = { ...original, start, end };
  switch (id) {
    case 'gravity': return {
      ...base, from: add(original.from, -side * 8, 10), rotation: [side * 0.55, -side * 0.3, side * 1.65], scale: 0.64, easing: 'smooth',
      controls: [add(original.from, side * 8, 13, -8), add(p, -side * 3, -2, 5)],
    };
    case 'boomerang': return {
      ...base, from: add(original.from, -side * 18, 1), rotation: [0.15, side * 0.5, -side * 0.85], scale: 0.85, easing: 'smooth',
      controls: [add(p, side * 22, 4, 11), add(p, -side * 10, -2, 4)],
    };
    case 'vertigo': return {
      ...base, from: add(original.from, side * 4, 4), rotation: [side * 0.4, -side * 0.65, side * Math.PI * 2], scale: 0.5,
      controls: [add(p, -side * 9, 8, 18), add(p, side * 6, -4, 6)],
    };
    case 'tunnel': return {
      ...base, from: add(original.from, 0, 0, 28), rotation: [0, side * 0.3, 0], scale: 0.34,
      controls: [add(p, -side * 2, 0, -48), add(p, side * 1, 0, -16)],
    };
    case 'supernova': return {
      ...base, from: add(original.from, side * 12, -7), rotation: [0, side * 0.6, side * 0.45], scale: 0.22, easing: 'accelerate',
      controls: [add(original.from, -side * 5, 3, -12), add(p, side * 2, -1, 3)],
    };
    case 'seventh-face': return {
      ...base, from: add(original.from, side * 7, 7), rotation: [side * Math.PI / 7, side * Math.PI * 2 / 7, side * Math.PI * 2], scale: 0.7,
      controls: [add(p, side * 14, -7, 21), add(p, -side * 7, 4, 7)],
    };
  }
}

function secretExit(object: SceneObject, index: number, spec: SceneSpec, id: SecretFilmId): SceneObject['exit'] {
  if (!object.exit) return undefined;
  const original = object.exit;
  const p = object.assembly?.position ?? object.position;
  const scale = object.assembly?.scale ?? object.scale;
  const side = (index % 2 ? -1 : 1) * (spec.directionStyle?.handedness ?? 1);
  const span = original.to[2] - p[2];
  // Preserve the safe terminal depth and original exit window: the loop remains
  // empty and optional final photographs can use the existing spatial handoff.
  switch (id) {
    case 'gravity': return {
      ...original, to: [p[0] + side * 10, p[1] + 16, original.to[2]], rotation: [side * 0.4, 0.2, side * 1.5], scale, easing: 'accelerate',
      controls: [add(p, side * 3, 4, span * 0.06), add(p, -side * 4, 10, span * 0.24)],
    };
    case 'boomerang': return {
      ...original, to: [p[0] + side * 4, p[1], original.to[2]], rotation: [0, side * 0.35, side * Math.PI], scale, easing: 'smooth',
      controls: [add(p, side * 19, 5, span * 0.04), add(p, -side * 14, -4, span * 0.2)],
    };
    case 'vertigo': return {
      ...original, rotation: [side * 0.6, -side * 0.4, side * Math.PI * 4], scale: scale * 1.05,
      controls: [add(p, -side * 6, 5, span * 0.12), add(p, side * 6, -5, span * 0.48)],
    };
    case 'tunnel': return {
      ...original, to: [p[0] * 0.2, p[1] * 0.2, original.to[2]], rotation: [0, 0, 0], scale, easing: 'accelerate',
      controls: [add(p, 0, 0, -Math.min(8, span * 0.1)), [p[0] * 0.35, p[1] * 0.35, p[2] + span * 0.25]],
    };
    case 'supernova': {
      const angle = index * 2.399963 + (spec.seed % 7) * Math.PI / 7;
      const x = Math.cos(angle) * (11 + index * 2);
      const y = Math.sin(angle) * (11 + index * 2);
      return {
        ...original, to: [p[0] + x * 1.8, p[1] + y * 1.8, original.to[2]], rotation: [Math.sin(angle) * 0.7, Math.cos(angle) * 0.7, side * 1.2], scale: scale * 1.16, easing: 'accelerate',
        controls: [add(p, -x * 0.06, -y * 0.06, -0.5), add(p, x, y, span * 0.25)],
      };
    }
    case 'seventh-face': {
      const angle = (index + 1) * Math.PI * 2 / 7;
      return {
        ...original, to: [p[0] + Math.cos(angle) * 14, p[1] + Math.sin(angle) * 14, original.to[2]],
        rotation: [side * Math.PI / 7, side * Math.PI * 2 / 7, side * Math.PI * 2], scale: scale * 1.07,
        controls: [add(p, Math.cos(angle) * 7, Math.sin(angle) * 7, span * 0.09), add(p, Math.cos(angle + Math.PI * 2 / 7) * 14, Math.sin(angle + Math.PI * 2 / 7) * 14, span * 0.4)],
      };
    }
  }
}

function secretTrack(track: CameraTrack, spec: SceneSpec, id: SecretFilmId): CameraTrack {
  if (track.primitive === 'HOLD' || track.primitive === 'CUT' || track.primitive === 'PORTAL') return track;
  const direction = spec.directionStyle?.handedness ?? 1;
  // Endpoint poses never move: authored reading frames, continuity and poster
  // framing remain valid. All flourishes settle at the existing boundaries.
  const base = { ...track, rollTurns: undefined };
  if (id === 'gravity' && track.id === 'impact') return {
    ...base, easing: 'smooth', impact: undefined, trackTarget: true,
    controls: [add(track.from.position, -direction * 3, 2, 2), add(track.to.position, direction * 2, -2, 1)],
  };
  if (id === 'boomerang' && track.id === 'reveal-flight') return {
    ...base, controls: [add(mix(track.from.position, track.to.position, 0.25), direction * 7, 2, 5), add(mix(track.from.position, track.to.position, 0.75), -direction * 7, -2, 5)],
  };
  if (id === 'vertigo' && track.id === 'reveal-flight') return { ...base, rollTurns: direction };
  if (id === 'tunnel' && (track.id.startsWith('travel-') || track.id === 'impact')) {
    const nearDepth = Math.max(track.from.target[2], track.to.target[2]) + 8;
    const first = mix(track.from.position, track.to.position, 0.32);
    const second = mix(track.from.position, track.to.position, 0.68);
    return {
      ...base, primitive: 'TUNNEL', trackTarget: true,
      controls: [[first[0], first[1], nearDepth], [second[0], second[1], nearDepth]],
    };
  }
  if (id === 'supernova' && track.id.startsWith('finale-')) return {
    ...base, impact: { start: track.start, end: Math.min(track.end, track.start + 0.3), displacement: [0, 0, -1.2], rotation: [direction * 0.025, 0, direction * 0.045] },
  };
  if (id === 'seventh-face' && track.id === 'reveal-flight') return {
    ...base, controls: [add(track.from.position, direction * 7, -7, 7), add(track.to.position, -direction * 7, 7, 7)],
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
    ...spec, generatorVersion: `${spec.generatorVersion}+secrets-1`, secretFilm: film.id, objects,
    cameraTracks: spec.cameraTracks.map(track => secretTrack(track, spec, film.id)),
    ...(spec.directionStyle ? { directionStyle: {
      ...spec.directionStyle,
      entry: `${film.id}:${spec.directionStyle.entry}`,
      transition: `${film.id}:${spec.directionStyle.transition}`,
      finale: `${film.id}:${spec.directionStyle.finale}`,
    } } : {}),
  };
}
