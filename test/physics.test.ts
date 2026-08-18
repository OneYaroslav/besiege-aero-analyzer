import assert from "node:assert/strict";
import test from "node:test";
import type { VanillaBlade } from "../src/bsg.ts";
import { cross, magnitude, scale, type Quaternion, type Vec3 } from "../src/math.ts";
import { bladeAxes, evaluateBlade, solveBlades, type SolverInput } from "../src/physics.ts";

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const BASE_INPUT: SolverInput = {
  linearVelocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  centerOfGravity: [0, 0, 0],
  forward: [0, 0, 1],
  up: [0, 1, 0],
};

function blade(overrides: Partial<VanillaBlade> = {}): VanillaBlade {
  return {
    id: 26,
    guid: "test-blade",
    kind: "Propeller",
    position: [0, 0, 0],
    rotation: IDENTITY,
    scale: [1, 1, 1],
    booleans: new Map(),
    singles: new Map(),
    integers: new Map(),
    strings: new Map(),
    vectors: new Map(),
    flipped: false,
    flippedWasSerialized: true,
    ...overrides,
  };
}

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function vecClose(actual: Vec3, expected: Vec3, tolerance = 1e-9): void {
  actual.forEach((value, index) => close(value, expected[index], tolerance));
}

test("flipped reverses the liftNormal angle but leaves forceAxis unchanged", () => {
  const normalBlade = blade({ flipped: false });
  const flippedBlade = blade({ flipped: true });
  const normalAxes = bladeAxes(normalBlade);
  const flippedAxes = bladeAxes(flippedBlade);
  vecClose(normalAxes.forceAxis, [0, 1, 0]);
  vecClose(flippedAxes.forceAxis, [0, 1, 0]);
  close(normalAxes.senseAxis[0], -flippedAxes.senseAxis[0]);
  close(normalAxes.senseAxis[1], flippedAxes.senseAxis[1]);

  const velocity: Vec3 = [10, 0, 0];
  const normal = evaluateBlade(normalBlade, { ...BASE_INPUT, linearVelocity: velocity });
  const flipped = evaluateBlade(flippedBlade, { ...BASE_INPUT, linearVelocity: velocity });
  vecClose(normal.force, scale(flipped.force, -1));
});

test("bmt-Enhancement=true leaves aero enabled by default and does not change the law", () => {
  const normal = blade();
  const enhanced = blade({ booleans: new Map([["bmt-Enhancement", true]]) });
  const input = { ...BASE_INPUT, linearVelocity: [0, 0, 100] as Vec3 };
  assert.deepEqual(evaluateBlade(enhanced, input).force, evaluateBlade(normal, input).force);
});

test("speed-squared multiplier caps at velocity 30", () => {
  const subject = blade();
  const senseAxis = bladeAxes(subject).senseAxis;
  const at20 = evaluateBlade(subject, { ...BASE_INPUT, linearVelocity: scale(senseAxis, 20) });
  const at40 = evaluateBlade(subject, { ...BASE_INPUT, linearVelocity: scale(senseAxis, 40) });
  close(at20.cappedSpeedSquared, 400);
  close(at40.cappedSpeedSquared, 900);
  close(magnitude(at20.force), 0.015 * 20 * 400, 1e-8);
  close(magnitude(at40.force), 0.015 * 40 * 900, 1e-8);
});

test("local blade velocity includes omega cross r", () => {
  const subject = blade({ position: [0, 0, 10] });
  const omega: Vec3 = [0.1, 0, 0];
  vecClose(cross(omega, subject.position), [0, -1, 0]);
  const result = evaluateBlade(subject, { ...BASE_INPUT, angularVelocity: omega });
  vecClose(result.localVelocity, [0, -1, 0]);
  vecClose(result.radiusFromCg, [0, 0, 10]);
  assert.notEqual(magnitude(result.momentAboutCg), 0);
});

test("pitch/roll/yaw projections use manual right/forward/up axes", () => {
  const result = solveBlades([blade({ position: [0, 0, 10] })], {
    ...BASE_INPUT,
    linearVelocity: [0, -1, 0],
  });
  close(result.moments.pitch, result.totalMoment[0]);
  close(result.moments.roll, result.totalMoment[2]);
  close(result.moments.yaw, result.totalMoment[1]);
});
