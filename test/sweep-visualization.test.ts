import assert from "node:assert/strict";
import test from "node:test";
import { ANALYSIS_CONVENTION, type SweepResult } from "../src/analysis.ts";
import { computeSweepCurveMetrics, expandStickySweepDomain, paddedSweepDomain } from "../src/sweep-visualization.ts";

function sweep(xs: readonly number[], values: readonly number[]): SweepResult {
  return {
    variable: "q",
    valuesAreAbsolute: true,
    convention: ANALYSIS_CONVENTION,
    points: xs.map((value, index) => ({ value, units: "rad/s", totalForce: [0, 0, 0], moments: { roll: 0, pitch: values[index], yaw: 0 }, totalMoment: [0, 0, 0], totalBladePower: 0 })),
  };
}

test("sweep metrics report center, central slope, range, and slope variation", () => {
  const result = computeSweepCurveMetrics(sweep([-1, 0, 1], [2, 3, 6]), "pitch");
  assert.equal(result.center, 3);
  assert.equal(result.slope, 2);
  assert.equal(result.range, 4);
  assert.equal(result.curvature, 2);
  assert.equal(result.slopeVariation, 2);
});

test("sticky sweep domain expands but never shrinks", () => {
  const baseline = paddedSweepDomain([0, 10], 0.1);
  assert.deepEqual(baseline, [-1, 11]);
  const unchanged = expandStickySweepDomain(baseline, [2, 8], 0.1);
  assert.deepEqual(unchanged, baseline);
  const expanded = expandStickySweepDomain(unchanged, [-5, 15], 0.1);
  assert.deepEqual(expanded, [-7, 17]);
  assert.deepEqual(expandStickySweepDomain(expanded, [4, 6], 0.1), expanded);
});

test("constant sweep gets a finite padded domain", () => {
  assert.deepEqual(paddedSweepDomain([5, 5, 5], 0.1), [4.5, 5.5]);
});
