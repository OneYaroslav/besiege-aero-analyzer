import type { VanillaBlade } from "./bsg.ts";
import type { BuildSurfaceGeometry } from "./build-surface-geometry.ts";
import { solveBuildSurfaces, type BuildSurfaceResult } from "./build-surface-physics.ts";
import { add, dot, type Vec3 } from "./math.ts";
import { solveBlades, type BladeResult, type MachineAxes, type SolverInput } from "./physics.ts";

export interface AerodynamicSourceTotals {
  readonly force: Vec3;
  readonly moment: Vec3;
  readonly moments: {
    readonly pitch: number;
    readonly roll: number;
    readonly yaw: number;
  };
  readonly power: number;
}

export interface AerodynamicSolverResult {
  readonly input: SolverInput;
  readonly axes: MachineAxes;
  readonly blades: readonly BladeResult[];
  readonly buildSurfaces: readonly BuildSurfaceResult[];
  readonly bladeTotals: AerodynamicSourceTotals;
  readonly buildSurfaceTotals: AerodynamicSourceTotals;
  readonly totalForce: Vec3;
  readonly totalMoment: Vec3;
  readonly moments: AerodynamicSourceTotals["moments"];
  readonly totalPower: number;
  /** Blade-only legacy field retained for blade tables and export compatibility. */
  readonly totalBladePower: number;
  readonly totalBuildSurfacePower: number;
}

function projectedMoments(moment: Vec3, axes: MachineAxes): AerodynamicSourceTotals["moments"] {
  return {
    pitch: dot(moment, axes.right),
    roll: dot(moment, axes.forward),
    yaw: dot(moment, axes.up),
  };
}

export function solveAerodynamics(
  blades: readonly VanillaBlade[],
  buildSurfaces: readonly BuildSurfaceGeometry[],
  input: SolverInput,
): AerodynamicSolverResult {
  const bladeResult = solveBlades(blades, input);
  const surfaceResult = solveBuildSurfaces(buildSurfaces, input);
  const totalForce = add(bladeResult.totalForce, surfaceResult.totalForce);
  const totalMoment = add(bladeResult.totalMoment, surfaceResult.totalMoment);
  return {
    input,
    axes: bladeResult.axes,
    blades: bladeResult.blades,
    buildSurfaces: surfaceResult.surfaces,
    bladeTotals: {
      force: bladeResult.totalForce,
      moment: bladeResult.totalMoment,
      moments: bladeResult.moments,
      power: bladeResult.totalBladePower,
    },
    buildSurfaceTotals: {
      force: surfaceResult.totalForce,
      moment: surfaceResult.totalMoment,
      moments: projectedMoments(surfaceResult.totalMoment, bladeResult.axes),
      power: surfaceResult.totalPower,
    },
    totalForce,
    totalMoment,
    moments: projectedMoments(totalMoment, bladeResult.axes),
    totalPower: bladeResult.totalBladePower + surfaceResult.totalPower,
    totalBladePower: bladeResult.totalBladePower,
    totalBuildSurfacePower: surfaceResult.totalPower,
  };
}
