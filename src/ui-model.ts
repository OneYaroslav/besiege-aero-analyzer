import {
  ANALYSIS_CONVENTION,
  DEFAULT_DERIVATIVE_STEPS,
  analyzeBladeContributions,
  analyzeMachine,
  sweepAlpha,
  sweepBeta,
  sweepRate,
  type BladeContributionAnalysis,
  type ContributionDerivative,
  type DerivativeSteps,
  type MachineAnalysis,
  type SweepResult,
} from "./analysis.ts";
import { extractVanillaBlades, type BsgMachine, type VanillaBlade } from "./bsg.ts";
import { suggestComponents, type AnalysisGroup, type ComponentSuggestion } from "./groups.ts";
import { analyzeMass } from "./mass.ts";
import type { Vec3 } from "./math.ts";
import type { PlotLabUiState } from "./plot-lab.ts";
import type { AnalysisSnapshot, BladeGroup } from "./session-state.ts";
import { applyBladeWhatIfOverrides, type BladeWhatIfOverride } from "./what-if.ts";

export const UI_ANALYSIS_VERSION = "0.5.0-ui-poc";

export interface OperatingPoint {
  readonly speed: number;
  readonly alphaDegrees: number;
  readonly betaDegrees: number;
  readonly p: number;
  readonly q: number;
  readonly r: number;
}

export const DEFAULT_OPERATING_POINT: OperatingPoint = {
  speed: 100,
  alphaDegrees: 0,
  betaDegrees: 0,
  p: 0,
  q: 0,
  r: 0,
};

export type UiGroupSelection =
  | { readonly kind: "all" }
  | { readonly kind: "aircraft" }
  | { readonly kind: "component"; readonly index: number };

export interface ComponentDiagnostic {
  readonly index: number;
  readonly blockCount: number;
  readonly bladeCount: number;
  readonly mass: number | null;
  readonly centerOfGravity: Vec3 | null;
  readonly distanceToBladeCentroid: number;
  readonly suggestedAircraft: boolean;
  readonly warning?: string;
}

export interface MachineDiscovery {
  readonly suggestion: ComponentSuggestion;
  readonly components: readonly ComponentDiagnostic[];
}

export interface UiAnalysisBundle {
  readonly report: MachineAnalysis;
  readonly discovery: MachineDiscovery;
  readonly groupSelection: UiGroupSelection;
  readonly groupStatus: "ALL BLOCKS" | "HEURISTIC";
  readonly sweeps: Readonly<Record<"alpha" | "beta" | "p" | "q" | "r", SweepResult>>;
  readonly contribution: BladeContributionAnalysis;
  /** Existing per-blade central-difference analyses, precomputed for spatial display modes. */
  readonly contributions: Readonly<Record<ContributionDerivative, BladeContributionAnalysis>>;
  readonly whatIfOverrides: readonly BladeWhatIfOverride[];
}

export interface BladeTableRow {
  readonly index: number;
  readonly blade: VanillaBlade;
  readonly enabled: boolean;
  readonly force: Vec3;
  readonly moment: Vec3;
  readonly rollMoment: number;
  readonly pitchMoment: number;
  readonly yawMoment: number;
  readonly power: number;
}

export interface ComparisonRow {
  readonly key: string;
  readonly label: string;
  readonly units: string;
  readonly first: number | Vec3;
  readonly second: number | Vec3;
}

export type PrecisionMode = "auto" | "3" | "6";

export interface UiExportState {
  readonly precision: PrecisionMode;
  readonly plotLab: PlotLabUiState;
  readonly activeMachine?: "A" | "B";
  readonly showDeltaPercent?: boolean;
  readonly bladeGroups?: readonly (readonly BladeGroup[])[];
  readonly snapshots?: readonly AnalysisSnapshot[];
}

