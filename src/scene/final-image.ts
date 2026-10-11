import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { MAX_IMAGE_COUNT, type ImageAsset } from '../image/types';
import { evaluateScene } from './evaluator';
import type { CameraPose, FinalImageObject, SceneSpec, Vec3 } from './types';

export const MAX_FINAL_IMAGES = MAX_IMAGE_COUNT;
export const FINAL_IMAGE_TIMING = Object.freeze({ entrance: 0.7, hold: 0.45, exit: 0.6, blank: 0.15 });
// The first photo catches the final text rush; intermediate text gestures finish
// before that bridge. Subsequent photo flights keep their longer travel.
export const FINAL_IMAGE_BRIDGE_ENTRANCE = 0.4;
// The next photograph approaches while its predecessor accelerates past the lens.
export const FINAL_IMAGE_STRIDE = FINAL_IMAGE_TIMING.entrance + FINAL_IMAGE_TIMING.hold;
export const FINAL_IMAGE_DURATION = FINAL_IMAGE_STRIDE + FINAL_IMAGE_TIMING.exit + FINAL_IMAGE_TIMING.blank;
const IMAGE_CAMERA_TRACK = 'final-image-camera';

/** Nominal sequence length from the first arrival, before any text-handoff hold. */
export function finalImagesDuration(count: number): number {
  if (!Number.isInteger(count) || count < 0 || count > MAX_FINAL_IMAGES) {
    throw new RangeError('A film supports zero to five final images.');
  }
  return count === 0 ? 0 : FINAL_IMAGE_DURATION + (count - 1) * FINAL_IMAGE_STRIDE;
}

/** The complete quotation must remain intact when adding an optional ending. */
export class FinalImageDurationError extends Error {
  readonly duration: number;

  constructor(duration: number) {
    super('The complete film with its final image would exceed 60 seconds.');
    this.name = 'FinalImageDurationError';
    this.duration = duration;
  }
}

/** Retain the exact frozen camera orientation, including a previous barrel roll. */
function frozenPose(position: Vec3, quaternion: Quaternion): CameraPose {
  const eye = new Vector3(...position);
  const target = new Vector3(0, 0, -1).applyQuaternion(quaternion).add(eye);
  const baseline = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0)));
  const relative = baseline.invert().multiply(quaternion);
  return { position, target: target.toArray() as Vec3, roll: 2 * Math.atan2(relative.z, relative.w) };
}

/**
 * Append a physical image arrival, readable hold, then a rush through the lens.
 * The base scene remains untouched and removal/replacement never grows timing.
 */
