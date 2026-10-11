/** Serializable scene data. Three.js resources belong to the renderer, never here. */
import type { ImageAsset } from '../image/types';
import type { SecretFilmId } from '../direction/secrets';

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export type ColorRole = 'white' | 'pink' | 'coral' | 'cyan' | 'violet';
export type MotionPrimitive = 'HOLD' | 'DEPTH' | 'ORBIT' | 'REVEAL' | 'CUT' | 'PORTAL' | 'TUNNEL';
export type Easing = 'linear' | 'smooth' | 'cinematic' | 'accelerate';

/** An intermediate absolute transform on a piecewise object trajectory. */
export interface MotionKeyframe {
  /** Strictly increasing normalized times between the implicit endpoints 0 and 1. */
  at: number;
  position: Vec3;
  /** Defaults to the endpoint rotations interpolated at `at`. */
  rotation?: Vec3;
  /** Defaults to the endpoint scales interpolated at `at`. */
  scale?: number;
  /** Easing of the segment ending here; defaults to the motion's easing. */
  easing?: Easing;
}

/** A brief damped recoil, evaluated in absolute time and settled at both ends. */
export interface ImpactMotion {
  start: number;
  end: number;
  /** Additive world-space displacement amplitude. */
  displacement?: Vec3;
  /** Additive Euler XYZ rotation amplitude in radians. */
  rotation?: Vec3;
  /** Relative scale amplitude: 0.08 gives an approximately 8% overshoot. */
  scale?: number;
}

export interface SceneObject {
  id: string;
  /** Original words and punctuation. Wrapping is a renderer layout decision. */
  text: string;
  /** Explicit line breaks only; the underlying words/punctuation stay intact. */
  displayText?: string;
  fontSize: number;
  position: Vec3;
  /** Euler angles in radians, applied in XYZ order. */
  rotation: Vec3;
  scale: number;
  colorRole: ColorRole;
  extruded: boolean;
  extrusionDepth: number;
  /** A semantic reading interval, rather than an object visibility interval. */
  readingInterval: readonly [number, number];
  /** Arrival from a world-space position before reaching the authored layout. */
  entrance?: {
    start: number;
    end: number;
    from: Vec3;
    /** Starting rotation; multiple turns are retained during interpolation. */
    rotation?: Vec3;
    /** Starting absolute scale. */
    scale?: number;
    /** Absolute cubic Bezier control points for the arrival. */
    controls?: readonly [Vec3, Vec3];
    /** Intermediate transforms; when non-empty, replace the cubic trajectory. */
    keyframes?: readonly MotionKeyframe[];
    easing: Easing;
  };
  /** Physical rearrangement for the final poster. */
  assembly?: {
    start: number;
    end: number;
    position: Vec3;
    rotation: Vec3;
    scale: number;
    easing: Easing;
  };
  /** Travel beyond the camera; empty frames come from clipping, never a fade. */
  exit?: {
    start: number;
    end: number;
    to: Vec3;
    /** Destination rotation; multiple turns are retained during interpolation. */
    rotation?: Vec3;
    /** Destination absolute scale. */
    scale?: number;
    /** Absolute cubic Bezier control points for the departure. */
    controls?: readonly [Vec3, Vec3];
    /** Intermediate transforms; when non-empty, replace the cubic trajectory. */
    keyframes?: readonly MotionKeyframe[];
    easing: Easing;
  };
  /** A short landing or emphasis recoil that finishes before readable holds. */
  impact?: ImpactMotion;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  /** Camera-local roll in radians. */
  roll: number;
}

export interface CameraTrack {
  id: string;
  start: number;
  end: number;
  primitive: MotionPrimitive;
  from: CameraPose;
  to: CameraPose;
  /** Absolute cubic Bezier control points; omit for straight travel. */
  controls?: readonly [Vec3, Vec3];
  easing: Easing;
  /** Aim from the live path position toward the interpolated authored targets. */
  trackTarget?: boolean;
  /** Follow a moving object's centre, retaining authored target offsets at each endpoint. Overrides trackTarget. */
  focusObjectId?: string;
  /** Whole local-Z turns in addition to the shortest orientation interpolation. */
  rollTurns?: number;
  /** Camera displacement is world-space; rotation is camera-local XYZ. */
  impact?: Omit<ImpactMotion, 'scale'>;
  /** True only at an intentional discontinuity in camera framing. */
  cutBefore?: boolean;
}

export interface SceneChapter {
  time: number;
  objectId: string | null;
  primitive: MotionPrimitive;
}

/** A separate image plane, rather than a typographic object or text overlay. */
export interface FinalImageObject {
  id: string;
  asset: ImageAsset;
  /** Original duration before this optional ending was appended. */
  baseDuration: number;
  /** Preserve the original reduced-motion/text inspection frame when removed. */
  basePosterTime?: number;
  /** Local geometry dimensions, fitted at scale 1 without changing its aspect. */
  width: number;
  height: number;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  entrance: NonNullable<SceneObject['entrance']>;
  exit: NonNullable<SceneObject['exit']>;
  /** Start-inclusive/end-exclusive; the image never exists in earlier shots. */
  visibleInterval: readonly [number, number];
}

export interface SceneSpec {
  id: string;
  generatorVersion: string;
  fontVersion: string;
  /** Font registry key; omitted by legacy scenes authored with Barlow. */
  fontId?: string;
  sourceText: string;
  inputLanguage: 'fr' | 'en';
  themeId: string;
  seed: number;
  /** Authored secret direction, shared by preview, seeking and video export. */
  secretFilm?: SecretFilmId;
  duration: number;
  fps: number;
  /** Width divided by height. */
  aspect: number;
  fov: number;
  /** Stable conclusion frame for reduced-motion preview and inspection. */
  posterTime?: number;
  /** Versioned generator signature; excludes palette-only changes. */
  structuralSignature?: string;
  /** Resolved generative choices, available to development inspection. */
  directionStyle?: {
    layout: string;
    entry: string;
    transition: string;
    reveal: string;
    finale: string;
    handedness: 1 | -1;
    advanced: 'portal' | 'tunnel' | 'none';
  };
  objects: readonly SceneObject[];
  cameraTracks: readonly CameraTrack[];
  chapters: readonly SceneChapter[];
  finalImages?: readonly FinalImageObject[];
}

export interface EvaluatedObject {
  id: string;
  position: Vec3;
  rotation: Vec3;
  scale: number;
}

export interface EvaluatedScene {
  time: number;
  trackId: string;
  camera: {
    position: Vec3;
    quaternion: Quat;
    fov: number;
  };
  objects: readonly EvaluatedObject[];
  finalImages?: readonly (EvaluatedObject & { visible: boolean })[];
}