export function discoverMachine(machine: BsgMachine, proximityThreshold = 1.5): MachineDiscovery {
  const blades = extractVanillaBlades(machine);
  const suggestion = suggestComponents(machine, blades, proximityThreshold);
  const components = suggestion.components.map((component) => {
    const componentSet = new Set(component.blocks.map((block) => block.guid));
    const group: AnalysisGroup = {
      label: `heuristic component #${component.index}`,
      mode: "include",
      blocks: component.blocks,
      excludedGuids: machine.blocks.filter((block) => !componentSet.has(block.guid)).map((block) => block.guid),
      warnings: [suggestion.warning],
    };
    try {
      const mass = analyzeMass(group);
      return {
        index: component.index,
        blockCount: component.blocks.length,
        bladeCount: component.bladeCount,
        mass: mass.totalMass,
        centerOfGravity: mass.centerOfMass,
        distanceToBladeCentroid: component.distanceToBladeCentroid,
        suggestedAircraft: component === suggestion.suggestedAircraft,
      } satisfies ComponentDiagnostic;
    } catch (error) {
      return {
        index: component.index,
        blockCount: component.blocks.length,
        bladeCount: component.bladeCount,
        mass: null,
        centerOfGravity: null,
        distanceToBladeCentroid: component.distanceToBladeCentroid,
        suggestedAircraft: component === suggestion.suggestedAircraft,
        warning: error instanceof Error ? error.message : String(error),
      } satisfies ComponentDiagnostic;
    }
  });
  return { suggestion, components };
}

function groupConfig(
  selection: UiGroupSelection,
  discovery: MachineDiscovery,
): Pick<Parameters<typeof analyzeMachine>[1], "groupMode" | "includeGuids"> {
  if (selection.kind === "all") return { groupMode: "all", includeGuids: new Set() };
  if (selection.kind === "aircraft") return { groupMode: "aircraft-heuristic", includeGuids: new Set() };
  const component = discovery.suggestion.components.find((candidate) => candidate.index === selection.index);
  if (!component) throw new Error(`Heuristic component #${selection.index} does not exist`);
  return {
    groupMode: "all",
    includeGuids: new Set(component.blocks.map((block) => block.guid)),
  };
}

export function buildUiAnalysis(
  machine: BsgMachine,
  discovery: MachineDiscovery,
  selection: UiGroupSelection,
  operatingPoint: OperatingPoint,
  disabledBladeGuids: ReadonlySet<string>,
  contributionDerivative: ContributionDerivative,
  whatIfOverrides: readonly BladeWhatIfOverride[] = [],
  steps: DerivativeSteps = DEFAULT_DERIVATIVE_STEPS,
): UiAnalysisBundle {
  const effectiveMachine = applyBladeWhatIfOverrides(machine, whatIfOverrides);
  const groups = groupConfig(selection, discovery);
  const report = analyzeMachine(effectiveMachine, {
    speed: operatingPoint.speed,
    alpha: operatingPoint.alphaDegrees * Math.PI / 180,
    beta: operatingPoint.betaDegrees * Math.PI / 180,
    p: operatingPoint.p,
    q: operatingPoint.q,
    r: operatingPoint.r,
    centerOfGravity: "auto",
    groupMode: groups.groupMode,
    includeGuids: groups.includeGuids,
    excludeGuids: new Set(),
    proximityThreshold: discovery.suggestion.threshold,
    disabledBladeGuids,
    steps,
  });
  const contributionKinds: readonly ContributionDerivative[] = [
    "pitch-damping",
    "yaw-damping",
    "roll-damping",
    "pitch-alpha",
    "yaw-beta",
  ];
  const contributions = Object.fromEntries(contributionKinds.map((derivative) => [
    derivative,
    analyzeBladeContributions(report.blades, report.state, derivative, steps, report.buildSurfaces),
  ])) as Record<ContributionDerivative, BladeContributionAnalysis>;
  return {
    report,
    discovery,
    groupSelection: selection,
    groupStatus: selection.kind === "all" ? "ALL BLOCKS" : "HEURISTIC",
    sweeps: {
      alpha: sweepAlpha(report.blades, report.state, undefined, report.buildSurfaces),
      beta: sweepBeta(report.blades, report.state, undefined, report.buildSurfaces),
      p: sweepRate(report.blades, report.state, "p", undefined, report.buildSurfaces),
      q: sweepRate(report.blades, report.state, "q", undefined, report.buildSurfaces),
      r: sweepRate(report.blades, report.state, "r", undefined, report.buildSurfaces),
    },
    contribution: contributions[contributionDerivative],
    contributions,
    whatIfOverrides,
  };
}

