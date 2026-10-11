import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { CameraPose, Easing, EvaluatedObject, EvaluatedScene, ImpactMotion, MotionKeyframe, Quat, SceneObject, SceneSpec, Vec3 } from './types';

function ease(t: number, easing: Easing): number {
  if (easing === 'linear') return t;
  if (easing === 'accelerate') return t * t * t;
  if (easing === 'smooth') return t * t * (3 - 2 * t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function orientation(pose: CameraPose): Quaternion {
  const eye = new Vector3(...pose.position);
  const target = new Vector3(...pose.target);
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0)),
  );
  if (pose.roll !== 0) {
    quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pose.roll));
  }
  return quaternion.normalize();
}

function trajectory(a: Vec3, d: Vec3, controls: readonly [Vec3, Vec3] | undefined, t: number): Vec3 {
  if (!controls) {
    return mix(a, d, t);
  }
  const [b, c] = controls;
  const s = 1 - t;
  const coordinate = (axis: 0 | 1 | 2) =>
    s * s * s * a[axis] + 3 * s * s * t * b[axis] + 3 * s * t * t * c[axis] + t * t * t * d[axis];
  return [coordinate(0), coordinate(1), coordinate(2)];
}

function mix(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function difference(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function progress(time: number, motion: { start: number; end: number; easing: Easing }): number {
  if (motion.end <= motion.start) return time >= motion.end ? 1 : 0;
  return ease(Math.max(0, Math.min(1, (time - motion.start) / (motion.end - motion.start))), motion.easing);
}

/** Positive strike, smaller opposing recoil, then a smooth exact settlement. */
function impactPulse(time: number, motion: ImpactMotion | undefined): number {
  if (!motion || time <= motion.start || time >= motion.end || motion.end <= motion.start) return 0;
  const t = (time - motion.start) / (motion.end - motion.start);
  const envelope = Math.sin(Math.PI * t) ** 2 * Math.exp(-6 * t);
  return 10.2 * Math.sin(3 * Math.PI * t) * envelope;
}

function offset(value: Vec3, amplitude: Vec3 | undefined, pulse: number): Vec3 {
  if (!amplitude || pulse === 0) return value;
  return [value[0] + amplitude[0] * pulse, value[1] + amplitude[1] * pulse, value[2] + amplitude[2] * pulse];
}

type SpatialTransform = Pick<SceneObject, 'id' | 'position' | 'rotation' | 'scale'>
  & Partial<Pick<SceneObject, 'assembly' | 'entrance' | 'exit' | 'impact'>>;

type Transform = Pick<SceneObject, 'position' | 'rotation' | 'scale'>;

function mixTransform(from: Transform, to: Transform, t: number): Transform {
  return {
    position: mix(from.position, to.position, t),
    rotation: mix(from.rotation, to.rotation, t),
    scale: from.scale + (to.scale - from.scale) * t,
  };
}

function keyframedTransform(
  from: Transform,
  to: Transform,
  motion: { start: number; end: number; easing: Easing; keyframes: readonly MotionKeyframe[] },
  time: number,
): Transform {
  // Knot times belong to linear absolute time, independent of segment easing.
  const local = motion.end <= motion.start ? (time >= motion.end ? 1 : 0)
    : Math.max(0, Math.min(1, (time - motion.start) / (motion.end - motion.start)));
  if (local <= 0) return from;
  if (local >= 1) return to;
  let previous = from;
  let previousAt = 0;
  for (const keyframe of motion.keyframes) {
    const next: Transform = {
      position: keyframe.position,
      rotation: keyframe.rotation ?? mix(from.rotation, to.rotation, keyframe.at),
      scale: keyframe.scale ?? from.scale + (to.scale - from.scale) * keyframe.at,
    };
    if (local <= keyframe.at) {
      const segment = (local - previousAt) / (keyframe.at - previousAt);
      return mixTransform(previous, next, ease(segment, keyframe.easing ?? motion.easing));
    }
    previous = next;
    previousAt = keyframe.at;
  }
  return mixTransform(previous, to, ease((local - previousAt) / (1 - previousAt), motion.easing));
}

function objectTransform(object: SpatialTransform, time: number): EvaluatedObject {
  const assembly = object.assembly;
  const t = assembly ? progress(time, assembly) : 0;
  const destination = assembly ?? object;
  let objectPosition = mix(object.position, destination.position, t);
  let objectRotation = mix(object.rotation, destination.rotation, t);
  let objectScale = object.scale + (destination.scale - object.scale) * t;
  if (object.entrance && time < object.entrance.end) {
    const entrance = object.entrance;
    if (entrance.keyframes?.length) {
      const arrival = keyframedTransform({
        position: entrance.from,
        rotation: entrance.rotation ?? object.rotation,
        scale: entrance.scale ?? object.scale,
      }, object, { ...entrance, keyframes: entrance.keyframes }, time);
      objectPosition = arrival.position;
      objectRotation = arrival.rotation;
      objectScale = arrival.scale;
    } else {
      const arrival = progress(time, entrance);
      objectPosition = trajectory(entrance.from, object.position, entrance.controls, arrival);
      if (entrance.rotation) objectRotation = mix(entrance.rotation, object.rotation, arrival);
      if (entrance.scale !== undefined) objectScale = entrance.scale + (object.scale - entrance.scale) * arrival;
    }
  }
  if (object.exit && time >= object.exit.start) {
    const exit = object.exit;
    if (exit.keyframes?.length) {
      const departure = keyframedTransform(destination, {
        position: exit.to,
        rotation: exit.rotation ?? destination.rotation,
        scale: exit.scale ?? destination.scale,
      }, { ...exit, keyframes: exit.keyframes }, time);
      objectPosition = departure.position;
      objectRotation = departure.rotation;
      objectScale = departure.scale;
    } else {
      const departure = progress(time, exit);
      objectPosition = trajectory(destination.position, exit.to, exit.controls, departure);
      if (exit.rotation) objectRotation = mix(destination.rotation, exit.rotation, departure);
      if (exit.scale !== undefined) objectScale = destination.scale + (exit.scale - destination.scale) * departure;
    }
  }
  const pulse = impactPulse(time, object.impact);
  return {
    id: object.id,
    position: offset(objectPosition, object.impact?.displacement, pulse),
    rotation: offset(objectRotation, object.impact?.rotation, pulse),
    scale: objectScale * (1 + (object.impact?.scale ?? 0) * pulse),
  };
}

/**
 * Evaluate solely from absolute time. Calls can arrive in any order: preview,
 * scrubbing and frame-by-frame export all use this same function.
 */
export function evaluateScene(spec: SceneSpec, requestedTime: number): EvaluatedScene {
  if (!Number.isFinite(requestedTime)) throw new RangeError('Scene time must be finite.');
  if (spec.cameraTracks.length === 0) throw new RangeError('A scene needs at least one camera track.');
  const time = Math.max(0, Math.min(spec.duration, requestedTime));
  // Start-inclusive/end-exclusive intervals ensure a cut happens on its exact frame.
  const track = spec.cameraTracks.find((candidate) => time >= candidate.start && time < candidate.end)
    ?? spec.cameraTracks[spec.cameraTracks.length - 1];
  const local = track.end <= track.start ? 1 : Math.max(0, Math.min(1, (time - track.start) / (track.end - track.start)));
  const t = ease(local, track.easing);
  // Appending an image cannot extend any existing text choreography.
  const textTime = Math.min(time, spec.finalImages?.[0]?.baseDuration ?? time);
  const objects = spec.objects.map(object => objectTransform(object, textTime));
  const cameraPulse = impactPulse(time, track.impact);
  const cameraPosition = offset(trajectory(track.from.position, track.to.position, track.controls, t), track.impact?.displacement, cameraPulse);
  let quaternion: Quaternion;
  if (track.trackTarget || track.focusObjectId) {
    let target = mix(track.from.target, track.to.target, t);
    if (track.focusObjectId) {
      const index = spec.objects.findIndex(object => object.id === track.focusObjectId);
      if (index === -1) throw new RangeError(`Camera focus object ${track.focusObjectId} does not exist.`);
      const object = spec.objects[index]!;
      const start = objectTransform(object, track.start).position;
      const end = objectTransform(object, track.end).position;
      const fromOffset = difference(track.from.target, start);
      const toOffset = difference(track.to.target, end);
      target = offset(objects[index]!.position, mix(fromOffset, toOffset, t), 1);
    }
    const rollDelta = Math.atan2(Math.sin(track.to.roll - track.from.roll), Math.cos(track.to.roll - track.from.roll));
    quaternion = orientation({ position: cameraPosition, target, roll: track.from.roll + rollDelta * t });
  } else quaternion = orientation(track.from).slerp(orientation(track.to), t).normalize();
  if (track.rollTurns) {
    quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI * 2 * track.rollTurns * t));
  }
  if (track.impact?.rotation && cameraPulse !== 0) {
    const angles = track.impact.rotation.map(value => value * cameraPulse);
    quaternion.multiply(new Quaternion().setFromEuler(new Euler(angles[0], angles[1], angles[2], 'XYZ')));
  }
  quaternion.normalize();
  const q: Quat = [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
  return {
    time,
    trackId: track.id,
    camera: { position: cameraPosition, quaternion: q, fov: spec.fov },
    objects,
    ...(spec.finalImages?.length ? {
      finalImages: spec.finalImages.map(image => ({
        ...objectTransform(image, time),
        visible: time >= image.visibleInterval[0] && time < image.visibleInterval[1],
      })),
    } : {}),
  };
}
