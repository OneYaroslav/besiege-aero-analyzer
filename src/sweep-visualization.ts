import type { SweepResult } from "./analysis.ts";
import type { UiAnalysisBundle } from "./ui-model.ts";

export type StandardSweepKey = "alpha" | "pitchQ" | "beta" | "yawR" | "rollP";
export type StandardSweepMetric = "forceX" | "forceY" | "forceZ" | "pitch" | "roll" | "yaw" | "power";

export interface StandardSweepBaseline {
  readonly id: string;
  readonly sweeps: UiAnalysisBundle["sweeps"];
}

export interface SweepCurveMetrics {
  readonly center: number;
  readonly slope: number;
  readonly range: number;
  readonly curvature: number;
  readonly slopeVariation: number;
}

export interface StickySweepDomain {
  readonly signature: string;
  readonly domain: readonly [number, number];
}

export function createStandardSweepBaseline(id: string, bundle: UiAnalysisBundle): StandardSweepBaseline {
  return { id, sweeps: bundle.sweeps };
}

export function sweepMetricValue(point: SweepResult["points"][number], metric: StandardSweepMetric): number {
  if (metric === "forceX") return point.totalForce[0];
  if (metric === "forceY") return point.totalForce[1];
  if (metric === "forceZ") return point.totalForce[2];
  if (metric === "power") return point.totalPower ?? point.totalBladePower;
  return point.moments[metric];
}

export function sweepMetricValues(sweep: SweepResult, metric: StandardSweepMetric): readonly number[] {
  return sweep.points.map((point) => sweepMetricValue(point, metric));
}

function centerIndex(sweep: SweepResult): number {
  const exact = sweep.points.findIndex((point) => Math.abs(point.value) < 1e-12);
  if (exact >= 0) return exact;
  return sweep.points.reduce((best, point, index) => Math.abs(point.value) < Math.abs(sweep.points[best].value) ? index : best, 0);
}

export function computeSweepCurveMetrics(sweep: SweepResult, metric: StandardSweepMetric): SweepCurveMetrics {
  if (sweep.points.length < 3) throw new Error("Sweep curve metrics require at least three points");
  const values = sweepMetricValues(sweep, metric);
  const center = centerIndex(sweep);
  const left = Math.max(0, center - 1);
  const right = Math.min(sweep.points.length - 1, center + 1);
  if (left === center || right === center) throw new Error("Sweep curve metrics require samples on both sides of the center");
  const xLeft = sweep.points[left].value;
  const xCenter = sweep.points[center].value;
  const xRight = sweep.points[right].value;
  const leftSlope = (values[center] - values[left]) / (xCenter - xLeft);
  const rightSlope = (values[right] - values[center]) / (xRight - xCenter);
  const segmentSlopes = values.slice(1).map((value, index) => (value - values[index]) / (sweep.points[index + 1].value - sweep.points[index].value));
  return {
    center: values[center],
    slope: (values[right] - values[left]) / (xRight - xLeft),
    range: Math.max(...values) - Math.min(...values),
    curvature: 2 * (rightSlope - leftSlope) / (xRight - xLeft),
    slopeVariation: Math.max(...segmentSlopes) - Math.min(...segmentSlopes),
  };
}

export function paddedSweepDomain(values: readonly number[], paddingRatio = 0.08): readonly [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [-1, 1];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  const range = maximum - minimum;
  const padding = (range > 0 ? range : Math.max(Math.abs(minimum), 1)) * paddingRatio;
  return [minimum - padding, maximum + padding];
}

export function expandStickySweepDomain(
  previous: readonly [number, number],
  values: readonly number[],
  paddingRatio = 0.08,
): readonly [number, number] {
  const candidate = paddedSweepDomain(values, paddingRatio);
  return [Math.min(previous[0], candidate[0]), Math.max(previous[1], candidate[1])];
}
