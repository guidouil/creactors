import { FUTURE_QUOTE, futureDemo } from '../demos/future';
import type { CameraPose, CameraTrack, ColorRole, SceneObject, SceneSpec, Vec3 } from '../scene/types';
import type { TextAnalysis } from '../text/director';
import { groupWidthLimit, type MeasuredGroup } from '../typography/measure';
import { emojiCoverage } from '../typography/emoji';
import { DEFAULT_FONT_ID, getDisplayFont } from '../typography/fonts';
import { applySecretFilm } from './secrets';
import { filmAspect, type FilmFormat } from '../scene/format';

const GENERATOR_VERSION = 'spatial-grammar-2.3.2';
const FPS = 30;
const FOV = 38;
const POSTER_REFERENCE_WIDTH = 360;
const MIN_POSTER_CAP_PIXELS = 24;
// NDC safe bounds [-0.64, 0.76]: 18% below and 12% above the lettering.
const POSTER_SAFE_HEIGHT = 0.70;
const POSTER_SAFE_CENTER = 0.06;
const HALF_ANGLE = Math.tan(FOV * Math.PI / 360);
const NEAR_PLANE = 0.05;
const frameTime = (time: number) => Math.round(time * FPS) / FPS;
type DirectionStyle = NonNullable<SceneSpec['directionStyle']>;

export const DIRECTION_STYLES = {
  layout: ['switchback', 'helix', 'ascent', 'horizon', 'terraces', 'constellation', 'staircase', 'ribbon'],
  entry: ['depth-dive', 'side-hook', 'rise', 'tumble', 'corkscrew'],
  transition: ['sweeping-arc', 'wide-orbit', 'whip', 'barrel-roll', 'vault', 'pendulum'],
  reveal: ['pullback', 'spiral', 'swing', 'slam'],
  finale: ['straight-rush', 'vortex', 'staggered-punch', 'fan-out', 'converging-slam'],
} as const;

function pick<T>(values: readonly T[], random: () => number): T { return values[Math.floor(random() * values.length)]!; }

function colorRoles(count: number, random: () => number): ColorRole[] {
  const palette: ColorRole[] = ['pink', 'white', 'coral', 'cyan'];
  for (let index = palette.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [palette[index], palette[other]] = [palette[other]!, palette[index]!];
  }
  // Vary both the palette size and its dominant ink. Random draws belong only
  // to the color stream; a new palette never changes the camera choreography.
  const paletteSize = count < 3 ? 2 : random() < 0.2 ? 2 : random() < 0.5 ? 3 : 4;
  const active = palette.slice(0, paletteSize);
  const weights = active.map((_, index) => index === 0 ? 1.4 + random() * 2 : 0.65 + random() * 1.2);
  const assigned: ColorRole[] = [];
  for (let index = 0; index < count; index++) {
    const candidates = active.filter(role => role !== assigned[index - 1]);
    // The conclusion is free to take any available ink. Its physical emphasis
    // remains semantic, instead of always ending with a prescribed cyan word.
    const candidateWeights = candidates.map(role => index === count - 1 ? 1 : weights[active.indexOf(role)]!);
    let choice = random() * candidateWeights.reduce((sum, weight) => sum + weight, 0);
    let chosen = candidates[candidates.length - 1]!;
    for (let candidate = 0; candidate < candidates.length; candidate++) {
      choice -= candidateWeights[candidate]!;
      if (choice < 0) { chosen = candidates[candidate]!; break; }
    }
    assigned.push(chosen);
  }
  return assigned;
}

export class TooLongTextError extends RangeError {
  readonly requiredDuration: number;
  constructor(requiredDuration: number) {
    super('This text needs more than 60 seconds. Please use a shorter passage.');
    this.name = 'TooLongTextError';
    this.requiredDuration = requiredDuration;
  }
}

