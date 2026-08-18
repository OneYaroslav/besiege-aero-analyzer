import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBladeContributions,
  analyzeStability,
  angularVelocityFromRates,
  centralDifference,
  compareMachines,
  degreesToRadians,
  velocityFromSpeedAngles,
  type AnalysisState,
  type MachineAnalysisConfig,
} from "../src/analysis.ts";
import type { BsgMachine, VanillaBlade } from "../src/bsg.ts";
import type { AnalysisGroup } from "../src/groups.ts";
import { magnitude, rotationAroundZ, type Quaternion, type Vec3 } from "../src/math.ts";

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function vecClose(actual: Vec3, expected: Vec3, tolerance = 1e-9): void {
  actual.forEach((value, index) => close(value, expected[index], tolerance));
}

function blade(guid: string, position: Vec3, overrides: Partial<VanillaBlade> = {}): VanillaBlade {
  return {
    id: 26,
    guid,
    kind: "Propeller",
    position,
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

function group(blades: readonly VanillaBlade[]): AnalysisGroup {
  return { label: "synthetic", mode: "include", blocks: blades, excludedGuids: [], warnings: [] };
}

function state(blades: readonly VanillaBlade[], overrides: Partial<AnalysisState> = {}): AnalysisState {
  return {
    speed: 10,
    alpha: 0,
    beta: 0,
    p: 0,
    q: 0,
    r: 0,
    centerOfGravity: [0, 0, 0],
    analysisGroup: group(blades),
    ...overrides,
  };
}

function machine(name: string, blades: readonly VanillaBlade[]): BsgMachine {
  return {
    source: `<${name}>`,
    name,
    version: "test",
    bsgVersion: "1.4",
    globalPosition: [0, 0, 0],
    globalRotation: IDENTITY,
    blocks: blades,
    warnings: [],
  };
}

test("speed/alpha/beta construction follows fixed +Z/+Y/+X convention", () => {
  vecClose(velocityFromSpeedAngles(10, 0, 0), [0, 0, 10]);
  vecClose(velocityFromSpeedAngles(10, degreesToRadians(30), 0), [0, -5, 5 * Math.sqrt(3)]);
  vecClose(velocityFromSpeedAngles(10, degreesToRadians(-30), 0), [0, 5, 5 * Math.sqrt(3)]);
  vecClose(velocityFromSpeedAngles(10, 0, degreesToRadians(30)), [5, 0, 5 * Math.sqrt(3)]);
  vecClose(velocityFromSpeedAngles(10, 0, degreesToRadians(-30)), [-5, 0, 5 * Math.sqrt(3)]);
  close(magnitude(velocityFromSpeedAngles(10, degreesToRadians(20), degreesToRadians(-15))), 10);
});

test("p/q/r map to roll +Z, pitch +X, yaw +Y", () => {
  vecClose(angularVelocityFromRates(1, 2, 3), [2, 3, 1]);
});

test("central difference is exact for a known linear function", () => {
  const x = 4;
  const h = 0.125;
  const fn = (value: number): number => 3 * value - 7;
  close(centralDifference(fn(x + h), fn(x - h), h), 3);
});

test("synthetic blades verify alpha/beta restoring signs and rotational damping sign", () => {
  const pitchBlade = blade("pitch", [0, 0, 1]);
  const pitch = analyzeStability([pitchBlade], state([pitchBlade]), {
    alphaRadians: 0.001,
    betaRadians: 0.001,
    rateRadPerSecond: 0.001,
  });
  assert.ok(pitch.derivatives.static.pitchAlpha.derivative < 0, "positive alpha must produce negative M_pitch derivative");
  assert.ok(pitch.derivatives.damping.pitchQ.derivative < 0, "positive q must produce opposing M_pitch derivative");

  const yawBlade = blade("yaw", [0, 0, 1], { rotation: rotationAroundZ(-Math.PI / 2) });
  const yaw = analyzeStability([yawBlade], state([yawBlade]), {
    alphaRadians: 0.001,
    betaRadians: 0.001,
    rateRadPerSecond: 0.001,
  });
  assert.ok(yaw.derivatives.static.yawBeta.derivative < 0, "positive beta must produce negative M_yaw derivative");
  assert.ok(yaw.derivatives.damping.yawR.derivative < 0, "positive r must produce opposing M_yaw derivative");
});

test("mirrored blades have equal roll-damping contributions and cancel cross pitch", () => {
  const left = blade("left", [-2, 0, 0]);
  const right = blade("right", [2, 0, 0]);
  const subjectState = state([left, right]);
  const stability = analyzeStability([left, right], subjectState, {
    alphaRadians: 0.001,
    betaRadians: 0.001,
    rateRadPerSecond: 0.001,
  });
  assert.ok(stability.derivatives.damping.rollP.derivative < 0);
  close(stability.derivatives.crossDamping.pitchP.derivative, 0, 1e-10);
  const contributions = analyzeBladeContributions([left, right], subjectState, "roll-damping", {
    alphaRadians: 0.001,
    betaRadians: 0.001,
    rateRadPerSecond: 0.001,
  });
  close(contributions.blades[0].derivativeContribution, contributions.blades[1].derivativeContribution, 1e-10);
});

test("per-blade derivative contributions sum to the total central derivative", () => {
  const blades = [blade("near", [0, 0, 1]), blade("far", [0, 0, 3])];
  const result = analyzeBladeContributions(blades, state(blades), "pitch-damping", {
    alphaRadians: 0.01,
    betaRadians: 0.01,
    rateRadPerSecond: 0.01,
  });
  close(result.contributionSum, result.totalDerivative, 1e-10);
  assert.equal(result.blades[0].guid, "far");
  assert.ok(result.blades[0].absoluteContribution > result.blades[1].absoluteContribution);
});

test("compare mode applies one AnalysisState configuration to simple machines", () => {
  const first = machine("one-blade", [blade("a", [0, 0, 1])]);
  const second = machine("two-blades", [blade("b", [0, 0, -1]), blade("c", [0, 0, 1])]);
  const config: MachineAnalysisConfig = {
    speed: 10,
    alpha: 0,
    beta: 0,
    p: 0,
    q: 0,
    r: 0,
    centerOfGravity: [0, 0, 0],
    groupMode: "all",
    steps: { alphaRadians: 0.01, betaRadians: 0.01, rateRadPerSecond: 0.01 },
  };
  const comparison = compareMachines(first, second, config);
  assert.equal(comparison.first.blades.length, 1);
  assert.equal(comparison.second.blades.length, 2);
  close(comparison.first.state.speed, comparison.second.state.speed);
  assert.ok(
    Math.abs(comparison.second.stability.derivatives.damping.pitchQ.derivative) >
    Math.abs(comparison.first.stability.derivatives.damping.pitchQ.derivative),
  );
});

test("disabled blade mask changes aero results without changing group mass or source blades", () => {
  const blades = [blade("enabled", [0, 0, 1]), blade("disabled", [0, 0, 3])];
  const subject = machine("what-if", blades);
  const base: MachineAnalysisConfig = {
    speed: 10,
    alpha: degreesToRadians(5),
    beta: 0,
    p: 0,
    q: 0,
    r: 0,
    centerOfGravity: [0, 0, 0],
    groupMode: "all",
  };
  const all = compareMachines(subject, subject, base).first;
  const masked = compareMachines(subject, subject, {
    ...base,
    disabledBladeGuids: new Set(["disabled"]),
  }).first;
  assert.equal(masked.availableBlades.length, 2);
  assert.equal(masked.blades.length, 1);
  assert.equal(masked.machine.blocks.length, 2);
  close(masked.mass.totalMass, all.mass.totalMass);
  assert.notDeepEqual(masked.stability.baseline.totalMoment, all.stability.baseline.totalMoment);
  assert.equal(masked.disabledBladeGuids.has("disabled"), true);
});
