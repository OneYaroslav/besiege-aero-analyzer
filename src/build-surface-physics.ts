import type { SolverInput } from "./physics.ts";
import type { BuildSurfaceGeometry } from "./build-surface-geometry.ts";
import {
  buildSurfaceLocalVectorToMachine,
  buildSurfaceMachineDirectionToLocal,
} from "./build-surface-geometry.ts";
import {
  add,
  cross,
  dot,
  magnitudeSquared,
  scale,
  subtract,
  type Vec3,
} from "./math.ts";

export interface BuildSurfaceCornerResult {
  readonly cornerIndex: number;
  readonly position: Vec3;
  readonly radiusFromCg: Vec3;
  readonly pointVelocity: Vec3;
  readonly velocityLocal: Vec3;
  readonly normalLocal: Vec3;
  readonly dotNormalAgainstVelocity: number;
  readonly speedSquared: number;
  readonly cappedSpeedSquared: number;
  readonly forceLocal: Vec3;
  readonly force: Vec3;
  readonly momentAboutCg: Vec3;
  readonly power: number;
}

export interface BuildSurfaceResult {
  readonly surface: BuildSurfaceGeometry;
  readonly corners: readonly BuildSurfaceCornerResult[];
  readonly totalForce: Vec3;
  readonly totalMoment: Vec3;
  readonly totalPower: number;
}

export interface BuildSurfaceSolverResult {
  readonly surfaces: readonly BuildSurfaceResult[];
  readonly totalForce: Vec3;
  readonly totalMoment: Vec3;
  readonly totalPower: number;
}

/**
 * Literal BuildSurface.FixedUpdateBlock force law recovered from Besiege
 * 1.90-25346. Geometry is reconstructed in the BuildSurface block-local frame;
 * forces are then transformed with Unity TransformVector semantics.
 */
export function evaluateBuildSurface(
  surface: BuildSurfaceGeometry,
  input: SolverInput,
): BuildSurfaceResult {
  if (!surface.aerodynamicActive) {
    return { surface, corners: [], totalForce: [0, 0, 0], totalMoment: [0, 0, 0], totalPower: 0 };
  }
  const multiplier = surface.dragMultiplier * surface.surfaceArea / surface.corners.length;
  const corners = surface.corners.map((corner): BuildSurfaceCornerResult => {
    const radiusFromCg = subtract(corner.machinePosition, input.centerOfGravity);
    const pointVelocity = add(input.linearVelocity, cross(input.angularVelocity, radiusFromCg));
    const velocityLocal = buildSurfaceMachineDirectionToLocal(surface.block, pointVelocity);
    const dotNormalAgainstVelocity = dot(corner.localNormal, scale(velocityLocal, -1));
    const speedSquared = magnitudeSquared(pointVelocity);
    const cappedSpeedSquared = Math.min(speedSquared, surface.dragVelocityCapSquared);
    const forceLocal = scale(
      corner.localNormal,
      dotNormalAgainstVelocity * cappedSpeedSquared * multiplier,
    );
    const force = buildSurfaceLocalVectorToMachine(surface.block, forceLocal);
    const momentAboutCg = cross(radiusFromCg, force);
    return {
      cornerIndex: corner.index,
      position: corner.machinePosition,
      radiusFromCg,
      pointVelocity,
      velocityLocal,
      normalLocal: corner.localNormal,
      dotNormalAgainstVelocity,
      speedSquared,
      cappedSpeedSquared,
      forceLocal,
      force,
      momentAboutCg,
      power: dot(force, pointVelocity),
    };
  });
  let totalForce: Vec3 = [0, 0, 0];
  let totalMoment: Vec3 = [0, 0, 0];
  let totalPower = 0;
  for (const corner of corners) {
    totalForce = add(totalForce, corner.force);
    totalMoment = add(totalMoment, corner.momentAboutCg);
    totalPower += corner.power;
  }
  return { surface, corners, totalForce, totalMoment, totalPower };
}

export function solveBuildSurfaces(
  surfaces: readonly BuildSurfaceGeometry[],
  input: SolverInput,
): BuildSurfaceSolverResult {
  const results = surfaces.filter((surface) => surface.aerodynamicActive)
    .map((surface) => evaluateBuildSurface(surface, input));
  let totalForce: Vec3 = [0, 0, 0];
  let totalMoment: Vec3 = [0, 0, 0];
  let totalPower = 0;
  for (const result of results) {
    totalForce = add(totalForce, result.totalForce);
    totalMoment = add(totalMoment, result.totalMoment);
    totalPower += result.totalPower;
  }
  return { surfaces: results, totalForce, totalMoment, totalPower };
}
