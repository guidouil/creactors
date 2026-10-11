import type { CameraPose, CameraTrack, SceneSpec } from '../scene/types';

export const FUTURE_QUOTE = "Le futur n'est pas ce qui nous attend. C'est ce que nous créons.";
export const FUTURE_POSTER_TIME = 10;

const opening: CameraPose = { position: [1.2, 3.0, 5.5], target: [-0.3, 2.8, 0], roll: -0.11 };
const future: CameraPose = { position: [-0.05, 2.8, 11.9], target: [-0.3, 2.8, 0], roll: -0.012 };
const negation: CameraPose = { position: [7.5, 5, 3.9], target: [6.6, 5, -6], roll: 0.018 };
const awaiting: CameraPose = { position: [-9.8, -13.5, 4.8], target: [-10, -13.5, -13], roll: 0 };
const turn: CameraPose = { position: [-7.35, -3.6, 8.4], target: [-8, -3.6, -4], roll: -0.025 };
const create: CameraPose = { position: [5.3, -8, 21.2], target: [6.5, -8, 3], roll: 0.015 };
const finale: CameraPose = { position: [0, 0, 24.5], target: [0, 0, 0], roll: 0 };

const tracks: readonly CameraTrack[] = [
  {
    id: 'opening-impact', start: 0, end: 0.65, primitive: 'DEPTH',
    from: opening, to: future, easing: 'cinematic',
    controls: [[1.05, 3.4, 7.5], [-0.35, 3.0, 11.65]],
  },
  { id: 'read-future', start: 0.65, end: 1.6, primitive: 'HOLD', from: future, to: future, easing: 'linear' },
  {
    id: 'descend-negation', start: 1.6, end: 2.2, primitive: 'DEPTH', from: future, to: negation, easing: 'cinematic',
    controls: [[2.8, 3.0, 11.5], [7.0, 4.8, 5.8]],
  },
  { id: 'read-negation', start: 2.2, end: 3.15, primitive: 'HOLD', from: negation, to: negation, easing: 'linear' },
  {
    id: 'travel-awaiting', start: 3.15, end: 3.5, primitive: 'DEPTH', from: negation, to: awaiting, easing: 'cinematic',
    controls: [[5.7, -2.4, 4.0], [-6.1, -11.2, 4.6]],
  },
  { id: 'read-awaiting', start: 3.5, end: 4.6, primitive: 'HOLD', from: awaiting, to: awaiting, easing: 'linear' },
  {
    // One uninterrupted rise carries the coral phrase out below the frame
    // while the white phrase enters from above and settles into its reading hold.
    id: 'sentence-turn', start: 4.6, end: 5.45, primitive: 'DEPTH', from: awaiting, to: turn, easing: 'cinematic',
    controls: [[-10.2, -9.7, 5.3], [-10, -3.75, 6.7]],
  },
  { id: 'read-turn', start: 5.45, end: 6.4, primitive: 'HOLD', from: turn, to: turn, easing: 'linear' },
  {
    id: 'orbit-creators', start: 6.4, end: 7.1, primitive: 'ORBIT', from: turn, to: create, easing: 'cinematic',
    controls: [[-4.8, -4.3, 12.4], [2.5, -6.8, 20.4]],
  },
  { id: 'read-creators', start: 7.1, end: 8.5, primitive: 'HOLD', from: create, to: create, easing: 'linear' },
  {
    id: 'reveal-world', start: 8.5, end: 9.8, primitive: 'REVEAL', from: create, to: finale, easing: 'cinematic',
    controls: [[4.9, -6.5, 22.8], [0.7, -0.8, 24.2]],
  },
  { id: 'final-composition', start: 9.8, end: 10.2, primitive: 'HOLD', from: finale, to: finale, easing: 'linear' },
  { id: 'rush-to-screen', start: 10.2, end: 10.95, primitive: 'DEPTH', from: finale, to: finale, easing: 'linear' },
  { id: 'loop-seam', start: 10.95, end: 11.1, primitive: 'HOLD', from: finale, to: finale, easing: 'linear' },
];

/**
 * The camera visits a permanent world of words. During the final reveal, the
 * same physical objects assemble into a poster then rush behind the camera.
 * The matching empty opening/ending use real spatial travel, without a fade.
 */
