import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { futureDemo, FUTURE_POSTER_TIME, FUTURE_QUOTE } from '../src/demos/future';
import { evaluateScene } from '../src/scene/evaluator';
import type { CameraPose, EvaluatedObject, SceneSpec } from '../src/scene/types';

const kineticPose: CameraPose = { position: [0, 0, 9], target: [0, 0, 0], roll: 0 };
const kineticScene: SceneSpec = {
  ...futureDemo,
  id: 'kinetic-evaluator-fixture',
  duration: 4,
  posterTime: 3,
  objects: [{
    ...futureDemo.objects[0],
    id: 'kinetic-word',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    readingInterval: [1, 2],
    entrance: {
      start: 0,
      end: 0.8,
      from: [-3, 2, 20],
      rotation: [0, 0, Math.PI * 4],
      scale: 0.4,
      controls: [[-8, 6, 17], [-1, 3, 1]],
      easing: 'linear',
    },
    assembly: { start: 2.3, end: 2.8, position: [0, 1, 0], rotation: [0, 0, 0], scale: 0.7, easing: 'cinematic' },
    impact: { start: 2.55, end: 2.85, displacement: [0.03, 0.08, 0.15], rotation: [0.03, 0.01, 0.02], scale: 0.1 },
    exit: {
      start: 3.3,
      end: 3.9,
      to: [12, -7, 70],
      rotation: [Math.PI, -Math.PI, Math.PI * 4],
      scale: 1.5,
      controls: [[-3, 8, 0], [8, 4, 20]],
      easing: 'accelerate',
    },
  }],
  cameraTracks: [
    { id: 'barrel', start: 0, end: 0.9, primitive: 'ORBIT', from: kineticPose, to: kineticPose, easing: 'linear', rollTurns: 1 },
    { id: 'reading', start: 0.9, end: 2.3, primitive: 'HOLD', from: kineticPose, to: kineticPose, easing: 'linear' },
    {
      id: 'landing', start: 2.3, end: 2.85, primitive: 'REVEAL', from: kineticPose, to: kineticPose, easing: 'cinematic',
      impact: { start: 2.55, end: 2.85, displacement: [0.02, -0.04, 0.12], rotation: [0.012, -0.015, 0.01] },
    },
    { id: 'poster', start: 2.85, end: 4, primitive: 'HOLD', from: kineticPose, to: kineticPose, easing: 'linear' },
  ],
};

function objectQuaternion(rotation: readonly [number, number, number]): Quaternion {
  return new Quaternion().setFromEuler(new Euler(...rotation, 'XYZ'));
}