export function buildBladeRows(bundle: UiAnalysisBundle): readonly BladeTableRow[] {
  const byGuid = new Map(bundle.report.stability.baseline.blades.map((entry) => [entry.blade.guid, entry]));
  return bundle.report.availableBlades.map((blade, index) => {
    const result = byGuid.get(blade.guid);
    const moment: Vec3 = result?.momentAboutCg ?? [0, 0, 0];
    return {
      index: index + 1,
      blade,
      enabled: result !== undefined,
      force: result?.force ?? [0, 0, 0],
      moment,
      rollMoment: moment[2],
      pitchMoment: moment[0],
      yawMoment: moment[1],
      power: result?.power ?? 0,
    };
  });
}

export function assembleComparisonRows(first: UiAnalysisBundle, second: UiAnalysisBundle): readonly ComparisonRow[] {
  const a = first.report;
  const b = second.report;
  return [
    { key: "mass", label: "Mass", units: "game mass units", first: a.mass.totalMass, second: b.mass.totalMass },
    { key: "cg", label: "CG X/Y/Z", units: "game units", first: a.state.centerOfGravity, second: b.state.centerOfGravity },
    { key: "blades", label: "Enabled blade count", units: "count", first: a.blades.length, second: b.blades.length },
    { key: "force", label: "Fx/Fy/Fz", units: "game force units", first: a.stability.baseline.totalForce, second: b.stability.baseline.totalForce },
    { key: "moment", label: "Pitch/Yaw/Roll", units: "game moment units", first: [a.stability.baseline.moments.pitch, a.stability.baseline.moments.yaw, a.stability.baseline.moments.roll], second: [b.stability.baseline.moments.pitch, b.stability.baseline.moments.yaw, b.stability.baseline.moments.roll] },
    { key: "power", label: "Aerodynamic power ΣF·u", units: "game power units", first: a.stability.baseline.totalPower, second: b.stability.baseline.totalPower },
    { key: "pitch-alpha", label: "dM_pitch/dAlpha", units: "moment/radian", first: a.stability.derivatives.static.pitchAlpha.derivative, second: b.stability.derivatives.static.pitchAlpha.derivative },
    { key: "yaw-beta", label: "dM_yaw/dBeta", units: "moment/radian", first: a.stability.derivatives.static.yawBeta.derivative, second: b.stability.derivatives.static.yawBeta.derivative },
    { key: "roll-beta", label: "dM_roll/dBeta", units: "moment/radian", first: a.stability.derivatives.static.rollBeta.derivative, second: b.stability.derivatives.static.rollBeta.derivative },
    { key: "roll-p", label: "dM_roll/dp", units: "moment/(rad/s)", first: a.stability.derivatives.damping.rollP.derivative, second: b.stability.derivatives.damping.rollP.derivative },
    { key: "pitch-q", label: "dM_pitch/dq", units: "moment/(rad/s)", first: a.stability.derivatives.damping.pitchQ.derivative, second: b.stability.derivatives.damping.pitchQ.derivative },
    { key: "yaw-r", label: "dM_yaw/dr", units: "moment/(rad/s)", first: a.stability.derivatives.damping.yawR.derivative, second: b.stability.derivatives.damping.yawR.derivative },
  ];
}

export function formatNumber(value: number, precision: PrecisionMode): string {
  if (!Number.isFinite(value)) return String(value);
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return precision === "6" ? "0.000000" : precision === "3" ? "0.000" : "0";
  if (precision === "3") return value.toFixed(3);
  if (precision === "6") return value.toFixed(6);
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-4) return value.toExponential(5);
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7, useGrouping: false }).format(value);
}

