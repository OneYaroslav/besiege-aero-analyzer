import assert from "node:assert/strict";
import test from "node:test";

import type { AnalysisState } from "../src/analysis.ts";
import type { VanillaBlade } from "../src/bsg.ts";
import type { Quaternion } from "../src/math.ts";
import {
  deltaPercent,
  deltaValue,
  evaluatePlot1D,
  evaluatePlot2D,
  formatPlot1DCsv,
  formatPlot2DCsv,
  stateForPlotInput,
} from "../src/plot-lab.ts";

const rotation: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const blade: VanillaBlade = {
  id: 26,
  guid: "plot-blade",
  kind: "Propeller",
  position: [1, 0, 2],
  rotation,
  scale: [1, 1, 1],
  booleans: new Map(),
  singles: new Map(),
  integers: new Map(),
  strings: new Map(),
  vectors: new Map(),
  flipped: false,
  flippedWasSerialized: true,
};
const state: AnalysisState = {
  speed: 100,
  alpha: 0.1,
  beta: -0.2,
  p: 0.01,
  q: 0.02,
  r: 0.03,
  centerOfGravity: [0, 0, 0],
  analysisGroup: { label: "test", mode: "all", blocks: [blade], excludedGuids: [], warnings: [] },
};

test("arbitrary 1D plot generates inclusive samples and requested quantities", () => {
  const result = evaluatePlot1D([blade], state, {
    variable: "alpha",
    minimum: -10,
    maximum: 10,
    points: 5,
    quantities: ["pitchMoment", "pitchQ"],
  });
  assert.deepEqual(result.points.map((point) => point.x), [-10, -5, 0, 5, 10]);
  assert.equal(result.points.length, 5);
  assert.ok(Number.isFinite(result.points[2].values.pitchMoment));
  assert.ok(Number.isFinite(result.points[2].values.pitchQ));
});

test("plot input changes only the selected state variable", () => {
  const changed = stateForPlotInput(state, "alpha", 15);
  assert.equal(changed.alpha, 15 * Math.PI / 180);
  assert.equal(changed.speed, state.speed);
  assert.equal(changed.beta, state.beta);
  assert.equal(changed.p, state.p);
  assert.equal(changed.q, state.q);
  assert.equal(changed.r, state.r);
  assert.deepEqual(state, { ...state, alpha: 0.1 });
});

test("2D plot generates a row-major X/Y grid without mutating the operating point", () => {
  const result = evaluatePlot2D([blade], state, {
    xVariable: "alpha",
    yVariable: "q",
    xRange: { minimum: -5, maximum: 5, points: 3 },
    yRange: { minimum: -0.1, maximum: 0.1, points: 2 },
    quantity: "pitchMoment",
  });
  assert.equal(result.points.length, 6);
  assert.deepEqual(result.points.map(({ x, y }) => [x, y]), [
    [-5, -0.1], [0, -0.1], [5, -0.1],
    [-5, 0.1], [0, 0.1], [5, 0.1],
  ]);
  assert.equal(state.alpha, 0.1);
  assert.equal(state.q, 0.02);
});

test("compare delta is B minus A and percent returns null near a zero A denominator", () => {
  assert.equal(deltaValue(3, 8), 5);
  assert.equal(deltaPercent(4, 6), 50);
  assert.equal(deltaPercent(1e-12, 10), null);
});

test("1D CSV contains exact samples and compare delta columns", () => {
  const first = evaluatePlot1D([blade], state, { variable: "q", minimum: 0, maximum: 0.1, points: 2, quantities: ["pitchMoment"] });
  const second = evaluatePlot1D([blade], { ...state, centerOfGravity: [0.5, 0, 0] }, { variable: "q", minimum: 0, maximum: 0.1, points: 2, quantities: ["pitchMoment"] });
  const csv = formatPlot1DCsv(first, "Machine A", second, "Machine B");
  const lines = csv.split("\r\n");
  assert.match(lines[0], /Delta B - A/);
  assert.equal(lines.length, 3);
  assert.equal(lines[2].split(",")[0], "0.1");
});

test("2D CSV uses one row per grid cell and includes A/B/delta fields", () => {
  const config = {
    xVariable: "speed" as const,
    yVariable: "alpha" as const,
    xRange: { minimum: 0, maximum: 100, points: 2 },
    yRange: { minimum: -5, maximum: 5, points: 3 },
    quantity: "bladePower" as const,
  };
  const first = evaluatePlot2D([blade], state, config);
  const second = evaluatePlot2D([blade], { ...state, centerOfGravity: [0.5, 0, 0] }, config);
  const csv = formatPlot2DCsv(first, "A", second, "B");
  const lines = csv.split("\r\n");
  assert.match(lines[0], /Delta B - A/);
  assert.equal(lines.length, 7);
  assert.equal(lines[1].split(",").length, 5);
});