describe('authored scene and absolute-time evaluator', () => {
  it('preserves every word and punctuation in the fixed demonstration', () => {
    expect(futureDemo.objects.map((object) => object.text).join(' ')).toBe(FUTURE_QUOTE);
    futureDemo.objects.forEach((object) => {
      expect((object.displayText ?? object.text).replace(/\n/g, ' ')).toBe(object.text);
      expect(object.readingInterval[1] - object.readingInterval[0]).toBeGreaterThanOrEqual(0.9);
    });
    expect(futureDemo.duration).toBe(11.3);
    expect(futureDemo.aspect).toBe(9 / 16);
  });

  it('produces identical state after arbitrary forward and backward seeks', () => {
    const expected = evaluateScene(futureDemo, 9.25);
    [0, 12, 6, 1, 11.8, 5, 8.1].forEach((time) => evaluateScene(futureDemo, time));
    expect(evaluateScene(futureDemo, 9.25)).toEqual(expected);
  });

  it('carries the outgoing phrase into the next shot without the former jump at five seconds', () => {
    const departure = evaluateScene(futureDemo, 4.6);
    const before = evaluateScene(futureDemo, 5 - 0.000001);
    const after = evaluateScene(futureDemo, 5 + 0.000001);
    const arrival = evaluateScene(futureDemo, 5.45);
    expect(departure.camera).toEqual(evaluateScene(futureDemo, 4.599999).camera);
    expect(before.trackId).toBe('sentence-turn');
    expect(after.trackId).toBe('sentence-turn');
    expect(after.camera.position[1]).toBeGreaterThan(departure.camera.position[1]);
    expect(Math.hypot(...after.camera.position.map((value, axis) => value - before.camera.position[axis]))).toBeLessThan(0.001);
    expect(Math.hypot(...after.camera.quaternion.map((value, axis) => value - before.camera.quaternion[axis]))).toBeLessThan(0.001);
    expect(arrival.trackId).toBe('read-turn');
    const held = evaluateScene(futureDemo, 5.8);
    expect(arrival.camera.position).toEqual(held.camera.position);
    arrival.camera.quaternion.forEach((value, axis) => expect(value).toBeCloseTo(held.camera.quaternion[axis], 12));
  });

  it('keeps every non-cut transition spatially continuous', () => {
    futureDemo.cameraTracks.slice(1).forEach((track, index) => {
      const previous = futureDemo.cameraTracks[index];
      expect(previous.end).toBe(track.start);
      if (!track.cutBefore) {
        expect(previous.to).toEqual(track.from);
      }
    });
  });

  it('holds the complete poster before the spatial exit, then finishes beyond the camera', () => {
    const hold = futureDemo.cameraTracks.find(track => track.id === 'final-composition')!;
    expect(hold.end - hold.start).toBeCloseTo(0.6, 8);
    expect(FUTURE_POSTER_TIME).toBeGreaterThan(hold.start);
    expect(FUTURE_POSTER_TIME).toBeLessThan(hold.end);
    const start = evaluateScene(futureDemo, hold.start);
    const poster = evaluateScene(futureDemo, FUTURE_POSTER_TIME);
    expect(poster.camera).toEqual(start.camera);
    expect(poster.objects).toEqual(start.objects);
    const lastFrame = evaluateScene(futureDemo, futureDemo.duration - 1 / futureDemo.fps);
    expect(lastFrame.camera).toEqual(start.camera);
    lastFrame.objects.forEach((object) => {
      expect(object.position[2]).toBeGreaterThan(lastFrame.camera.position[2] + 1);
    });
    expect(lastFrame.objects).toEqual(evaluateScene(futureDemo, futureDemo.duration).objects);
    expect(evaluateScene(futureDemo, 999)).toEqual(evaluateScene(futureDemo, futureDemo.duration));
    expect(evaluateScene(futureDemo, -5)).toEqual(evaluateScene(futureDemo, 0));
  });

  it('assembles the same physical text objects by absolute time without changing content', () => {
    const initial = evaluateScene(futureDemo, 0.65);
    const before = evaluateScene(futureDemo, 8.5);
    const middle = evaluateScene(futureDemo, 9.15);
    const finished = evaluateScene(futureDemo, 9.8);
    expect(before.objects).toEqual(initial.objects);
    expect(middle.objects).not.toEqual(initial.objects);
    expect(middle.objects.map((object) => object.id)).toEqual(initial.objects.map((object) => object.id));
    finished.objects.forEach((object, index) => {
      const assembly = futureDemo.objects[index].assembly!;
      object.position.forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(assembly.position[axis], 12));
      expect(object.scale).toBeCloseTo(assembly.scale, 12);
    });
  });

  it('accelerates each existing phrase toward the screen without changing its scale or identity', () => {
    const poster = evaluateScene(futureDemo, FUTURE_POSTER_TIME);
    for (const [index, object] of futureDemo.objects.entries()) {
      const exit = object.exit!;
      const quarter = exit.start + (exit.end - exit.start) / 4;
      const half = exit.start + (exit.end - exit.start) / 2;
      const early = evaluateScene(futureDemo, quarter).objects[index];
      const later = evaluateScene(futureDemo, half).objects[index];
      expect(early.position[2]).toBeGreaterThan(poster.objects[index].position[2]);
      expect(later.position[2] - early.position[2]).toBeGreaterThan(early.position[2] - poster.objects[index].position[2]);
      expect(later.id).toBe(poster.objects[index].id);
      expect(later.scale).toBe(poster.objects[index].scale);
    }
    const expected = evaluateScene(futureDemo, 10.7);
    [futureDemo.duration, 0, 10.9, 4, FUTURE_POSTER_TIME].forEach(time => evaluateScene(futureDemo, time));
    expect(evaluateScene(futureDemo, 10.7)).toEqual(expected);
  });

  it('brings the opening hero from behind the camera and joins every object motion continuously', () => {
    const opening = evaluateScene(futureDemo, 0);
    expect(opening.objects[0].position[2]).toBeGreaterThan(opening.camera.position[2] + 1);
    expect(evaluateScene(futureDemo, 0.4).objects[0].position).toEqual(futureDemo.objects[0].position);
    for (const object of futureDemo.objects) {
      const index = futureDemo.objects.indexOf(object);
      for (const motion of [object.entrance, object.assembly, object.exit]) {
        if (!motion) continue;
        for (const time of [motion.start, motion.end]) {
          const before = evaluateScene(futureDemo, time - 0.000001).objects[index];
          const after = evaluateScene(futureDemo, time + 0.000001).objects[index];
          expect(Math.hypot(...after.position.map((value, axis) => value - before.position[axis]))).toBeLessThan(0.001);
        }
      }
    }
  });

  it('produces finite camera transforms and unit quaternions for every export frame', () => {
    for (let frame = 0; frame <= Math.ceil(futureDemo.duration * futureDemo.fps); frame += 1) {
      const state = evaluateScene(futureDemo, frame / 30);
      [...state.camera.position, ...state.camera.quaternion].forEach((value) => expect(Number.isFinite(value)).toBe(true));
      const length = Math.hypot(...state.camera.quaternion);
      expect(length).toBeCloseTo(1, 12);
    }
  });

  it('rejects non-finite times rather than corrupting the renderer state', () => {
    expect(() => evaluateScene(futureDemo, Number.NaN)).toThrow(RangeError);
    expect(() => evaluateScene(futureDemo, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('kinetic transform extensions', () => {
  it('retains whole camera turns instead of taking the shortest zero-rotation path', () => {
    const quarter = evaluateScene(kineticScene, 0.9 / 4);
    const localRight = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(...quarter.camera.quaternion));
    expect(localRight.x).toBeCloseTo(0, 12);
    expect(localRight.y).toBeCloseTo(1, 12);
    const midpoint = evaluateScene(kineticScene, 0.45);
    expect(new Quaternion(...midpoint.camera.quaternion).angleTo(new Quaternion())).toBeCloseTo(Math.PI, 12);
    // A whole turn has the same physical orientation, although quaternion signs can differ.
    const beforeEnd = evaluateScene(kineticScene, 0.9 - 1e-7);
    const settled = evaluateScene(kineticScene, 0.9);
    expect(new Quaternion(...beforeEnd.camera.quaternion).angleTo(new Quaternion(...settled.camera.quaternion))).toBeLessThan(1e-5);
  });

  it('moves curved spinning arrivals and departures continuously to their exact endpoints', () => {
    const entry = kineticScene.objects[0].entrance!;
    const start = evaluateScene(kineticScene, 0).objects[0];
    expect(start.position).toEqual(entry.from);
    expect(start.rotation).toEqual(entry.rotation);
    expect(start.scale).toBe(entry.scale);
    const midpoint = evaluateScene(kineticScene, 0.4).objects[0];
    expect(midpoint.rotation[2]).toBeCloseTo(Math.PI * 2, 12);
    expect(midpoint.scale).toBeCloseTo(0.7, 12);
    expect(midpoint.position[0]).toBeLessThan(-3); // The spatial arc cannot be a straight linear translation.
    const arrived = evaluateScene(kineticScene, 0.8).objects[0];
    expect(arrived.position).toEqual(kineticScene.objects[0].position);
    expect(arrived.rotation).toEqual(kineticScene.objects[0].rotation);
    expect(arrived.scale).toBe(1);
    const departed = evaluateScene(kineticScene, 3.9).objects[0];
    expect(departed.position).toEqual(kineticScene.objects[0].exit!.to);
    expect(departed.rotation).toEqual(kineticScene.objects[0].exit!.rotation);
    expect(departed.scale).toBe(1.5);
    expect(departed.position[2]).toBeGreaterThan(kineticPose.position[2] + 40);
  });

  it('gives landing impacts a strike and smaller opposing recoil, then an exactly stable reading poster', () => {
    const unimpacted: SceneSpec = {
      ...kineticScene,
      objects: kineticScene.objects.map(object => ({ ...object, impact: undefined })),
      cameraTracks: kineticScene.cameraTracks.map(track => ({ ...track, impact: undefined })),
    };
    const strikeTime = 2.55 + 0.3 * 0.19;
    const recoilTime = 2.55 + 0.3 * 0.45;
    const strike = evaluateScene(kineticScene, strikeTime);
    const strikeBase = evaluateScene(unimpacted, strikeTime);
    const recoil = evaluateScene(kineticScene, recoilTime);
    const recoilBase = evaluateScene(unimpacted, recoilTime);
    expect(strike.objects[0].scale).toBeGreaterThan(strikeBase.objects[0].scale);
    expect(recoil.objects[0].scale).toBeLessThan(recoilBase.objects[0].scale);
    expect(Math.abs(recoil.objects[0].scale / recoilBase.objects[0].scale - 1)).toBeLessThan(strike.objects[0].scale / strikeBase.objects[0].scale - 1);
    expect(strike.camera.position[2]).toBeGreaterThan(strikeBase.camera.position[2]);
    expect(recoil.camera.position[2]).toBeLessThan(recoilBase.camera.position[2]);
    expect(new Quaternion(...strike.camera.quaternion).angleTo(new Quaternion(...strikeBase.camera.quaternion))).toBeGreaterThan(0.01);
    for (const time of [2.55, 2.85, 3, 3.2]) expect(evaluateScene(kineticScene, time)).toEqual(evaluateScene(unimpacted, time));
    const poster = evaluateScene(kineticScene, 3);
    expect(poster.objects).toEqual(evaluateScene(kineticScene, 3.2).objects);
    expect(poster.camera).toEqual(evaluateScene(kineticScene, 3.2).camera);
    expect(evaluateScene(kineticScene, 1).objects).toEqual(evaluateScene(kineticScene, 2).objects);
  });

  it('keeps kinetic object and camera boundaries physically continuous', () => {
    const boundaries = [0.8, 0.9, 2.3, 2.55, 2.8, 2.85, 3.3, 3.9];
    for (const boundary of boundaries) {
      const before = evaluateScene(kineticScene, boundary - 1e-7);
      const after = evaluateScene(kineticScene, boundary + 1e-7);
      expect(Math.hypot(...after.camera.position.map((value, axis) => value - before.camera.position[axis]))).toBeLessThan(1e-4);
      expect(new Quaternion(...before.camera.quaternion).angleTo(new Quaternion(...after.camera.quaternion))).toBeLessThan(1e-4);
      expect(Math.hypot(...after.objects[0].position.map((value, axis) => value - before.objects[0].position[axis]))).toBeLessThan(1e-4);
      expect(objectQuaternion(before.objects[0].rotation).angleTo(objectQuaternion(after.objects[0].rotation))).toBeLessThan(1e-4);
      expect(Math.abs(after.objects[0].scale - before.objects[0].scale)).toBeLessThan(1e-4);
    }
  });

  it('is serializable, order-independent, finite and normalized throughout the kinetic film', () => {
    const restored: SceneSpec = JSON.parse(JSON.stringify(kineticScene));
    for (let frame = 0; frame <= 120; frame++) {
      const time = frame / 30;
      const expected = evaluateScene(kineticScene, time);
      [4, 0, 2.6, 0.23, 3.7].forEach(other => evaluateScene(kineticScene, other));
      expect(evaluateScene(restored, time)).toEqual(expected);
      expect(Math.hypot(...expected.camera.quaternion)).toBeCloseTo(1, 12);
      [...expected.camera.position, ...expected.camera.quaternion, ...expected.objects[0].position, ...expected.objects[0].rotation, expected.objects[0].scale]
        .forEach(value => expect(Number.isFinite(value)).toBe(true));
      expect(expected.objects[0].scale).toBeGreaterThan(0);
    }
  });
});

describe('piecewise object trajectories', () => {
  const scene: SceneSpec = {
    ...kineticScene,
    duration: 8,
    objects: [{
      ...kineticScene.objects[0],
      rotation: [0, 0, 1],
      impact: undefined,
      entrance: {
        start: 1, end: 3, from: [-10, 0, 8], rotation: [0, 0, 5], scale: 0.2,
        controls: [[100, 100, 100], [-100, -100, -100]],
        easing: 'accelerate',
        keyframes: [
          { at: 0.18, position: [-6, 3, 4], rotation: [0, 0, 7], scale: 0.6, easing: 'linear' },
          { at: 0.5, position: [5, 2, 1], easing: 'smooth' },
          { at: 0.8, position: [-1, -2, 0], rotation: [0, 1, 0], scale: 1.2 },
        ],
      },
      assembly: { start: 3.5, end: 4.5, position: [2, 4, 0], rotation: [0, 1, 2], scale: 0.6, easing: 'cinematic' },
      exit: {
        start: 5, end: 7, to: [20, -5, 50], rotation: [2, 3, 4], scale: 1.8,
        controls: [[100, 100, 100], [-100, -100, -100]],
        easing: 'accelerate',
        keyframes: [
          { at: 0.18, position: [7, 3, 4], easing: 'linear' },
          { at: 0.5, position: [-3, 0, 8], rotation: [1, 2, 3], scale: 0.3, easing: 'smooth' },
          { at: 0.8, position: [6, -2, 30] },
        ],
      },
    }],
    cameraTracks: [{ id: 'fixed', start: 0, end: 8, primitive: 'HOLD', from: kineticPose, to: kineticPose, easing: 'linear' }],
  };
  const object = scene.objects[0];

  function expectTransform(actual: EvaluatedObject, expected: Pick<EvaluatedObject, 'position' | 'rotation' | 'scale'>) {
    actual.position.forEach((value, axis) => expect(value).toBeCloseTo(expected.position[axis], 12));
    actual.rotation.forEach((value, axis) => expect(value).toBeCloseTo(expected.rotation[axis], 12));
    expect(actual.scale).toBeCloseTo(expected.scale, 12);
  }

  it('hits authored knots at their linear times, with exact implicit endpoints and endpoint defaults', () => {
    const entrance = object.entrance!;
    expectTransform(evaluateScene(scene, 0.5).objects[0], { position: entrance.from, rotation: entrance.rotation!, scale: entrance.scale! });
    expectTransform(evaluateScene(scene, 1).objects[0], { position: entrance.from, rotation: entrance.rotation!, scale: entrance.scale! });
    expectTransform(evaluateScene(scene, 1.36).objects[0], { position: [-6, 3, 4], rotation: [0, 0, 7], scale: 0.6 });
    expectTransform(evaluateScene(scene, 2).objects[0], { position: [5, 2, 1], rotation: [0, 0, 3], scale: 0.6 });
    expectTransform(evaluateScene(scene, 2.6).objects[0], { position: [-1, -2, 0], rotation: [0, 1, 0], scale: 1.2 });
    expectTransform(evaluateScene(scene, 3).objects[0], object);

    expectTransform(evaluateScene(scene, 5).objects[0], object.assembly!);
    expectTransform(evaluateScene(scene, 5.36).objects[0], { position: [7, 3, 4], rotation: [0.36, 1.36, 2.36], scale: 0.816 });
    expectTransform(evaluateScene(scene, 6).objects[0], { position: [-3, 0, 8], rotation: [1, 2, 3], scale: 0.3 });
    expectTransform(evaluateScene(scene, 6.6).objects[0], { position: [6, -2, 30], rotation: [1.6, 2.6, 3.6], scale: 1.56 });
    expectTransform(evaluateScene(scene, 7).objects[0], { position: object.exit!.to, rotation: object.exit!.rotation!, scale: object.exit!.scale! });
    expect(evaluateScene(scene, 8).objects).toEqual(evaluateScene(scene, 7).objects);
  });

  it('applies easing within each segment, using the destination keyframe or motion fallback', () => {
    // Halfway to the first knot: its linear easing overrides the overall acceleration.
    expectTransform(evaluateScene(scene, 1.18).objects[0], { position: [-8, 1.5, 6], rotation: [0, 0, 6], scale: 0.4 });
    // One quarter from the first to the second knot: smoothstep(0.25) = 0.15625.
    expectTransform(evaluateScene(scene, 1.52).objects[0], { position: [-4.28125, 2.84375, 3.53125], rotation: [0, 0, 6.375], scale: 0.6 });
    // Halfway to the third knot: omitted easing falls back to accelerate(0.5) = 0.125.
    expectTransform(evaluateScene(scene, 2.3).objects[0], { position: [4.25, 1.5, 0.875], rotation: [0, 0.125, 2.625], scale: 0.675 });
    // The final implicit endpoint also uses the motion easing.
    expectTransform(evaluateScene(scene, 2.8).objects[0], { position: [-0.875, -1.75, 0], rotation: [0, 0.875, 0.125], scale: 1.175 });
  });

  it('uses the assembled scale and rotation as exit endpoints when they are omitted', () => {
    const heldExit: SceneSpec = {
      ...scene,
      objects: [{ ...object, exit: { ...object.exit!, rotation: undefined, scale: undefined } }],
    };
    for (const time of [5, 5.36, 6.6, 7, 8]) {
      const state = evaluateScene(heldExit, time).objects[0];
      state.rotation.forEach((value, axis) => expect(value).toBeCloseTo(object.assembly!.rotation[axis], 12));
      expect(state.scale).toBeCloseTo(object.assembly!.scale, 12);
    }
    // Explicit keyframe values can still depart from that origin during the motion.
    expect(evaluateScene(heldExit, 6).objects[0].scale).toBeCloseTo(0.3, 12);
  });

  it('stays continuous at knots and endpoints and remains independent of seeking order', () => {
    for (const time of [1, 1.36, 2, 2.6, 3, 5, 5.36, 6, 6.6, 7]) {
      const before = evaluateScene(scene, time - 1e-7).objects[0];
      const after = evaluateScene(scene, time + 1e-7).objects[0];
      expect(Math.hypot(...after.position.map((value, axis) => value - before.position[axis]))).toBeLessThan(1e-4);
      expect(Math.hypot(...after.rotation.map((value, axis) => value - before.rotation[axis]))).toBeLessThan(1e-4);
      expect(Math.abs(after.scale - before.scale)).toBeLessThan(1e-4);
    }
    const restored: SceneSpec = JSON.parse(JSON.stringify(scene));
    const expected = evaluateScene(scene, 6.27);
    [8, 1.2, 6.8, 0, 4.1, 2.3].forEach(time => evaluateScene(scene, time));
    expect(evaluateScene(restored, 6.27)).toEqual(expected);
  });

  it('preserves the legacy cubic path and easing when keyframes are absent or empty', () => {
    const empty: SceneSpec = {
      ...kineticScene,
      objects: kineticScene.objects.map(legacy => ({
        ...legacy,
        entrance: { ...legacy.entrance!, keyframes: [] },
        exit: { ...legacy.exit!, keyframes: [] },
      })),
    };
    for (const time of [0, 0.23, 0.4, 0.8, 2.6, 3.3, 3.6, 3.9, 4]) {
      expect(evaluateScene(empty, time)).toEqual(evaluateScene(kineticScene, time));
    }
  });
});

describe('live camera target tracking', () => {
  const movingObject = {
    ...kineticScene.objects[0],
    entrance: undefined,
    exit: undefined,
    impact: undefined,
    assembly: { start: 0, end: 1, position: [6, -2, -3] as const, rotation: [0, 0, 0] as const, scale: 1, easing: 'cinematic' as const },
  };
  const from: CameraPose = { position: [0, 0, 15], target: [0, 0, 0], roll: 0 };
  const to: CameraPose = { position: [0, 0, 15], target: [6, -2, -3], roll: 0 };
  const focused: SceneSpec = {
    ...kineticScene,
    duration: 1.5,
    objects: [movingObject],
    cameraTracks: [
      { id: 'follow', start: 0, end: 1, primitive: 'REVEAL', from, to, controls: [[6, 3, 15], [6, 3, 15]], easing: 'cinematic', focusObjectId: movingObject.id, rollTurns: 1 },
      { id: 'settled', start: 1, end: 1.5, primitive: 'HOLD', from: to, to, easing: 'linear' },
    ],
  };

  it('aims from the actual curved camera position instead of interpolating endpoint orientations', () => {
    const pose: CameraPose = { position: [0, 0, 9], target: [0, 0, 0], roll: 0 };
    const tracked: SceneSpec = {
      ...focused,
      cameraTracks: [{ id: 'arc', start: 0, end: 1.5, primitive: 'ORBIT', from: pose, to: pose, controls: [[8, 4, 9], [8, 4, 9]], easing: 'linear', trackTarget: true }],
    };
    const state = evaluateScene(tracked, 0.75);
    const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...state.camera.quaternion));
    const toTarget = new Vector3(...pose.target).sub(new Vector3(...state.camera.position)).normalize();
    expect(forward.dot(toTarget)).toBeCloseTo(1, 12);
    expect(Math.abs(forward.x)).toBeGreaterThan(0.4);
    const untracked = evaluateScene({ ...tracked, cameraTracks: tracked.cameraTracks.map(track => ({ ...track, trackTarget: false })) }, 0.75);
    const untrackedForward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...untracked.camera.quaternion));
    expect(untrackedForward.dot(toTarget)).toBeLessThan(0.9);
  });

  it('keeps a physically assembling word on the camera axis throughout a full roll', () => {
    for (let frame = 0; frame < 30; frame++) {
      const state = evaluateScene(focused, frame / 30);
      const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...state.camera.quaternion));
      const toWord = new Vector3(...state.objects[0].position).sub(new Vector3(...state.camera.position)).normalize();
      expect(forward.dot(toWord)).toBeCloseTo(1, 12);
      expect(Math.hypot(...state.camera.quaternion)).toBeCloseTo(1, 12);
    }
    const expected = evaluateScene(focused, 0.43);
    [1.5, 0, 0.99, 0.2, 1.1].forEach(time => evaluateScene(focused, time));
    expect(evaluateScene(JSON.parse(JSON.stringify(focused)), 0.43)).toEqual(expected);
  });

  it('honors distinct authored target offsets at both focus endpoints without a boundary jump', () => {
    const biasedFrom: CameraPose = { ...from, target: [0.2, 0.1, 0], roll: 0.1 };
    const biasedTo: CameraPose = { ...to, target: [6.3, -2.2, -3], roll: -0.15 };
    const biased: SceneSpec = {
      ...focused,
      cameraTracks: [
        { ...focused.cameraTracks[0], from: biasedFrom, to: biasedTo, trackTarget: true },
        { ...focused.cameraTracks[1], from: biasedTo, to: biasedTo },
      ],
    };
    const withoutFocus: SceneSpec = { ...biased, cameraTracks: biased.cameraTracks.map(track => ({ ...track, trackTarget: false, focusObjectId: undefined })) };
    const start = evaluateScene(biased, 0);
    const baselineStart = evaluateScene(withoutFocus, 0);
    expect(new Quaternion(...start.camera.quaternion).angleTo(new Quaternion(...baselineStart.camera.quaternion))).toBeLessThan(1e-7);
    const before = evaluateScene(biased, 1 - 1e-7);
    const after = evaluateScene(biased, 1 + 1e-7);
    expect(new Quaternion(...before.camera.quaternion).angleTo(new Quaternion(...after.camera.quaternion))).toBeLessThan(1e-5);
    expect(after.camera).toEqual(evaluateScene(biased, 1.4).camera);
  });
});