export function withFinalImages(spec: SceneSpec, assets: readonly ImageAsset[]): SceneSpec {
  const { finalImages: previous, ...undecorated } = spec;
  const original = previous?.[0];
  const previousIds = new Set(previous?.map(image => image.id));
  const base: SceneSpec = original ? {
    ...undecorated,
    duration: original.baseDuration,
    posterTime: original.basePosterTime,
    cameraTracks: spec.cameraTracks.filter(track => track.id !== IMAGE_CAMERA_TRACK),
    chapters: spec.chapters.filter(chapter => !chapter.objectId || !previousIds.has(chapter.objectId)),
  } : undecorated;
  if (!assets.length) return original ? base : spec;
  if (assets.length > MAX_FINAL_IMAGES) throw new RangeError('A film supports up to five final images.');
  if (assets.some(asset => !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0)) {
    throw new RangeError('A final image needs positive finite dimensions.');
  }

  // Recognize the real ending from object motion, rather than generator-specific
  // camera IDs. The poster and all phrase-reading intervals finish before the
  // photo starts growing behind the departing words.
  const protectedEnd = Math.max(base.posterTime ?? 0, ...base.objects.map(object =>
    Math.max(object.readingInterval[1], object.assembly?.end ?? 0)));
  const departures = base.objects.flatMap(object =>
    object.exit && object.exit.start >= protectedEnd ? [object.exit] : []);
  const departureStart = departures.length ? Math.min(...departures.map(exit => exit.start)) : base.duration;
  // A keyframed departure can perform a visible gesture before its final rush.
  // Starting the photo at the departure's opening would put an opaque plane
  // in front of those words while the gesture is still playing.
  const gestureEnds = departures.flatMap(exit => {
    const last = exit.keyframes?.at(-1);
    return last ? [exit.start + (exit.end - exit.start) * last.at] : [];
  });
  const firstStart = Math.max(departureStart, ...gestureEnds);
  const textExitEnd = departures.length ? Math.max(...departures.map(exit => exit.end)) : base.duration;
  const firstEntranceDuration = departures.length ? FINAL_IMAGE_BRIDGE_ENTRANCE : FINAL_IMAGE_TIMING.entrance;
  const firstEntranceEnd = firstStart + firstEntranceDuration;
  // The entire first hold must survive the text exit. The minimum also keeps
  // custom scene camera tracks intact instead of shortening the original film.
  const holds = assets.map(asset => {
    const animation = asset.animation;
    if (animation && (!Number.isFinite(animation.duration) || animation.duration <= 0 || !animation.frames.length)) {
      throw new RangeError('An animated final image needs a positive duration and frames.');
    }
    return Math.max(FINAL_IMAGE_TIMING.hold, animation?.duration ?? 0);
  });
  const firstExitStart = Math.max(firstEntranceEnd, textExitEnd, base.duration - FINAL_IMAGE_TIMING.blank)
    + holds[0]!;
  const duration = firstExitStart + holds.slice(1).reduce((sum, hold) => sum + FINAL_IMAGE_TIMING.entrance + hold, 0)
    + FINAL_IMAGE_TIMING.exit + FINAL_IMAGE_TIMING.blank;
  if (duration > 60) throw new FinalImageDurationError(duration);

  const state = evaluateScene(base, base.duration);
  const quaternion = new Quaternion(...state.camera.quaternion);
  const cameraPosition = new Vector3(...state.camera.position);
  const cameraSpace = (distance: number): Vec3 =>
    new Vector3(0, 0, -distance).applyQuaternion(quaternion).add(cameraPosition).toArray() as Vec3;
  const distance = 9;
  // Symmetric margins also satisfy the tighter bottom social safe area.
  const frustumHeight = 2 * distance * Math.tan(base.fov * Math.PI / 360);
  const maxWidth = frustumHeight * base.aspect * 0.82;
  const maxHeight = frustumHeight * 0.64;
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ').toArray().slice(0, 3) as unknown as Vec3;
  const pose = frozenPose(state.camera.position, quaternion);
  let nextStart = firstStart;
  const images: FinalImageObject[] = assets.map((asset, index) => {
    const aspect = asset.width / asset.height;
    const width = Math.min(maxWidth, maxHeight * aspect);
    const height = width / aspect;
    const start = nextStart;
    const entranceEnd = start + (index === 0 ? firstEntranceDuration : FINAL_IMAGE_TIMING.entrance);
    const exitStart = index === 0 ? firstExitStart : entranceEnd + holds[index]!;
    nextStart = exitStart;
    const exitEnd = exitStart + FINAL_IMAGE_TIMING.exit;
    return {
      id: `final-image-${index}`, asset, baseDuration: base.duration, basePosterTime: base.posterTime,
      width, height, position: cameraSpace(distance), rotation, scale: 1,
      entrance: { start, end: entranceEnd, from: cameraSpace(96), scale: 0, easing: 'cinematic' },
      exit: { start: exitStart, end: exitEnd, to: cameraSpace(-5), easing: 'accelerate' },
      visibleInterval: [start, exitEnd],
    };
  });
  const last = images[images.length - 1]!;

  return {
    ...base,
    duration,
    posterTime: (Math.max(last.entrance.end, base.duration) + last.exit.start) / 2,
    finalImages: images,
    cameraTracks: [...base.cameraTracks, {
      id: IMAGE_CAMERA_TRACK, start: base.duration, end: duration, primitive: 'HOLD', from: pose, to: pose, easing: 'linear',
    }],
    chapters: [...base.chapters, ...images.flatMap(image => [
      { time: image.entrance.start, objectId: image.id, primitive: 'DEPTH' as const },
      { time: image.entrance.end, objectId: image.id, primitive: 'HOLD' as const },
      { time: image.exit.start, objectId: image.id, primitive: 'DEPTH' as const },
    ])].sort((a, b) => a.time - b.time),
  };
}
