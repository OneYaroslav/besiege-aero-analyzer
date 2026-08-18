import { extractVanillaBlades, type BsgMachine, type VanillaBlade } from "./bsg.ts";
import {
  selectAnalysisGroup,
  type AnalysisGroup,
  type ComponentSuggestion,
} from "./groups.ts";
import { analyzeMass, type MassAnalysis } from "./mass.ts";
import { dot, type Vec3 } from "./math.ts";
import { solveBlades, type BladeResult, type SolverResult } from "./physics.ts";

export const ANALYSIS_AXES = {
  forward: [0, 0, 1] as Vec3,
  up: [0, 1, 0] as Vec3,
  right: [1, 0, 0] as Vec3,
} as const;

export const ANALYSIS_CONVENTION = {
  frame: "machine-local",
  axes: {
    forward: "+Z",
    up: "+Y",
    right: "+X",
  },
  velocity: "Start at +Z, rotate by alpha about +X, then by beta about +Y.",
  positiveAlpha: "Velocity tilts from +Z toward -Y; this changes incoming/translational velocity, not machine geometry.",
  positiveBeta: "Velocity tilts from +Z toward +X; this changes incoming/translational velocity, not machine geometry.",
  rates: {
    p: "roll rate about +Z",
    q: "pitch rate about +X; right-hand positive rotates +Z toward -Y (nose-down in this Y-up frame)",
    r: "yaw rate about +Y; right-hand positive rotates +Z toward +X",
    omegaMapping: "omega=(q,r,p) in machine-local XYZ components",
  },
  moments: {
    roll: "projection on +Z",
    pitch: "projection on +X",
    yaw: "projection on +Y",
  },
  finiteDifference: "central: (output(x+h)-output(x-h))/(2h)",
} as const;

export const DEFAULT_DERIVATIVE_STEPS: DerivativeSteps = {
  alphaRadians: Math.PI / 180,
  betaRadians: Math.PI / 180,
  rateRadPerSecond: 0.01,
};

export const DEFAULT_ANGLE_SWEEP_DEGREES = [-15, -10, -5, 0, 5, 10, 15] as const;
export const DEFAULT_RATE_SWEEP = [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5] as const;

export interface AnalysisState {
  readonly speed: number;
  /** Radians. */
  readonly alpha: number;
  /** Radians. */
  readonly beta: number;
  /** Roll rate about +Z, rad/s. */
  readonly p: number;
  /** Pitch rate about +X, rad/s. */
  readonly q: number;
  /** Yaw rate about +Y, rad/s. */
  readonly r: number;
  readonly centerOfGravity: Vec3;
  readonly analysisGroup: AnalysisGroup;
}

export interface DerivativeSteps {
  readonly alphaRadians: number;
  readonly betaRadians: number;
  readonly rateRadPerSecond: number;
}

export type StateVariable = "alpha" | "beta" | "p" | "q" | "r";
export type MomentName = "roll" | "pitch" | "yaw";

export interface ScalarDerivative {
  readonly input: StateVariable;
  readonly output: `M_${MomentName}`;
  readonly step: number;
  readonly derivative: number;
  readonly units: "moment/radian" | "moment/(rad/s)";
  readonly convention: typeof ANALYSIS_CONVENTION;
}

export interface ForceDerivative {
  readonly input: "alpha" | "beta";
  readonly step: number;
  readonly derivative: Vec3;
  readonly componentUnits: "force/radian";
  readonly components: readonly ["Fx/right", "Fy/up", "Fz/forward"];
  readonly convention: typeof ANALYSIS_CONVENTION;
}

export interface StabilityDerivatives {
  readonly static: {
    readonly pitchAlpha: ScalarDerivative;
    readonly yawBeta: ScalarDerivative;
    readonly rollBeta: ScalarDerivative;
  };
  readonly damping: {
    readonly rollP: ScalarDerivative;
    readonly pitchQ: ScalarDerivative;
    readonly yawR: ScalarDerivative;
  };
  readonly crossDamping: {
    readonly pitchR: ScalarDerivative;
    readonly pitchP: ScalarDerivative;
    readonly yawQ: ScalarDerivative;
    readonly yawP: ScalarDerivative;
    readonly rollQ: ScalarDerivative;
    readonly rollR: ScalarDerivative;
  };
  readonly force: {
    readonly alpha: ForceDerivative;
    readonly beta: ForceDerivative;
  };
}

