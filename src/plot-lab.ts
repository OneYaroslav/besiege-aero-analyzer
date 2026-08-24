import {
  DEFAULT_DERIVATIVE_STEPS,
  analyzeStability,
  solveAnalysisState,
  type AnalysisState,
  type DerivativeSteps,
} from "./analysis.ts";
import type { VanillaBlade } from "./bsg.ts";

export type PlotInputVariable = "speed" | "alpha" | "beta" | "p" | "q" | "r";

export type PlotMode = "1d" | "2d";
export type CompareDisplay = "absolute" | "delta";

export type PlotQuantity =
  | "forceX" | "forceY" | "forceZ"
  | "rollMoment" | "pitchMoment" | "yawMoment"
  | "bladePower"
  | "pitchAlpha" | "yawBeta" | "rollBeta"
  | "rollP" | "pitchQ" | "yawR";

export type HeatmapQuantity = Exclude<PlotQuantity, "pitchAlpha" | "yawBeta" | "rollBeta" | "rollP" | "pitchQ" | "yawR">;

export interface PlotRange {
  readonly minimum: number;
  readonly maximum: number;
  readonly points: number;
}

export interface Plot1DConfig extends PlotRange {
  readonly variable: PlotInputVariable;
  readonly quantities: readonly PlotQuantity[];
}

export interface Plot2DConfig {
  readonly xVariable: PlotInputVariable;
  readonly yVariable: PlotInputVariable;
  readonly xRange: PlotRange;
  readonly yRange: PlotRange;
  readonly quantity: HeatmapQuantity;
}

export interface PlotLabUiState {
  readonly mode: PlotMode;
  readonly display: CompareDisplay;
  readonly xVariable: PlotInputVariable;
  readonly quantities: readonly PlotQuantity[];
  readonly range: PlotRange;
  readonly x2Variable: PlotInputVariable;
  readonly y2Variable: PlotInputVariable;
  readonly x2Range: PlotRange;
  readonly y2Range: PlotRange;
  readonly heatQuantity: HeatmapQuantity;
}

export interface Plot1DPoint {
  readonly x: number;
  readonly values: Readonly<Record<PlotQuantity, number>>;
}

export interface Plot1DResult {
  readonly config: Plot1DConfig;
  readonly xUnits: string;
  readonly points: readonly Plot1DPoint[];
}