export function stableSeed(text: string): number {
  if (text === FUTURE_QUOTE) return futureDemo.seed;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function stream(seed: number, name: string): () => number {
  let state = (seed ^ stableSeed(name)) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function nextRemixSeed(text: string, currentSeed: number): number {
  // Reproducible remix succession; no time, UI locale or hidden global state.
  return (Math.imul(currentSeed ^ stableSeed(text) ^ 0x9E3779B9, 1664525) + 1013904223) >>> 0;
}

export function sceneSignature(spec: SceneSpec): string {
  // Color alone cannot satisfy the remix variation check.
  return JSON.stringify({
    generator: spec.generatorVersion,
    ...(spec.secretFilm ? { secretFilm: spec.secretFilm } : {}),
    styles: spec.directionStyle,
    placements: spec.objects.map(object => object.position.map(value => Math.round(value * 2) / 2)),
    rotations: spec.objects.map(object => object.rotation.map(value => Math.round(value * 100) / 100)),
    arrivals: spec.objects.map(object => [object.entrance?.rotation, object.entrance?.scale, object.entrance?.keyframes]),
    finales: spec.objects.map(object => [object.exit?.rotation, object.exit?.controls?.map(point => point.map(value => Math.round(value))), object.exit?.scale, object.exit?.keyframes]),
    shots: spec.cameraTracks.filter(track => track.primitive !== 'HOLD').map(track => [track.primitive, track.cutBefore ?? false, track.rollTurns ?? 0, track.trackTarget ?? false, track.focusObjectId, Math.round(track.to.roll * 100) / 100, track.to.position.map(value => Math.round(value)), track.controls?.map(point => point.map(value => Math.round(value)))]),
  });
}

function distanceToFit(group: MeasuredGroup, fontSize: number, aspect: number, scale = 1): number {
  // Conservative symmetric vertical fit also respects the larger bottom margin.
  return Math.max(
    group.width * fontSize * scale / (2 * HALF_ANGLE * aspect * 0.78),
    group.height * fontSize * scale / (2 * HALF_ANGLE * 0.60),
    fontSize * 5,
  );
}

function opticalFontSize(group: MeasuredGroup, format: FilmFormat): number {
  // Match the default font's cap height, then fit unusually wide/tall groups.
  // The camera still checks both dimensions, including rotation and margins.
  return 1.65 * Math.min(1, 0.7 / Math.max(0.7, group.capHeight), groupWidthLimit(format) / group.width, 4 / group.height);
}

function readingPose(object: SceneObject, measured: MeasuredGroup, layoutRandom: () => number, aspect: number): CameraPose {
  const angle = Math.abs(object.rotation[2]);
  const framed = {
    ...measured,
    width: Math.cos(angle) * measured.width + Math.sin(angle) * measured.height,
    height: Math.cos(angle) * measured.height + Math.sin(angle) * measured.width,
  };
  const distance = distanceToFit(framed, object.fontSize, aspect) * 1.025;
  const yaw = (layoutRandom() - 0.5) * 0.065;
  return {
    position: [object.position[0] + distance * yaw, object.position[1] + distance * 0.008, object.position[2] + distance],
    target: object.position,
    roll: (layoutRandom() - 0.5) * 0.035,
  };
}

function travelControls(from: CameraPose, to: CameraPose, direction: number): readonly [Vec3, Vec3] {
  const a = from.position; const b = to.position;
  const offset = Math.min(3.2, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12) * direction;
  return [
    [a[0] * 0.72 + b[0] * 0.28 + offset, a[1] * 0.78 + b[1] * 0.22, a[2] * 0.7 + b[2] * 0.3 + 1.5],
    [a[0] * 0.22 + b[0] * 0.78 + offset, a[1] * 0.22 + b[1] * 0.78, a[2] * 0.3 + b[2] * 0.7 + 1.5],
  ];
}

interface PosterPlacement { position: Vec3; scale: number }

function poster(measured: readonly MeasuredGroup[], objects: readonly SceneObject[], variant: number, format: FilmFormat) {
  const aspect = filmAspect(format);
  const placements: PosterPlacement[] = [];
  const scale = 0.72;
  // Portal eligibility can enlarge a hero in its reading shot. Restore the
  // common optical size when the permanent objects assemble into the poster.
  const scales = objects.map((object, index) => scale * opticalFontSize(measured[index]!, format) / object.fontSize);
  const heights = measured.map((group, index) => group.inkHeight * objects[index]!.fontSize * scales[index]!);
  const gap = 0.58;
  const inkHeight = heights.reduce((sum, value) => sum + value, 0) + gap * (heights.length - 1);
  const largestWidth = Math.max(...measured.map((group, index) => group.width * objects[index]!.fontSize * scales[index]!));
  let cursor = inkHeight / 2;
  let width = 0;
  for (let index = 0; index < objects.length; index++) {
    const textWidth = measured[index]!.width * objects[index]!.fontSize * scales[index]!;
    // Longer square lines align inside the same width, preserving their size
    // rather than spending the extra horizontal room on outward staggering.
    const stagger = format === 'square' ? (largestWidth - textWidth) / 2 : Math.min(1.25, textWidth * 0.16);
    const x = objects.length === 1 || variant === 2 ? 0 : variant === 3 ? (largestWidth - textWidth) / 2 : (index % 2 ? 1 : -1) * stagger * (variant === 1 ? -1 : 1);
    const y = cursor - heights[index]! / 2;
    placements[index] = { position: [x, y, 0], scale: scales[index]! };
    width = Math.max(width, textWidth + Math.abs(x) * 2);
    cursor -= heights[index]! + gap;
  }
  // Keep compact ink spacing, but frame the full rendered footprint: SDF
  // blocks include font ascenders/descenders; extrusions also include bevels.
  const framingHeights = measured.map((group, index) => (objects[index]!.extruded ? group.inkHeight + 0.016 : Math.max(group.height, group.inkHeight)) * objects[index]!.fontSize * scales[index]!);
  const top = Math.max(...placements.map((placement, index) => placement.position[1] + framingHeights[index]! / 2));
  const bottom = Math.min(...placements.map((placement, index) => placement.position[1] - framingHeights[index]! / 2));
  const totalHeight = top - bottom;
  const center = (top + bottom) / 2;
  for (const placement of placements) placement.position = [placement.position[0], placement.position[1] - center, placement.position[2]];
  const frontDepth = Math.max(...objects.map((object, index) => object.extruded ? object.extrusionDepth * scales[index]! / 2 + 0.008 * object.fontSize * scales[index]! : 0));
  // First try fitting the complete stack. A small pullback often fits a short
  // quotation without needing a pan; keep capitals readable on a 360px phone.
  // The shorter square frame needs less extra depth beyond the safe margins;
  // retain the same capital size at a common 360px displayed width.
  const depthPadding = format === 'square' ? 0.3 : 0.6;
  const phraseDistance = Math.max(width / (2 * HALF_ANGLE * aspect * 0.78), Math.max(...framingHeights) / (2 * HALF_ANGLE * POSTER_SAFE_HEIGHT), 9) + depthPadding + frontDepth;
  const fitDistance = Math.max(phraseDistance, totalHeight / (2 * HALF_ANGLE * POSTER_SAFE_HEIGHT) + depthPadding + frontDepth);
  const capHeight = Math.min(...measured.map((group, index) => group.capHeight * objects[index]!.fontSize * scales[index]!));
  const fittedCapPixels = capHeight * (POSTER_REFERENCE_WIDTH / aspect) / (2 * HALF_ANGLE * fitDistance);
  const distance = fittedCapPixels >= MIN_POSTER_CAP_PIXELS ? fitDistance : phraseDistance;
  // The closest face of extruded lettering must also stay inside the safe frame.
  const frustumHeight = 2 * HALF_ANGLE * (distance - frontDepth);
  const overflow = Math.max(0, totalHeight - frustumHeight * POSTER_SAFE_HEIGHT);
  const pose = (y: number): CameraPose => ({ position: [0, y - frustumHeight * POSTER_SAFE_CENTER / 2, distance], target: [0, y - frustumHeight * POSTER_SAFE_CENTER / 2, 0], roll: 0 });
  return {
    placements, pose: pose(overflow / 2), endPose: pose(overflow > 0 ? -overflow / 2 : 0),
    // Constant reading speed through the stack, with brief rests at both ends.
    scrollDuration: overflow > 0 ? frameTime(Math.max(1.2, overflow / frustumHeight * 2.4)) : 0,
  };
}

function blend(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function chooseStyle(seed: number, attempt: number): DirectionStyle {
  const choose = (name: keyof typeof DIRECTION_STYLES) => pick(DIRECTION_STYLES[name], stream(seed, `${name}-style-${attempt}`));
  return {
    layout: choose('layout'), entry: choose('entry'), transition: choose('transition'),
    reveal: choose('reveal'), finale: choose('finale'),
    handedness: stream(seed, `handedness-${attempt}`)() < 0.5 ? -1 : 1,
    advanced: 'none',
  };
}

function spatialLayout(measured: readonly MeasuredGroup[], style: DirectionStyle, random: () => number): Vec3[] {
  let cursor = 0;
  return measured.map((group, index) => {
    const previous = measured[Math.max(0, index - 1)]!;
    const spacing = Math.max(18, Math.min(23, (group.height + previous.height) * 1.65 * 2.5));
    if (index > 0) cursor += style.layout === 'horizon' ? Math.max(21, (group.width + previous.width) * 1.65 * 1.65) : spacing;
    const d = style.handedness;
    if (index === 0) return [0, 0, 0];
    switch (style.layout) {
      case 'helix': return [Math.sin(index * 1.55) * 21 * d, -cursor, Math.cos(index * 1.55) * 11 - index * 4];
      case 'ascent': return [Math.sin(index * 1.8) * 13 * d, cursor, -index * 7];
      case 'horizon': return [cursor * d, Math.sin(index * 1.5) * 3, -index * 5];
      case 'terraces': return [((index % 3) - 1) * 14 * d, -cursor, -index * 13];
      case 'constellation': {
        const angle = index * 2.39996;
        const radius = 16;
        return [Math.cos(angle) * radius * d, Math.sin(angle) * radius, -index * 25];
      }
      case 'staircase': return [index * 12 * d, -cursor * 0.9, -index * 9];
      case 'ribbon': return [Math.sin(index * 1.05) * 22 * d, -cursor, Math.sin(index * 0.9) * 10 - index * 4];
      default: return [(index % 2 ? 11 : -11) * d, -cursor, -index * (3.5 + random() * 2)];
    }
  });
}

function dynamicTransition(id: number, start: number, end: number, from: CameraPose, to: CameraPose, mood: string, direction: number, fullRoll: boolean, fromObject: SceneObject, toObject: SceneObject, fromMeasured: MeasuredGroup, toMeasured: MeasuredGroup, aspect: number): CameraTrack[] {
  if (fullRoll) {
    const spinEnd = frameTime(start + 1.1);
    return [
      { id: `travel-${id}-spin`, start, end: spinEnd, primitive: 'ORBIT', from, to: from, controls: [[from.position[0] + direction * 0.6, from.position[1], from.position[2] + 1.2], [from.position[0] - direction * 0.6, from.position[1], from.position[2] + 1.2]], easing: 'cinematic', rollTurns: direction, focusObjectId: fromObject.id },
      ...dynamicTransition(id, spinEnd, end, from, to, 'wide-orbit', direction, false, fromObject, toObject, fromMeasured, toMeasured, aspect),
    ];
  }
  const a = from.position; const b = to.position;
  const target = blend(from.target, to.target, 0.5);
  const midpoint = blend(a, b, 0.5);
  const span = Math.min(8, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.15 + 3);
  let position: Vec3;
  let roll: number;
  switch (mood) {
    case 'wide-orbit':
    case 'barrel-roll': position = [midpoint[0] + span * direction, midpoint[1] + 2, midpoint[2] + 7]; roll = direction * 0.55; break;
    case 'whip': position = [midpoint[0] + span * 1.4 * direction, midpoint[1] - span * 0.4, midpoint[2] - 1]; roll = direction * 0.42; break;
    case 'vault': position = [midpoint[0] - direction * 4, Math.max(a[1], b[1]) + span * 0.8, midpoint[2] + 5]; roll = -direction * 0.62; break;
    case 'pendulum': position = [midpoint[0] - span * direction, midpoint[1] + span * 0.35, midpoint[2] + 2]; roll = -direction * 0.92; break;
    default: position = [midpoint[0] + span * direction, midpoint[1] + span * 0.3, midpoint[2] + 4]; roll = direction * 0.32;
  }
  // Frame the real adjacent planes as an overview during the travelling turn.
  // A mere +7 in camera Z cannot cover widely separated portrait typography.
  const extentX = Math.max(Math.abs(fromObject.position[0] - target[0]) + fromMeasured.width * fromObject.fontSize / 2, Math.abs(toObject.position[0] - target[0]) + toMeasured.width * toObject.fontSize / 2);
  const extentY = Math.max(Math.abs(fromObject.position[1] - target[1]) + fromMeasured.height * fromObject.fontSize / 2, Math.abs(toObject.position[1] - target[1]) + toMeasured.height * toObject.fontSize / 2);
  const rotatedX = Math.abs(Math.cos(roll)) * extentX + Math.abs(Math.sin(roll)) * extentY;
  const rotatedY = Math.abs(Math.cos(roll)) * extentY + Math.abs(Math.sin(roll)) * extentX;
  const contextDistance = Math.min(128, Math.max(rotatedX / (HALF_ANGLE * aspect * 0.76), rotatedY / (HALF_ANGLE * 0.7), 18));
  position = [position[0], position[1], Math.max(fromObject.position[2], toObject.position[2]) + contextDistance];
  const middle: CameraPose = { position, target, roll };
  const split = frameTime(start + (end - start) * (mood === 'whip' ? 0.4 : 0.5));
  return [
    { id: `travel-${id}-out`, start, end: split, primitive: 'ORBIT', from, to: middle, controls: [[a[0], a[1], a[2] * 0.35 + position[2] * 0.65], [position[0], position[1], position[2]]], easing: mood === 'whip' ? 'accelerate' : 'cinematic', trackTarget: true },
    { id: `travel-${id}-in`, start: split, end, primitive: 'ORBIT', from: middle, to, controls: [[position[0], position[1], position[2]], [b[0], b[1], b[2] * 0.35 + position[2] * 0.65]], easing: 'cinematic', trackTarget: true },
  ];
}

function entrance(object: SceneObject, measured: MeasuredGroup, opening: CameraPose, style: DirectionStyle, end: number): NonNullable<SceneObject['entrance']> {
  const p = object.position;
  const d = style.handedness;
  // Rotation cannot expose any corner in the opening frame: put the whole
  // geometry behind the camera, rather than testing its centre alone.
  const fromZ = opening.position[2] + Math.hypot(measured.width, measured.height) * object.fontSize + 8;
  const base = { start: 0.1, end, easing: 'cinematic' as const };
  switch (style.entry) {
    case 'side-hook': return { ...base, from: [p[0] + 10 * d, p[1] + 1, fromZ], rotation: [0.1, -d * 1.1, -d * 0.5], scale: 0.82, controls: [[p[0] + 9 * d, p[1] + 3, fromZ - 8], [p[0] - d, p[1] - 0.3, p[2] + 7]] };
    case 'rise': return { ...base, from: [p[0], p[1] - 12, fromZ], rotation: [1.2, 0, d * 0.35], scale: 0.6, controls: [[p[0] + d * 2, p[1] - 9, fromZ - 12], [p[0], p[1] + 1, p[2] + 8]] };
    case 'tumble': return { ...base, from: [p[0] - 7 * d, p[1] + 7, fromZ], rotation: [0.65, -d * 0.8, d * Math.PI * 1.1], scale: 0.7, controls: [[p[0] - 9 * d, p[1] + 4, fromZ - 10], [p[0] + 1.5 * d, p[1] - 1, p[2] + 8]] };
    case 'corkscrew': return { ...base, from: [p[0] + 4 * d, p[1] + 4, fromZ], rotation: [0.15, 0.15, d * Math.PI * 2], scale: 0.5, controls: [[p[0] - 6 * d, p[1] + 5, fromZ - 7], [p[0] + 3 * d, p[1] - 1, p[2] + 5]] };
    default: return { ...base, from: [p[0], p[1], fromZ], rotation: [0, 0, 0], scale: 1 };
  }
}

function departure(object: SceneObject, measured: MeasuredGroup, index: number, count: number, start: number, end: number, finalPose: CameraPose, style: DirectionStyle): NonNullable<SceneObject['exit']> {
  const p = object.assembly!.position;
  const scale = object.assembly!.scale;
  const d = style.handedness;
  const worldExtent = Math.hypot(measured.width, measured.height) * object.fontSize * scale;
  const toZ = finalPose.position[2] + worldExtent * 3 + 25;
  const span = toZ - p[2];
  const cameraY = finalPose.position[1];
  const relativeY = p[1] - cameraY;
  const base = { start, end, easing: 'smooth' as const };
  switch (style.finale) {
    case 'vortex': return {
      ...base, to: [p[0] + d * 3, cameraY + relativeY * 0.8, toZ], rotation: [d * 0.25, -0.3, d * (Math.PI * 2 + index * 0.3)], scale: scale * 1.12,
      // Twist visibly in front of the lens before the final depth acceleration.
      controls: [[p[0] + d * (2.2 + Math.min(index, 4) * 0.18), p[1] + 1, p[2] + span * 0.03], [-p[0] * 0.25 - d * 2.2, cameraY - relativeY * 0.3, p[2] + span * 0.2]],
    };
    case 'staggered-punch': return {
      ...base, start: frameTime(start + Math.min(index, 4) * 0.1), to: [p[0] * 0.4, cameraY + relativeY * 0.6, toZ], rotation: [0.08 * d, -0.15 * d, d * 0.24], scale: scale * 1.24,
      controls: [[p[0], p[1], p[2] + span * 0.36], [p[0] * 0.8, cameraY + relativeY * 0.8, p[2] + span * 0.77]],
    };
    case 'fan-out': {
      const side = (index % 2 ? 1 : -1) * d;
      const spread = 9 + index * 1.2;
      return { ...base, to: [side * spread * 2, cameraY + relativeY * 2.5, toZ], rotation: [side * 0.55, side * 1.25, side * 0.8], scale: scale * 1.08,
        controls: [[p[0] + side * spread, cameraY + relativeY * 1.3, p[2] + span * 0.28], [p[0] + side * spread * 1.8, cameraY + relativeY * 2, p[2] + span * 0.67]] };
    }
    case 'converging-slam': return { ...base, to: [d * (index - count / 2) * 0.5, cameraY, toZ], rotation: [0, d * 0.35, d * (index % 2 ? 0.5 : -0.5)], scale: scale * 1.18,
      controls: [[p[0] * 0.2, cameraY + relativeY * 0.15, p[2] + span * 0.3], [0, cameraY, p[2] + span * 0.66]] };
    default: return { ...base, to: [p[0], p[1], toZ], rotation: [0, 0, 0], scale, controls: [[p[0], p[1], p[2] + span * 0.28], [p[0], p[1], p[2] + span * 0.72]] };
  }
}

function generate(analysis: TextAnalysis, measured: readonly MeasuredGroup[], themeId: string, seed: number, attempt: number, format: FilmFormat): SceneSpec {
  if (measured.length === 0 || measured.length !== analysis.groups.length) throw new RangeError('Measured groups must match the analysis.');
  const aspect = filmAspect(format);
  const nearFrustumCorner = NEAR_PLANE * HALF_ANGLE * Math.hypot(1, aspect);
  const layoutRandom = stream(seed, `layout-${attempt}`);
  const motionRandom = stream(seed, `motion-${attempt}`);
  const colorRandom = stream(seed, `color-${attempt}`);
  const style = chooseStyle(seed, attempt);
  const direction = style.handedness;
  const positions = spatialLayout(measured, style, layoutRandom);
  const colors = colorRoles(measured.length, colorRandom);
  const firstSemantic = measured.reduce((best, current, index) => current.scores.narrative + current.scores.linguistic > measured[best]!.scores.narrative + measured[best]!.scores.linguistic ? index : best, 0);
  const objects: SceneObject[] = measured.map((group, index) => {
    const emphasis = index === measured.length - 1 || index === firstSemantic;
    return {
      id: group.id, text: group.group.text, displayText: group.displayText, fontSize: opticalFontSize(group, format),
      position: positions[index]!, rotation: [0, (layoutRandom() - 0.5) * 0.16, (layoutRandom() - 0.5) * 0.24], scale: 1,
      colorRole: colors[index]!,
      extruded: emphasis && !group.group.tokens.some(token => token.emoji), extrusionDepth: emphasis ? 0.20 : 0,
      readingInterval: [0, 0],
    };
  });
  let portalIndex = -1;
  let portalCenter: Vec3 | undefined;
  const advancedChoice = stream(seed, `advanced-${attempt}`)();
  if (measured.length > 1 && advancedChoice < 0.34) {
    const candidates = measured.slice(0, -1).flatMap((group, index) => {
      const aperture = group.portal;
      // A word reduced to fit must not be enlarged again for a portal shot.
      if (group.width > groupWidthLimit(format) || group.height > 4) return [];
      if (!aperture || group.group.tokens.some(token => token.emoji) || aperture.radius <= 0.012) return [];
      const necessarySize = (nearFrustumCorner + 0.025) / (aperture.radius - 0.008) * 1.12;
      return necessarySize <= 3 ? [{ index, aperture, size: Math.max(objects[index]!.fontSize, necessarySize) }] : [];
    });
    const choice = candidates[Math.floor(motionRandom() * candidates.length)];
    if (choice) {
      const hero = objects[choice.index]!;
      hero.fontSize = choice.size; hero.extruded = true; hero.extrusionDepth = 0.24; hero.rotation = [0, 0, 0];
      const clearance = choice.aperture.radius * hero.fontSize - 0.008 * hero.fontSize - 0.025;
      if (clearance > nearFrustumCorner) {
        portalIndex = choice.index;
        portalCenter = [hero.position[0] + choice.aperture.center[0] * hero.fontSize, hero.position[1] + choice.aperture.center[1] * hero.fontSize, hero.position[2]];
        const following = objects[portalIndex + 1]!;
        following.rotation = [0, (layoutRandom() - 0.5) * 0.05, 0];
        following.position = [portalCenter[0], portalCenter[1], hero.position[2] - distanceToFit(measured[portalIndex + 1]!, following.fontSize, aspect) * 1.025 - 6];
        style.advanced = 'portal';
      }
    }
  }
  const tunnelStart = portalIndex === -1 && measured.length >= 3 && advancedChoice >= 0.34 && advancedChoice < 0.58 ? Math.floor(motionRandom() * (measured.length - 2)) : -1;
  if (tunnelStart !== -1) {
    style.advanced = 'tunnel';
    const base = objects[tunnelStart]!.position;
    for (let offset = 0; offset < 3; offset++) {
      const object = objects[tunnelStart + offset]!;
      object.position = [direction * (offset % 2 ? 12 : -12), base[1], base[2] - offset * 44];
      object.rotation = [0, direction * (offset % 2 ? -0.24 : 0.24), 0];
    }
  }
  const poses = objects.map((object, index) => readingPose(object, measured[index]!, layoutRandom, aspect));
  // A whole camera revolution is a deliberate event, rather than every cut.
  const barrelIndex = style.transition === 'barrel-roll' ? objects.findIndex((_, index) => index > 0 && index - 1 !== portalIndex && !(tunnelStart !== -1 && index > tunnelStart && index <= tunnelStart + 2)) : -1;
  const transitionDurations = measured.slice(1).map((_, index) => {
    if (index === portalIndex) return 1.6;
    if (tunnelStart !== -1 && index >= tunnelStart && index < tunnelStart + 2) return 1.0;
    if (index + 1 === barrelIndex) return 1.7;
    return frameTime(style.transition === 'whip' ? 0.5 + motionRandom() * 0.12 : 0.6 + motionRandom() * 0.17);
  });
  const initialSettle = style.entry === 'corkscrew' ? 1.1 : frameTime(0.75);
  const entranceEnd = style.entry === 'corkscrew' ? 1 : 0.55;
  // Short compositions conclude briefly; overflowing stacks get a readable pan.
  // A spiral keeps enough flight time for its full revolution before landing.
  const revealDuration = frameTime(style.reveal === 'spiral' ? 1.35 : 1.1);
  const posterHold = 0.6;
  const posterVariant = DIRECTION_STYLES.reveal.indexOf(style.reveal as typeof DIRECTION_STYLES.reveal[number]);
  const composition = poster(measured, objects, posterVariant, format);
  const finalHold = composition.scrollDuration > 0 ? posterHold : 0;
  const rushDuration = frameTime(style.finale === 'staggered-punch' ? 1.35 : style.finale === 'vortex' ? 1.2 : 1.05);
  const seamDuration = 0.2;
  const readingDurations = measured.map(group => frameTime(group.group.readingDuration));
  const baseDuration = frameTime(initialSettle + readingDurations.reduce((sum, duration) => sum + duration, 0) + transitionDurations.reduce((sum, duration) => sum + duration, 0) + revealDuration + posterHold + rushDuration + seamDuration);
  // A passage near the limit can scan slightly faster, preserving its full
  // reading intervals and the 60-second export limit.
  const availableScrollTime = Math.floor((60 - baseDuration - finalHold) * FPS + 1e-8) / FPS;
  const scrollTime = composition.scrollDuration > 0 ? Math.min(composition.scrollDuration, Math.max(1.2, availableScrollTime)) : 0;
  const initialDuration = frameTime(baseDuration + scrollTime + finalHold);
  if (initialDuration > 60) throw new TooLongTextError(initialDuration);
  const tracks: CameraTrack[] = [];
  const chapters: SceneSpec['chapters'][number][] = [];
  const opening = poses[0]!;
  for (let index = 1; index < objects.length; index++) {
    const object = objects[index]!;
    const extent = Math.hypot(measured[index]!.width, measured[index]!.height) * object.fontSize;
    object.entrance = { start: Math.max(0.4, entranceEnd - 0.1), end: initialSettle, from: [object.position[0], object.position[1], opening.position[2] + extent + 30 + (Math.abs(object.position[0]) + Math.abs(object.position[1])) * 0.3], easing: 'cinematic' };
  }
  objects[0]!.entrance = entrance(objects[0]!, measured[0]!, opening, style, entranceEnd);
  const impactPose: CameraPose = { position: [opening.position[0] + direction * 1.4, opening.position[1] + (style.entry === 'rise' ? -1 : 0.8), opening.position[2] - 2.2], target: objects[0]!.position, roll: -direction * (style.entry === 'depth-dive' ? 0.07 : 0.23) };
  tracks.push({ id: 'impact', start: 0, end: initialSettle, primitive: 'DEPTH', from: impactPose, to: opening, easing: 'cinematic', impact: { start: Math.max(entranceEnd - 0.1, initialSettle - 0.3), end: initialSettle, displacement: [0, 0, -0.6], rotation: [0, 0, direction * 0.025] } });
  chapters.push({ time: 0, objectId: objects[0]!.id, primitive: 'DEPTH' });
  let time = initialSettle;
  let fullRollUsed = false;
  for (let index = 0; index < objects.length; index++) {
    if (index > 0) {
      const from = poses[index - 1]!; const to = poses[index]!;
      const transitionEnd = frameTime(time + transitionDurations[index - 1]!);
      if (index - 1 === portalIndex && portalCenter) {
        const center = portalCenter;
        const aligned: CameraPose = { position: [center[0], center[1], from.position[2]], target: [center[0], center[1], center[2] - 5], roll: 0 };
        const crossed: CameraPose = { position: [center[0], center[1], center[2] - 0.45], target: [center[0], center[1], center[2] - 5], roll: 0 };
        const alignEnd = frameTime(time + 0.4);
        const crossEnd = frameTime(time + 1.05);
        tracks.push({ id: `portal-align-${index}`, start: time, end: alignEnd, primitive: 'ORBIT', from, to: aligned, easing: 'cinematic' });
        tracks.push({ id: `portal-cross-${index}`, start: alignEnd, end: crossEnd, primitive: 'PORTAL', from: aligned, to: crossed, easing: 'cinematic' });
        tracks.push({ id: `portal-arrive-${index}`, start: crossEnd, end: transitionEnd, primitive: 'DEPTH', from: crossed, to, easing: 'cinematic' });
        chapters.push({ time: alignEnd, objectId: objects[index - 1]!.id, primitive: 'PORTAL' });
      } else {
        const tunnel = tunnelStart !== -1 && index > tunnelStart && index <= tunnelStart + 2;
        const rhetoricalTurn = measured[index]!.group.contrast || measured[index]!.group.sentence !== measured[index - 1]!.group.sentence;
        const cut = !tunnel && style.transition === 'whip' && rhetoricalTurn && measured.length > 3 && motionRandom() > 0.72;
        if (tunnel) {
          const contextZ = objects[index - 1]!.position[2] + 20;
          const controlZ = (contextZ - (from.position[2] + to.position[2]) * 0.125) / 0.75;
          tracks.push({ id: `travel-${index}`, start: time, end: transitionEnd, primitive: 'TUNNEL', from, to, controls: [[0, from.position[1], controlZ], [0, to.position[1], controlZ]], easing: 'cinematic', trackTarget: true });
        }
        else if (cut) tracks.push({ id: `travel-${index}`, start: time, end: transitionEnd, primitive: 'CUT', from: to, to, easing: 'linear', cutBefore: true });
        else {
          const fullRoll = index === barrelIndex;
          tracks.push(...dynamicTransition(index, time, transitionEnd, from, to, style.transition, direction * (index % 2 ? 1 : -1), fullRoll, objects[index - 1]!, objects[index]!, measured[index - 1]!, measured[index]!, aspect));
          fullRollUsed ||= fullRoll;
        }
        chapters.push({ time, objectId: objects[index]!.id, primitive: tunnel ? 'TUNNEL' : cut ? 'CUT' : 'ORBIT' });
      }
      time = transitionEnd;
    }
    // Do not refill time saved by the faster finale with artificially longer
    // reading holds. Short quotations may finish naturally below six seconds.
    const readEnd = frameTime(time + readingDurations[index]!);
    objects[index]!.readingInterval = [time, readEnd];
    tracks.push({ id: `read-${index}`, start: time, end: readEnd, primitive: 'HOLD', from: poses[index]!, to: poses[index]!, easing: 'linear' });
    time = readEnd;
  }
  const revealStart = time;
  const revealEnd = frameTime(time + revealDuration);
  const landingStart = frameTime(revealEnd - 0.3);
  const finalPose = composition.pose;
  for (let index = 0; index < objects.length; index++) {
    objects[index]!.assembly = { start: revealStart, end: revealEnd, ...composition.placements[index]!, rotation: [0, 0, 0], easing: 'cinematic' };
    objects[index]!.impact = { start: landingStart, end: revealEnd, displacement: [0, 0, style.reveal === 'slam' ? 1 : 0.55], rotation: [0, 0, direction * (index % 2 ? 0.03 : -0.03)], scale: style.reveal === 'slam' ? 0.16 : 0.09 };
  }
  const lastPose = poses[poses.length - 1]!;
  const landingPose: CameraPose = { position: [style.reveal === 'swing' ? direction * 1.6 : 0, finalPose.position[1] + (style.reveal === 'slam' ? 0.25 : 0), finalPose.position[2] + (style.reveal === 'slam' ? -1.1 : 1.1)], target: finalPose.target, roll: style.reveal === 'swing' ? -direction * 0.18 : 0 };
  const revealControls = travelControls(lastPose, landingPose, direction * (style.reveal === 'swing' ? -1 : 1));
  const revealFocus = scrollTime > 0 ? {} : { focusObjectId: objects[objects.length - 1]!.id };
  const revealTrack: CameraTrack = { id: 'reveal-flight', start: revealStart, end: landingStart, primitive: 'REVEAL', from: lastPose, to: landingPose, controls: revealControls, easing: 'cinematic', ...revealFocus };
  if (style.reveal === 'spiral' && !fullRollUsed) { revealTrack.rollTurns = direction; fullRollUsed = true; }
  if (style.reveal === 'swing') revealTrack.controls = [[lastPose.position[0] + direction * 15, lastPose.position[1] + 8, lastPose.position[2] + 4], [direction * 10, finalPose.position[1] + 5, finalPose.position[2] + 8]];
  if (style.reveal === 'spiral') revealTrack.controls = [[lastPose.position[0] - direction * 10, lastPose.position[1] + 8, lastPose.position[2] + 6], [direction * 8, finalPose.position[1] - 4, finalPose.position[2] + 7]];
  tracks.push(revealTrack);
  tracks.push({ id: 'reveal-impact', start: landingStart, end: revealEnd, primitive: 'REVEAL', from: landingPose, to: finalPose, easing: 'cinematic', ...revealFocus, impact: { start: landingStart, end: revealEnd, displacement: [0, 0, style.reveal === 'slam' ? -0.9 : -0.45], rotation: [direction * 0.009, 0, direction * 0.025] } });
  chapters.push({ time: revealStart, objectId: null, primitive: 'REVEAL' });
  const posterEnd = frameTime(revealEnd + posterHold);
  tracks.push({ id: 'poster', start: revealEnd, end: posterEnd, primitive: 'HOLD', from: finalPose, to: finalPose, easing: 'linear' });
  chapters.push({ time: revealEnd, objectId: null, primitive: 'HOLD' });
  const scrollEnd = frameTime(posterEnd + scrollTime);
  const rushStart = frameTime(scrollEnd + finalHold);
  const rushPose = composition.endPose;
  if (scrollTime > 0) {
    tracks.push({ id: 'poster-scroll', start: posterEnd, end: scrollEnd, primitive: 'REVEAL', from: finalPose, to: rushPose, easing: 'linear' });
    tracks.push({ id: 'poster-end', start: scrollEnd, end: rushStart, primitive: 'HOLD', from: rushPose, to: rushPose, easing: 'linear' });
    chapters.push({ time: posterEnd, objectId: null, primitive: 'REVEAL' }, { time: scrollEnd, objectId: null, primitive: 'HOLD' });
  }
  const rushEnd = frameTime(rushStart + rushDuration);
  for (let index = 0; index < objects.length; index++) objects[index]!.exit = departure(objects[index]!, measured[index]!, index, objects.length, rushStart, rushEnd, rushPose, style);
  tracks.push({ id: `finale-${style.finale}`, start: rushStart, end: rushEnd, primitive: 'DEPTH', from: rushPose, to: rushPose, easing: 'linear', impact: { start: rushStart, end: frameTime(rushStart + 0.3), displacement: [0, 0, -0.35], rotation: [0, 0, direction * 0.018] } });
  const duration = frameTime(rushEnd + seamDuration);
  if (duration > 60) throw new TooLongTextError(duration);
  tracks.push({ id: 'loop-seam', start: rushEnd, end: duration, primitive: 'HOLD', from: rushPose, to: rushPose, easing: 'linear' });
  chapters.push({ time: rushStart, objectId: null, primitive: 'DEPTH' });
  return {
    id: `generated-${seed >>> 0}-${attempt}${format === 'square' ? '-square' : ''}`, generatorVersion: GENERATOR_VERSION,
    fontId: measured[0]?.fontId ?? DEFAULT_FONT_ID,
    fontVersion: `${getDisplayFont(measured[0]?.fontId).version}${analysis.tokens.some(token => token.emoji) ? `+noto-emoji-700-${emojiCoverage.version}` : ''}`,
    sourceText: analysis.sourceText, inputLanguage: analysis.language, themeId, seed: seed >>> 0, duration,
    directionStyle: style, posterTime: frameTime(revealEnd + Math.min(0.45, posterHold / 2)),
    fps: FPS, aspect, fov: FOV, objects, cameraTracks: tracks, chapters,
  };
}

export const MotionDirector = {
  direct(analysis: TextAnalysis, measured: readonly MeasuredGroup[], themeId: string, seed: number, previousSignature?: string | readonly string[], format: FilmFormat = 'vertical'): SceneSpec {
    const history = typeof previousSignature === 'string' ? [previousSignature] : previousSignature ?? [];
    if (format === 'vertical' && (measured[0]?.fontId ?? DEFAULT_FONT_ID) === DEFAULT_FONT_ID && analysis.sourceText === FUTURE_QUOTE && seed === stableSeed(FUTURE_QUOTE) && history.length === 0) return { ...futureDemo, inputLanguage: analysis.language, themeId, seed };
    const styles = history.flatMap(signature => {
      try { const style = (JSON.parse(signature) as { styles?: DirectionStyle }).styles; return style ? [style] : []; }
      catch { return []; }
    });
    const dominates = (a: DirectionStyle, b: DirectionStyle) => Number(a.entry === b.entry) + Number(a.transition === b.transition) + Number(a.finale === b.finale);
    const accept = (spec: SceneSpec) => {
      if (history.includes(sceneSignature(spec))) return false;
      const style = spec.directionStyle!;
      if (styles.some(previous => dominates(style, previous) === 3)) return false;
      const immediate = styles.at(-1);
      return !immediate || dominates(style, immediate) < 2;
    };
    let candidateSeed = seed >>> 0;
    for (let attempt = 0; attempt < 48; attempt++) {
      // A saved seed alone must reproduce the accepted film. Retry complete
      // candidate seeds, never invisible attempt-specific random streams.
      if (format === 'vertical' && (measured[0]?.fontId ?? DEFAULT_FONT_ID) === DEFAULT_FONT_ID && analysis.sourceText === FUTURE_QUOTE && candidateSeed === stableSeed(FUTURE_QUOTE)) candidateSeed = nextRemixSeed(analysis.sourceText, candidateSeed);
      const spec = applySecretFilm(generate(analysis, measured, themeId, candidateSeed, 0, format));
      if (accept(spec)) return spec;
      candidateSeed = nextRemixSeed(analysis.sourceText, candidateSeed);
    }
    throw new Error('Unable to choose a distinct choreography from the recent history.');
  },
};
