import type { VanillaBlade } from "./bsg.ts";
import {
  add,
  cross,
  dot,
  magnitudeSquared,
  normalize,
  rotateVector,
  rotationAroundZ,
  scale,
  subtract,
  type Vec3,
} from "./math.ts";

export interface BladePhysicsSpec {
  readonly id: 26 | 55;
  readonly kind: "Propeller" | "SmallPropeller";
  readonly liftAngleDegrees: number;
  readonly axisDragY: number;
  readonly velocityCap: number;
}

/** Values recovered from Besiege 1.90-25346 vanilla prefabs/code. */
export const BLADE_SPECS: Readonly<Record<26 | 55, BladePhysicsSpec>> = {
  26: {
    id: 26,
    kind: "Propeller",
    liftAngleDegrees: 23.068759,
    axisDragY: 0.015,
    velocityCap: 30,
  },
  55: {
    id: 55,
    kind: "SmallPropeller",
    liftAngleDegrees: 22.844994,
    axisDragY: 0.015,
    velocityCap: 30,
  },
};

export interface SolverInput {
  /** All vectors are in machine-local coordinates. */
  readonly linearVelocity: Vec3;
  /** Radians per second, in machine-local coordinates. */
  readonly angularVelocity: Vec3;
  /** Manual center of gravity in machine-local coordinates. */
  readonly centerOfGravity: Vec3;
  /** Manual semantic axes. Defaults are supplied by the CLI, not the solver. */
  readonly forward: Vec3;
  readonly up: Vec3;
}

export interface MachineAxes {
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly right: Vec3;
}

export interface BladeResult {
  readonly blade: VanillaBlade;
  readonly radiusFromCg: Vec3;
  readonly localVelocity: Vec3;
  readonly speedSquared: number;
  readonly cappedSpeedSquared: number;
  readonly forceAxis: Vec3;
  readonly senseAxis: Vec3;
  readonly force: Vec3;
  readonly momentAboutCg: Vec3;
  readonly power: number;
}

export interface SolverResult {
  readonly input: SolverInput;
  readonly axes: MachineAxes;
  readonly blades: readonly BladeResult[];
  readonly totalForce: Vec3;
  readonly totalMoment: Vec3;
  readonly moments: {
    readonly pitch: number;
    readonly roll: number;
    readonly yaw: number;
  };
  readonly totalBladePower: number;
}

export function makeMachineAxes(forwardInput: Vec3, upInput: Vec3): MachineAxes {
  const forward = normalize(forwardInput, "forward axis");
  const upWithoutForward = subtract(upInput, scale(forward, dot(upInput, forward)));
  const up = normalize(upWithoutForward, "up axis after orthogonalization");
  // Unity convention for defaults: cross(+Y up, +Z forward) = +X right.
  const right = normalize(cross(up, forward), "right axis");
  return { forward, up, right };
}

export function bladeAxes(blade: VanillaBlade): { forceAxis: Vec3; senseAxis: Vec3 } {
  const spec = BLADE_SPECS[blade.id as 26 | 55];
  if (!spec) throw new Error(`Unsupported blade id ${blade.id}`);
  const localY: Vec3 = [0, 1, 0];
  const signedAngleDegrees = blade.flipped ? -spec.liftAngleDegrees : spec.liftAngleDegrees;
  const liftNormalLocal = rotateVector(rotationAroundZ(signedAngleDegrees * Math.PI / 180), localY);

  // Unity TransformDirection applies rotation but not Transform scale.
  return {
    forceAxis: normalize(rotateVector(blade.rotation, localY), "forceAxis"),
    senseAxis: normalize(rotateVector(blade.rotation, liftNormalLocal), "senseAxis"),
  };
}

export function evaluateBlade(blade: VanillaBlade, input: SolverInput): BladeResult {
  const spec = BLADE_SPECS[blade.id as 26 | 55];
  if (!spec) throw new Error(`Unsupported blade id ${blade.id}`);
  const radiusFromCg = subtract(blade.position, input.centerOfGravity);
  const localVelocity = add(input.linearVelocity, cross(input.angularVelocity, radiusFromCg));
  const speedSquared = magnitudeSquared(localVelocity);
  const cappedSpeedSquared = Math.min(speedSquared, spec.velocityCap * spec.velocityCap);
  const { forceAxis, senseAxis } = bladeAxes(blade);
  const forceScalar = -spec.axisDragY * dot(localVelocity, senseAxis) * cappedSpeedSquared;
  const force = scale(forceAxis, forceScalar);
  const momentAboutCg = cross(radiusFromCg, force);
  return {
    blade,
    radiusFromCg,
    localVelocity,
    speedSquared,
    cappedSpeedSquared,
    forceAxis,
    senseAxis,
    force,
    momentAboutCg,
    power: dot(force, localVelocity),
  };
}

export function solveBlades(blades: readonly VanillaBlade[], input: SolverInput): SolverResult {
  const axes = makeMachineAxes(input.forward, input.up);
  const results = blades.map((blade) => evaluateBlade(blade, input));
  let totalForce: Vec3 = [0, 0, 0];
  let totalMoment: Vec3 = [0, 0, 0];
  let totalBladePower = 0;
  for (const result of results) {
    totalForce = add(totalForce, result.force);
    totalMoment = add(totalMoment, result.momentAboutCg);
    totalBladePower += result.power;
  }
  return {
    input,
    axes,
    blades: results,
    totalForce,
    totalMoment,
    moments: {
      pitch: dot(totalMoment, axes.right),
      roll: dot(totalMoment, axes.forward),
      yaw: dot(totalMoment, axes.up),
    },
    totalBladePower,
  };
}