export interface Plot2DPoint {
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

export interface Plot2DResult {
  readonly config: Plot2DConfig;
  readonly xUnits: string;
  readonly yUnits: string;
  readonly valueUnits: string;
  readonly xValues: readonly number[];
  readonly yValues: readonly number[];
  readonly points: readonly Plot2DPoint[];
}

export interface ZeroContourSegment {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}

export interface TurnEquilibriumPoint {
  readonly speed: number;
  readonly q: number | null;
}

export interface QuasiSteadyTurnEstimate {
  readonly speed: number;
  readonly qRadiansPerSecond: number;
  readonly qDegreesPerSecond: number;
  readonly radiusGameUnits: number | null;
}

export const PLOT_INPUTS: Readonly<Record<PlotInputVariable, { label: string; shortLabel: string; units: string; defaultRange: PlotRange }>> = {
  speed: { label: "Speed", shortLabel: "Speed", units: "game units/s", defaultRange: { minimum: 0, maximum: 200, points: 41 } },
  alpha: { label: "Alpha · α", shortLabel: "Alpha", units: "degrees", defaultRange: { minimum: -15, maximum: 15, points: 31 } },
  beta: { label: "Beta · β", shortLabel: "Beta", units: "degrees", defaultRange: { minimum: -15, maximum: 15, points: 31 } },
  p: { label: "Roll rate · p", shortLabel: "p", units: "rad/s", defaultRange: { minimum: -0.5, maximum: 0.5, points: 31 } },
  q: { label: "Pitch rate · q", shortLabel: "q", units: "rad/s", defaultRange: { minimum: -0.5, maximum: 0.5, points: 31 } },
  r: { label: "Yaw rate · r", shortLabel: "r", units: "rad/s", defaultRange: { minimum: -0.5, maximum: 0.5, points: 31 } },
};

export const PLOT_QUANTITIES: Readonly<Record<PlotQuantity, { label: string; units: string; derivative: boolean }>> = {
  forceX: { label: "Force X · Fx", units: "game force units", derivative: false },
  forceY: { label: "Force Y · Fy", units: "game force units", derivative: false },
  forceZ: { label: "Force Z · Fz", units: "game force units", derivative: false },
  rollMoment: { label: "Roll moment", units: "game moment units", derivative: false },
  pitchMoment: { label: "Pitch moment", units: "game moment units", derivative: false },
  yawMoment: { label: "Yaw moment", units: "game moment units", derivative: false },
  bladePower: { label: "Blade power · ΣF·v", units: "game power units", derivative: false },
  pitchAlpha: { label: "dM_pitch/dAlpha", units: "moment/radian", derivative: true },
  yawBeta: { label: "dM_yaw/dBeta", units: "moment/radian", derivative: true },
  rollBeta: { label: "dM_roll/dBeta", units: "moment/radian", derivative: true },
  rollP: { label: "dM_roll/dp", units: "moment/(rad/s)", derivative: true },
  pitchQ: { label: "dM_pitch/dq", units: "moment/(rad/s)", derivative: true },
  yawR: { label: "dM_yaw/dr", units: "moment/(rad/s)", derivative: true },
};

export const HEATMAP_QUANTITIES = [
  "forceX", "forceY", "forceZ",
  "rollMoment", "pitchMoment", "yawMoment",
  "bladePower",
] as const satisfies readonly HeatmapQuantity[];

export const DEFAULT_PLOT_LAB_STATE: PlotLabUiState = {
  mode: "1d",
  display: "absolute",
  xVariable: "alpha",
  quantities: ["pitchMoment"],
  range: { ...PLOT_INPUTS.alpha.defaultRange },
  x2Variable: "alpha",
  y2Variable: "q",
  x2Range: { ...PLOT_INPUTS.alpha.defaultRange, points: 31 },
  y2Range: { ...PLOT_INPUTS.q.defaultRange, points: 31 },
  heatQuantity: "pitchMoment",
};

function validateRange(range: PlotRange, label: string): void {
  if (!Number.isFinite(range.minimum) || !Number.isFinite(range.maximum)) throw new Error(`${label} limits must be finite`);
  if (range.maximum <= range.minimum) throw new Error(`${label} maximum must be greater than minimum`);
  if (!Number.isInteger(range.points) || range.points < 2) throw new Error(`${label} point count must be an integer of at least 2`);
}

export function generatePlotValues(range: PlotRange): readonly number[] {
  validateRange(range, "Plot range");
  const step = (range.maximum - range.minimum) / (range.points - 1);
  return Array.from({ length: range.points }, (_, index) => index === range.points - 1 ? range.maximum : range.minimum + step * index);
}

export function stateForPlotInput(state: AnalysisState, variable: PlotInputVariable, value: number): AnalysisState {
  if (!Number.isFinite(value)) throw new Error(`${variable} plot value must be finite`);
  if (variable === "alpha" || variable === "beta") return { ...state, [variable]: value * Math.PI / 180 };
  return { ...state, [variable]: value };
}

function quantityValue(
  quantity: PlotQuantity,
  baseline: ReturnType<typeof solveAnalysisState>,
  stability?: ReturnType<typeof analyzeStability>,
): number {
  if (quantity === "forceX") return baseline.totalForce[0];
  if (quantity === "forceY") return baseline.totalForce[1];
  if (quantity === "forceZ") return baseline.totalForce[2];
  if (quantity === "rollMoment") return baseline.moments.roll;
  if (quantity === "pitchMoment") return baseline.moments.pitch;
  if (quantity === "yawMoment") return baseline.moments.yaw;
  if (quantity === "bladePower") return baseline.totalBladePower;
  if (!stability) throw new Error(`${quantity} requires stability derivatives`);
  if (quantity === "pitchAlpha") return stability.derivatives.static.pitchAlpha.derivative;
  if (quantity === "yawBeta") return stability.derivatives.static.yawBeta.derivative;
  if (quantity === "rollBeta") return stability.derivatives.static.rollBeta.derivative;
  if (quantity === "rollP") return stability.derivatives.damping.rollP.derivative;
  if (quantity === "pitchQ") return stability.derivatives.damping.pitchQ.derivative;
  return stability.derivatives.damping.yawR.derivative;
}

function evaluateQuantities(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  quantities: readonly PlotQuantity[],
  steps: DerivativeSteps,
): Readonly<Record<PlotQuantity, number>> {
  const requiresDerivatives = quantities.some((quantity) => PLOT_QUANTITIES[quantity].derivative);
  const stability = requiresDerivatives ? analyzeStability(blades, state, steps) : undefined;
  const baseline = stability?.baseline ?? solveAnalysisState(blades, state);
  return Object.fromEntries(quantities.map((quantity) => [quantity, quantityValue(quantity, baseline, stability)])) as Readonly<Record<PlotQuantity, number>>;
}

export function evaluatePlot1D(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  config: Plot1DConfig,
  steps: DerivativeSteps = DEFAULT_DERIVATIVE_STEPS,
): Plot1DResult {
  validateRange(config, "1D sweep");
  if (config.quantities.length === 0) throw new Error("1D sweep requires at least one output quantity");
  const quantities = [...new Set(config.quantities)];
  const points = generatePlotValues(config).map((x) => ({
    x,
    values: evaluateQuantities(blades, stateForPlotInput(state, config.variable, x), quantities, steps),
  }));
  return { config: { ...config, quantities }, xUnits: PLOT_INPUTS[config.variable].units, points };
}

export function evaluatePlot2D(
  blades: readonly VanillaBlade[],
  state: AnalysisState,
  config: Plot2DConfig,
): Plot2DResult {
  validateRange(config.xRange, "2D X sweep");
  validateRange(config.yRange, "2D Y sweep");
  if (config.xVariable === config.yVariable) throw new Error("2D sweep X and Y variables must be different");
  if (config.xRange.points * config.yRange.points > 10_000) throw new Error("2D sweep is limited to 10,000 cells");
  const xValues = generatePlotValues(config.xRange);
  const yValues = generatePlotValues(config.yRange);
  const points = yValues.flatMap((y) => xValues.map((x) => {
    const xState = stateForPlotInput(state, config.xVariable, x);
    const pointState = stateForPlotInput(xState, config.yVariable, y);
    const baseline = solveAnalysisState(blades, pointState);
    return { x, y, value: quantityValue(config.quantity, baseline) };
  }));
  return {
    config,
    xUnits: PLOT_INPUTS[config.xVariable].units,
    yUnits: PLOT_INPUTS[config.yVariable].units,
    valueUnits: PLOT_QUANTITIES[config.quantity].units,
    xValues,
    yValues,
    points,
  };
}

function zeroCrossing(firstCoordinate: number, firstValue: number, secondCoordinate: number, secondValue: number, epsilon = 1e-12): number | null {
  if (![firstCoordinate, firstValue, secondCoordinate, secondValue].every(Number.isFinite)) return null;
  const firstZero = Math.abs(firstValue) <= epsilon;
  const secondZero = Math.abs(secondValue) <= epsilon;
  if (firstZero && secondZero) return (firstCoordinate + secondCoordinate) / 2;
  if (firstZero) return firstCoordinate;
  if (secondZero) return secondCoordinate;
  if (Math.sign(firstValue) === Math.sign(secondValue)) return null;
  return firstCoordinate + (secondCoordinate - firstCoordinate) * (-firstValue) / (secondValue - firstValue);
}

export function turnEquilibriumCurve(result: Plot2DResult, referenceQ = 0): readonly TurnEquilibriumPoint[] {
  if (result.config.xVariable !== "speed" || result.config.yVariable !== "q" || result.config.quantity !== "pitchMoment") {
    throw new Error("Turn equilibrium requires Speed × q → Pitch moment data");
  }
  const columns = result.xValues.length;
  return result.xValues.map((speed, xIndex) => {
    const crossings: number[] = [];
    for (let yIndex = 0; yIndex < result.yValues.length - 1; yIndex += 1) {
      const firstValue = result.points[yIndex * columns + xIndex]?.value;
      const secondValue = result.points[(yIndex + 1) * columns + xIndex]?.value;
      if (firstValue === undefined || secondValue === undefined) continue;
      const crossing = zeroCrossing(result.yValues[yIndex], firstValue, result.yValues[yIndex + 1], secondValue);
      if (crossing !== null && !crossings.some((value) => Math.abs(value - crossing) <= 1e-10)) crossings.push(crossing);
    }
    const q = crossings.length === 0
      ? null
      : crossings.reduce((closest, candidate) => Math.abs(candidate - referenceQ) < Math.abs(closest - referenceQ) ? candidate : closest);
    return { speed, q };
  });
}

export function quasiSteadyTurnEstimate(result: Plot2DResult, speed: number, referenceQ = 0, epsilon = 1e-9): QuasiSteadyTurnEstimate | null {
  if (!Number.isFinite(speed)) return null;
  const curve = turnEquilibriumCurve(result, referenceQ);
  const exact = curve.find((point) => Math.abs(point.speed - speed) <= epsilon);
  let q = exact?.q ?? null;
  if (!exact) {
    const rightIndex = curve.findIndex((point) => point.speed > speed);
    if (rightIndex <= 0) return null;
    const left = curve[rightIndex - 1];
    const right = curve[rightIndex];
    if (left.q === null || right.q === null) return null;
    q = left.q + (right.q - left.q) * (speed - left.speed) / (right.speed - left.speed);
  }
  if (q === null || !Number.isFinite(q)) return null;
  return {
    speed,
    qRadiansPerSecond: q,
    qDegreesPerSecond: q * 180 / Math.PI,
    radiusGameUnits: Math.abs(q) <= epsilon ? null : Math.abs(speed / q),
  };
}

function contourIntersection(first: Plot2DPoint, second: Plot2DPoint): readonly [number, number] | null {
  const coordinate = zeroCrossing(0, first.value, 1, second.value);
  if (coordinate === null) return null;
  return [first.x + (second.x - first.x) * coordinate, first.y + (second.y - first.y) * coordinate];
}

export function zeroContourSegments(result: Plot2DResult): readonly ZeroContourSegment[] {
  const columns = result.xValues.length;
  const rows = result.yValues.length;
  const segments: ZeroContourSegment[] = [];
  for (let yIndex = 0; yIndex < rows - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < columns - 1; xIndex += 1) {
      const bottomLeft = result.points[yIndex * columns + xIndex];
      const bottomRight = result.points[yIndex * columns + xIndex + 1];
      const topRight = result.points[(yIndex + 1) * columns + xIndex + 1];
      const topLeft = result.points[(yIndex + 1) * columns + xIndex];
      if (!bottomLeft || !bottomRight || !topRight || !topLeft) continue;
      const intersections = [
        contourIntersection(bottomLeft, bottomRight),
        contourIntersection(bottomRight, topRight),
        contourIntersection(topRight, topLeft),
        contourIntersection(topLeft, bottomLeft),
      ].filter((point): point is readonly [number, number] => point !== null)
        .filter((point, index, points) => points.findIndex((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) <= 1e-10) === index);
      if (intersections.length === 2) segments.push({ from: intersections[0], to: intersections[1] });
      else if (intersections.length === 4) {
        segments.push({ from: intersections[0], to: intersections[1] }, { from: intersections[2], to: intersections[3] });
      }
    }
  }
  return segments;
}