export interface StabilityAnalysis {
  readonly operatingPoint: AnalysisState;
  readonly linearVelocity: Vec3;
  readonly angularVelocity: Vec3;
  readonly steps: DerivativeSteps & {
    readonly alphaDegrees: number;
    readonly betaDegrees: number;
  };
  readonly baseline: SolverResult;
  readonly derivatives: StabilityDerivatives;
  readonly convention: typeof ANALYSIS_CONVENTION;
}

export type ContributionDerivative =
  | "pitch-damping"
  | "yaw-damping"
  | "roll-damping"
  | "pitch-alpha"
  | "yaw-beta";

export interface BladeDerivativeContribution {
  readonly guid: string;
  readonly id: number;
  readonly type: VanillaBlade["kind"];
  readonly position: Vec3;
  readonly flipped: boolean;
  readonly baselineMoment: Vec3;
  readonly baselineProjectedMoment: number;
  readonly derivativeContribution: number;
  readonly absoluteContribution: number;
  /** Signed share. Cancellation can produce values outside 0..100. */
  readonly percentageOfTotal: number | null;
}

export interface BladeContributionAnalysis {
  readonly derivative: ContributionDerivative;
  readonly input: StateVariable;
  readonly output: `M_${MomentName}`;
  readonly step: number;
  readonly units: "moment/radian" | "moment/(rad/s)";
  readonly totalDerivative: number;
  readonly contributionSum: number;
  readonly blades: readonly BladeDerivativeContribution[];
  readonly convention: typeof ANALYSIS_CONVENTION;
}

export interface SweepPoint {
  readonly value: number;
  readonly units: "degrees" | "rad/s";
  readonly totalForce: Vec3;
  readonly moments: SolverResult["moments"];
  readonly totalMoment: Vec3;
  readonly totalBladePower: number;
}

export interface SweepResult {
  readonly variable: "alpha" | "beta" | "p" | "q" | "r";
  readonly valuesAreAbsolute: true;
  readonly points: readonly SweepPoint[];
  readonly convention: typeof ANALYSIS_CONVENTION;
}

export interface MachineAnalysisConfig {
  readonly speed: number;
  readonly alpha: number;
  readonly beta: number;
  readonly p: number;
  readonly q: number;
  readonly r: number;
  readonly centerOfGravity: "auto" | Vec3;
  readonly groupMode: "all" | "aircraft-heuristic";
  readonly includeGuids?: ReadonlySet<string>;
  readonly excludeGuids?: ReadonlySet<string>;
  readonly proximityThreshold?: number;
  readonly steps?: DerivativeSteps;
  /** Purely analytical mask; mass/group and source BSG remain unchanged. */
  readonly disabledBladeGuids?: ReadonlySet<string>;
}

export interface MachineAnalysis {
  readonly machine: BsgMachine;
  readonly suggestion: ComponentSuggestion;
  readonly mass: MassAnalysis;
  readonly availableBlades: readonly VanillaBlade[];
  readonly blades: readonly VanillaBlade[];
  readonly disabledBladeGuids: ReadonlySet<string>;
  readonly state: AnalysisState;
  readonly stability: StabilityAnalysis;
}

export interface MachineComparison {
  readonly first: MachineAnalysis;
  readonly second: MachineAnalysis;
  readonly convention: typeof ANALYSIS_CONVENTION;
}

function validateFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateState(state: AnalysisState): void {
  validateFinite(state.speed, "speed");
  if (state.speed < 0) throw new Error("speed must be non-negative");
  for (const [label, value] of [
    ["alpha", state.alpha],
    ["beta", state.beta],
    ["p", state.p],
    ["q", state.q],
    ["r", state.r],
  ] as const) validateFinite(value, label);
  state.centerOfGravity.forEach((value, index) => validateFinite(value, `CG[${index}]`));
}