export const futureDemo: SceneSpec = {
  id: 'future-authored-v5',
  generatorVersion: 'authored-1.4.0',
  fontVersion: 'barlow-condensed-black-1',
  sourceText: FUTURE_QUOTE,
  inputLanguage: 'fr',
  themeId: 'califormandy-sunset',
  seed: 20261009,
  duration: 11.1,
  posterTime: FUTURE_POSTER_TIME,
  fps: 30,
  aspect: 9 / 16,
  fov: 38,
  objects: [
    {
      id: 'future', text: 'Le futur', displayText: 'Le\nfutur', fontSize: 1.8, position: [-0.3, 2.8, 0],
      rotation: [0, -0.08, -0.018], scale: 1, colorRole: 'pink', extruded: true,
      extrusionDepth: 0.22, readingInterval: [0.65, 1.6],
      entrance: { start: 0.1, end: 0.4, from: [-0.3, 2.8, 16], easing: 'cinematic' },
      assembly: { start: 8.5, end: 9.8, position: [-1.8, 4.1, 0], rotation: [0, 0, 0], scale: 0.68, easing: 'cinematic' },
      exit: { start: 10.22, end: 10.87, to: [-1.8, 4.1, 40], easing: 'accelerate' },
    },
    {
      id: 'negation', text: "n'est pas", displayText: "n'est\npas", fontSize: 1.5, position: [6.6, 5, -6],
      rotation: [0, 0.055, 0.018], scale: 1, colorRole: 'white', extruded: false,
      extrusionDepth: 0, readingInterval: [2.2, 3.15],
      assembly: { start: 8.5, end: 9.8, position: [1.6, 2.4, 0.4], rotation: [0, 0, 0], scale: 0.68, easing: 'cinematic' },
      exit: { start: 10.24, end: 10.9, to: [1.6, 2.4, 40], easing: 'accelerate' },
    },
    {
      id: 'awaiting', text: 'ce qui nous attend.', displayText: 'ce qui\nnous attend.', fontSize: 1.15, position: [-10, -13.5, -13],
      rotation: [0, -0.025, -0.009], scale: 1, colorRole: 'coral', extruded: false,
      extrusionDepth: 0, readingInterval: [3.5, 4.6],
      assembly: { start: 8.5, end: 9.8, position: [-0.2, 0, -0.6], rotation: [0, 0, 0], scale: 1.05, easing: 'cinematic' },
      exit: { start: 10.26, end: 10.92, to: [-0.2, 0, 40], easing: 'accelerate' },
    },
    {
      id: 'turn', text: "C'est ce que", displayText: "C'est\nce que", fontSize: 1.45, position: [-8, -3.6, -4],
      rotation: [0, 0.06, -0.014], scale: 1, colorRole: 'white', extruded: false,
      extrusionDepth: 0, readingInterval: [5.45, 6.4],
      assembly: { start: 8.5, end: 9.8, position: [-1.9, -2.7, 0.6], rotation: [0, 0, 0], scale: 0.64, easing: 'cinematic' },
      exit: { start: 10.2, end: 10.85, to: [-1.9, -2.7, 40], easing: 'accelerate' },
    },
    {
      id: 'creators', text: 'nous créons.', displayText: 'nous\ncréons.', fontSize: 1.85, position: [6.5, -8, 3],
      rotation: [0, -0.05, 0.012], scale: 1, colorRole: 'cyan', extruded: true,
      extrusionDepth: 0.24, readingInterval: [7.1, 8.5],
      assembly: { start: 8.5, end: 9.8, position: [1.55, -3.9, 1.2], rotation: [0, 0, 0], scale: 0.68, easing: 'cinematic' },
      exit: { start: 10.28, end: 10.95, to: [1.55, -3.9, 40], easing: 'accelerate' },
    },
  ],
  cameraTracks: tracks,
  chapters: [
    { time: 0, objectId: 'future', primitive: 'DEPTH' },
    { time: 1.6, objectId: 'negation', primitive: 'DEPTH' },
    { time: 3.15, objectId: 'awaiting', primitive: 'DEPTH' },
    { time: 4.6, objectId: 'turn', primitive: 'DEPTH' },
    { time: 6.4, objectId: 'creators', primitive: 'ORBIT' },
    { time: 8.5, objectId: null, primitive: 'REVEAL' },
    { time: 9.8, objectId: null, primitive: 'HOLD' },
    { time: 10.2, objectId: null, primitive: 'DEPTH' },
    { time: 10.95, objectId: null, primitive: 'HOLD' },
  ],
};