export function deltaValue(first: number, second: number): number {
  return second - first;
}

export function deltaPercent(first: number, second: number, nearZero = 1e-9): number | null {
  if (Math.abs(first) <= nearZero) return null;
  return (second - first) / first * 100;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(cells: readonly (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

function assertMatching1D(first: Plot1DResult, second: Plot1DResult): void {
  if (first.config.variable !== second.config.variable || first.points.length !== second.points.length) throw new Error("1D comparison sweeps do not share the same X sampling");
  if (first.config.quantities.join("|") !== second.config.quantities.join("|")) throw new Error("1D comparison sweeps do not share the same quantities");
}

export function formatPlot1DCsv(first: Plot1DResult, firstName: string, second?: Plot1DResult, secondName = "Machine B"): string {
  if (second) assertMatching1D(first, second);
  const header: string[] = [`${PLOT_INPUTS[first.config.variable].shortLabel} (${first.xUnits})`];
  for (const quantity of first.config.quantities) {
    const output = PLOT_QUANTITIES[quantity];
    if (second) header.push(
      `${output.label} · A ${firstName} (${output.units})`,
      `${output.label} · B ${secondName} (${output.units})`,
      `${output.label} · Delta B - A (${output.units})`,
    );
    else header.push(`${output.label} · ${firstName} (${output.units})`);
  }
  const rows = first.points.map((point, index) => {
    const cells: (string | number)[] = [point.x];
    for (const quantity of first.config.quantities) {
      const firstValue = point.values[quantity];
      if (second) {
        const secondValue = second.points[index].values[quantity];
        cells.push(firstValue, secondValue, deltaValue(firstValue, secondValue));
      } else cells.push(firstValue);
    }
    return csvRow(cells);
  });
  return [csvRow(header), ...rows].join("\r\n");
}

function assertMatching2D(first: Plot2DResult, second: Plot2DResult): void {
  if (first.config.xVariable !== second.config.xVariable || first.config.yVariable !== second.config.yVariable || first.config.quantity !== second.config.quantity || first.points.length !== second.points.length) {
    throw new Error("2D comparison sweeps do not share the same grid and quantity");
  }
}

export function formatPlot2DCsv(first: Plot2DResult, firstName: string, second?: Plot2DResult, secondName = "Machine B"): string {
  if (second) assertMatching2D(first, second);
  const output = PLOT_QUANTITIES[first.config.quantity];
  const header = [
    `${PLOT_INPUTS[first.config.xVariable].shortLabel} (${first.xUnits})`,
    `${PLOT_INPUTS[first.config.yVariable].shortLabel} (${first.yUnits})`,
    ...(second ? [
      `${output.label} · A ${firstName} (${output.units})`,
      `${output.label} · B ${secondName} (${output.units})`,
      `${output.label} · Delta B - A (${output.units})`,
    ] : [`${output.label} · ${firstName} (${output.units})`]),
  ];
  const rows = first.points.map((point, index) => {
    if (!second) return csvRow([point.x, point.y, point.value]);
    const secondValue = second.points[index].value;
    return csvRow([point.x, point.y, point.value, secondValue, deltaValue(point.value, secondValue)]);
  });
  return [csvRow(header), ...rows].join("\r\n");
}