function validateSteps(steps: DerivativeSteps): void {
  for (const [label, value] of [
    ["alpha step", steps.alphaRadians],
    ["beta step", steps.betaRadians],
    ["rate step", steps.rateRadPerSecond],
  ] as const) {
    if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be positive and finite`);
  }
}

export function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function radiansToDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}

/**
 * Machine-local translational velocity at fixed magnitude. Positive alpha
 * rotates +Z toward -Y; positive beta then rotates the horizontal projection
 * from +Z toward +X.
 */
export function velocityFromSpeedAngles(speed: number, alpha: number, beta: number): Vec3 {
  validateFinite(speed, "speed");
  validateFinite(alpha, "alpha");
  validateFinite(beta, "beta");
  if (speed < 0) throw new Error("speed must be non-negative");
  const cosAlpha = Math.cos(alpha);
  return [
    speed * cosAlpha * Math.sin(beta),
    -speed * Math.sin(alpha),
    speed * cosAlpha * Math.cos(beta),
  ];
}

/** p=roll(+Z), q=pitch(+X), r=yaw(+Y), so XYZ components are (q,r,p). */
export function angularVelocityFromRates(p: number, q: number, r: number): Vec3 {
  validateFinite(p, "p");
  validateFinite(q, "q");
  validateFinite(r, "r");
  return [q, r, p];
}

export function solveAnalysisState(blades: readonly VanillaBlade[], state: AnalysisState): SolverResult {
  validateState(state);
  return solveBlades(blades, {
    linearVelocity: velocityFromSpeedAngles(state.speed, state.alpha, state.beta),
    angularVelocity: angularVelocityFromRates(state.p, state.q, state.r),
    centerOfGravity: state.centerOfGravity,
    forward: ANALYSIS_AXES.forward,
    up: ANALYSIS_AXES.up,
  });
}

export function centralDifference(plus: number, minus: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) throw new Error("central-difference step must be positive and finite");
  return (plus - minus) / (2 * step);
}

function vectorCentralDifference(plus: Vec3, minus: Vec3, step: number): Vec3 {
  return [
    centralDifference(plus[0], minus[0], step),
    centralDifference(plus[1], minus[1], step),
    centralDifference(plus[2], minus[2], step),
  ];
}

function perturb(state: AnalysisState, variable: StateVariable, delta: number): AnalysisState {
  return { ...state, [variable]: state[variable] + delta };
}

function moment(result: SolverResult, output: MomentName): number {
  return result.moments[output];
}

function scalarDerivative(
  pair: readonly [SolverResult, SolverResult],
  input: StateVariable,
  output: MomentName,
  step: number,
): ScalarDerivative {
  return {
    input,
    output: `M_${output}`,
    step,
    derivative: centralDifference(moment(pair[0], output), moment(pair[1], output), step),
    units: input === "alpha" || input === "beta" ? "moment/radian" : "moment/(rad/s)",
    convention: ANALYSIS_CONVENTION,
  };
}

export function analyzeStability(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  steps: DerivativeSteps = DEFAULT_DERIVATIVE_STEPS,
): StabilityAnalysis {
  validateState(state);
  validateSteps(steps);
  const evaluatePair = (variable: StateVariable, step: number): readonly [SolverResult, SolverResult] => [
    solveAnalysisState(blades, perturb(state, variable, step)),
    solveAnalysisState(blades, perturb(state, variable, -step)),
  ];
  const alpha = evaluatePair("alpha", steps.alphaRadians);
  const beta = evaluatePair("beta", steps.betaRadians);
  const p = evaluatePair("p", steps.rateRadPerSecond);
  const q = evaluatePair("q", steps.rateRadPerSecond);
  const r = evaluatePair("r", steps.rateRadPerSecond);
  return {
    operatingPoint: state,
    linearVelocity: velocityFromSpeedAngles(state.speed, state.alpha, state.beta),
    angularVelocity: angularVelocityFromRates(state.p, state.q, state.r),
    steps: {
      ...steps,
      alphaDegrees: radiansToDegrees(steps.alphaRadians),
      betaDegrees: radiansToDegrees(steps.betaRadians),
    },
    baseline: solveAnalysisState(blades, state),
    derivatives: {
      static: {
        pitchAlpha: scalarDerivative(alpha, "alpha", "pitch", steps.alphaRadians),
        yawBeta: scalarDerivative(beta, "beta", "yaw", steps.betaRadians),
        rollBeta: scalarDerivative(beta, "beta", "roll", steps.betaRadians),
      },
      damping: {
        rollP: scalarDerivative(p, "p", "roll", steps.rateRadPerSecond),
        pitchQ: scalarDerivative(q, "q", "pitch", steps.rateRadPerSecond),
        yawR: scalarDerivative(r, "r", "yaw", steps.rateRadPerSecond),
      },
      crossDamping: {
        pitchR: scalarDerivative(r, "r", "pitch", steps.rateRadPerSecond),
        pitchP: scalarDerivative(p, "p", "pitch", steps.rateRadPerSecond),
        yawQ: scalarDerivative(q, "q", "yaw", steps.rateRadPerSecond),
        yawP: scalarDerivative(p, "p", "yaw", steps.rateRadPerSecond),
        rollQ: scalarDerivative(q, "q", "roll", steps.rateRadPerSecond),
        rollR: scalarDerivative(r, "r", "roll", steps.rateRadPerSecond),
      },
      force: {
        alpha: {
          input: "alpha",
          step: steps.alphaRadians,
          derivative: vectorCentralDifference(alpha[0].totalForce, alpha[1].totalForce, steps.alphaRadians),
          componentUnits: "force/radian",
          components: ["Fx/right", "Fy/up", "Fz/forward"],
          convention: ANALYSIS_CONVENTION,
        },
        beta: {
          input: "beta",
          step: steps.betaRadians,
          derivative: vectorCentralDifference(beta[0].totalForce, beta[1].totalForce, steps.betaRadians),
          componentUnits: "force/radian",
          components: ["Fx/right", "Fy/up", "Fz/forward"],
          convention: ANALYSIS_CONVENTION,
        },
      },
    },
    convention: ANALYSIS_CONVENTION,
  };
}

const CONTRIBUTION_SPECS: Readonly<Record<ContributionDerivative, {
  variable: StateVariable;
  output: MomentName;
  stepKind: keyof DerivativeSteps;
}>> = {
  "pitch-damping": { variable: "q", output: "pitch", stepKind: "rateRadPerSecond" },
  "yaw-damping": { variable: "r", output: "yaw", stepKind: "rateRadPerSecond" },
  "roll-damping": { variable: "p", output: "roll", stepKind: "rateRadPerSecond" },
  "pitch-alpha": { variable: "alpha", output: "pitch", stepKind: "alphaRadians" },
  "yaw-beta": { variable: "beta", output: "yaw", stepKind: "betaRadians" },
};

function projectedBladeMoment(result: BladeResult, output: MomentName): number {
  const axis = output === "pitch" ? ANALYSIS_AXES.right : output === "yaw" ? ANALYSIS_AXES.up : ANALYSIS_AXES.forward;
  return dot(result.momentAboutCg, axis);
}

export function analyzeBladeContributions(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  derivative: ContributionDerivative,
  steps: DerivativeSteps = DEFAULT_DERIVATIVE_STEPS,
): BladeContributionAnalysis {
  validateState(state);
  validateSteps(steps);
  const spec = CONTRIBUTION_SPECS[derivative];
  const step = steps[spec.stepKind];
  const baseline = solveAnalysisState(blades, state);
  const plus = solveAnalysisState(blades, perturb(state, spec.variable, step));
  const minus = solveAnalysisState(blades, perturb(state, spec.variable, -step));
  const plusByGuid = new Map(plus.blades.map((entry) => [entry.blade.guid, entry]));
  const minusByGuid = new Map(minus.blades.map((entry) => [entry.blade.guid, entry]));
  const totalDerivative = centralDifference(moment(plus, spec.output), moment(minus, spec.output), step);
  const contributions = baseline.blades.map((entry) => {
    const plusEntry = plusByGuid.get(entry.blade.guid);
    const minusEntry = minusByGuid.get(entry.blade.guid);
    if (!plusEntry || !minusEntry) throw new Error(`Blade ${entry.blade.guid} disappeared during derivative evaluation`);
    const value = centralDifference(
      projectedBladeMoment(plusEntry, spec.output),
      projectedBladeMoment(minusEntry, spec.output),
      step,
    );
    return {
      guid: entry.blade.guid,
      id: entry.blade.id,
      type: entry.blade.kind,
      position: entry.blade.position,
      flipped: entry.blade.flipped,
      baselineMoment: entry.momentAboutCg,
      baselineProjectedMoment: projectedBladeMoment(entry, spec.output),
      derivativeContribution: value,
      absoluteContribution: Math.abs(value),
      percentageOfTotal: Math.abs(totalDerivative) > 1e-12 ? value / totalDerivative * 100 : null,
    } satisfies BladeDerivativeContribution;
  }).sort((first, second) => second.absoluteContribution - first.absoluteContribution);
  return {
    derivative,
    input: spec.variable,
    output: `M_${spec.output}`,
    step,
    units: spec.variable === "alpha" || spec.variable === "beta" ? "moment/radian" : "moment/(rad/s)",
    totalDerivative,
    contributionSum: contributions.reduce((sum, entry) => sum + entry.derivativeContribution, 0),
    blades: contributions,
    convention: ANALYSIS_CONVENTION,
  };
}

function sweep(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  variable: SweepResult["variable"],
  values: readonly number[],
  units: SweepPoint["units"],
): SweepResult {
  const points = values.map((value) => {
    const stateValue = units === "degrees" ? degreesToRadians(value) : value;
    const result = solveAnalysisState(blades, { ...state, [variable]: stateValue });
    return {
      value,
      units,
      totalForce: result.totalForce,
      moments: result.moments,
      totalMoment: result.totalMoment,
      totalBladePower: result.totalBladePower,
    } satisfies SweepPoint;
  });
  return { variable, valuesAreAbsolute: true, points, convention: ANALYSIS_CONVENTION };
}

export function sweepAlpha(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  degrees: readonly number[] = DEFAULT_ANGLE_SWEEP_DEGREES,
): SweepResult {
  return sweep(blades, state, "alpha", degrees, "degrees");
}

export function sweepBeta(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  degrees: readonly number[] = DEFAULT_ANGLE_SWEEP_DEGREES,
): SweepResult {
  return sweep(blades, state, "beta", degrees, "degrees");
}

export function sweepRate(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  variable: "p" | "q" | "r",
  rates: readonly number[] = DEFAULT_RATE_SWEEP,
): SweepResult {
  return sweep(blades, state, variable, rates, "rad/s");
}

export function analyzeMachine(machine: BsgMachine, config: MachineAnalysisConfig): MachineAnalysis {
  const allBlades = extractVanillaBlades(machine);
  const { group, suggestion } = selectAnalysisGroup(machine, allBlades, {
    mode: config.groupMode,
    includeGuids: config.includeGuids ?? new Set(),
    excludeGuids: config.excludeGuids ?? new Set(),
    proximityThreshold: config.proximityThreshold,
  });
  const mass = analyzeMass(group);
  const selectedGuids = new Set(group.blocks.map((block) => block.guid));
  const availableBlades = allBlades.filter((blade) => selectedGuids.has(blade.guid));
  const availableGuids = new Set(availableBlades.map((blade) => blade.guid));
  const disabledBladeGuids = new Set(
    [...(config.disabledBladeGuids ?? [])].filter((guid) => availableGuids.has(guid)),
  );
  const blades = availableBlades.filter((blade) => !disabledBladeGuids.has(blade.guid));
  const state: AnalysisState = {
    speed: config.speed,
    alpha: config.alpha,
    beta: config.beta,
    p: config.p,
    q: config.q,
    r: config.r,
    centerOfGravity: config.centerOfGravity === "auto" ? mass.centerOfMass : config.centerOfGravity,
    analysisGroup: group,
  };
  return {
    machine,
    suggestion,
    mass,
    availableBlades,
    blades,
    disabledBladeGuids,
    state,
    stability: analyzeStability(blades, state, config.steps),
  };
}

export function compareMachines(
  first: BsgMachine,
  second: BsgMachine,
  config: MachineAnalysisConfig,
): MachineComparison {
  return {
    first: analyzeMachine(first, config),
    second: analyzeMachine(second, config),
    convention: ANALYSIS_CONVENTION,
  };
}