function machineExport(bundle: UiAnalysisBundle, bladeGroups: readonly BladeGroup[] = []): object {
  const report = bundle.report;
  return {
    metadata: {
      name: report.machine.name,
      source: report.machine.source,
      version: report.machine.version,
      bsgVersion: report.machine.bsgVersion,
      totalBlockCount: report.machine.blocks.length,
    },
    selectedAnalysisGroup: {
      uiSelection: bundle.groupSelection,
      status: bundle.groupStatus,
      label: report.mass.group.label,
      selectedBlockCount: report.mass.group.blocks.length,
      excludedGuids: report.mass.group.excludedGuids,
    },
    mass: {
      total: report.mass.totalMass,
      centerOfGravity: report.state.centerOfGravity,
      provenanceCounts: report.mass.provenanceCounts,
      database: report.mass.database,
    },
    blades: {
      availableCount: report.availableBlades.length,
      enabledCount: report.blades.length,
      disabledGuids: [...report.disabledBladeGuids],
      groups: bladeGroups,
      whatIfOverrides: bundle.whatIfOverrides,
    },
    buildSurfaces: {
      availableCount: report.availableBuildSurfaces.length,
      activeCount: report.buildSurfaces.length,
      warnings: report.buildSurfaceWarnings,
      active: report.stability.baseline.buildSurfaces.map((result) => ({
        guid: result.surface.block.guid,
        material: result.surface.material,
        surfaceArea: result.surface.surfaceArea,
        totalForce: result.totalForce,
        totalMoment: result.totalMoment,
        totalPower: result.totalPower,
        corners: result.corners.map((corner) => ({
          position: corner.position,
          pointVelocity: corner.pointVelocity,
          force: corner.force,
          momentAboutCg: corner.momentAboutCg,
          power: corner.power,
        })),
      })),
    },
    operatingPoint: {
      speed: report.state.speed,
      alphaRadians: report.state.alpha,
      alphaDegrees: report.state.alpha * 180 / Math.PI,
      betaRadians: report.state.beta,
      betaDegrees: report.state.beta * 180 / Math.PI,
      p: report.state.p,
      q: report.state.q,
      r: report.state.r,
      linearVelocity: report.stability.linearVelocity,
      angularVelocity: report.stability.angularVelocity,
    },
    finiteDifferenceSteps: report.stability.steps,
    baseline: {
      totalForce: report.stability.baseline.totalForce,
      totalMoment: report.stability.baseline.totalMoment,
      moments: report.stability.baseline.moments,
      totalPower: report.stability.baseline.totalPower,
      totalBladePower: report.stability.baseline.totalBladePower,
      totalBuildSurfacePower: report.stability.baseline.totalBuildSurfacePower,
      sources: {
        blades: report.stability.baseline.bladeTotals,
        buildSurfaces: report.stability.baseline.buildSurfaceTotals,
      },
    },
    derivatives: report.stability.derivatives,
    sweeps: bundle.sweeps,
    componentDiagnostics: bundle.discovery.components,
  };
}

export function buildExportPayload(first: UiAnalysisBundle, second?: UiAnalysisBundle, ui?: UiExportState): object {
  return {
    format: "besiege-aero-analyzer-analysis",
    analysisVersion: UI_ANALYSIS_VERSION,
    exportedAt: new Date().toISOString(),
    mode: second ? "compare" : "single",
    convention: ANALYSIS_CONVENTION,
    assumptions: [
      "Besiege 1.90-25346 recovered vanilla blade and BuildSurface laws; no new aerodynamic formula.",
      "BuildSurface geometry is reconstructed from BSG edges/nodes using verified game code; runtime Rigidbody states, breakage, joints, and PhysX multibody behavior are not modeled exactly.",
      "Aircraft/component choices marked HEURISTIC do not reconstruct the runtime joint graph.",
      "CG is approximate where runtime Rigidbody COM/mass overrides are unavailable.",
      "What-if overrides are GUID-addressed virtual input transforms; the source BSG is not modified.",
      "No multibody dynamics, inertia time response, control actuation, or SI conversion.",
    ],
    ui: ui ? {
      precision: ui.precision,
      plotLab: ui.plotLab,
      activeMachine: ui.activeMachine,
      showDeltaPercent: ui.showDeltaPercent,
    } : undefined,
    snapshots: ui?.snapshots ?? [],
    machines: second
      ? [machineExport(first, ui?.bladeGroups?.[0]), machineExport(second, ui?.bladeGroups?.[1])]
      : [machineExport(first, ui?.bladeGroups?.[0])],
  };
}
