import assert from "node:assert/strict";
import test from "node:test";

import {
  bladeSelectionMap,
  buildInspectorColorScale,
  computeInspectorBounds,
  frameInspectorCamera,
  hideSelectedBlades,
  inspectorColor,
  inspectorDisplayValue,
  isolateSelectedBlades,
  normalizeInspectorColorValue,
  showAllBlades,
  summarizeBladeSelection,
  updateBladeSelection,
  visibleBladeGuids,
} from "../src/inspector.ts";
import type { BladeTableRow } from "../src/ui-model.ts";
import type { VanillaBlade } from "../src/bsg.ts";
import { ANALYSIS_CONVENTION } from "../src/analysis.ts";

function row(guid: string, force: readonly [number, number, number], moment: readonly [number, number, number], power: number): BladeTableRow {
  const blade: VanillaBlade = {
    id: 26,
    guid,
    kind: "Propeller",
    position: [0, 0, 0],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: [1, 1, 1],
    booleans: new Map(), singles: new Map(), integers: new Map(), strings: new Map(), vectors: new Map(),
    flipped: false,
    flippedWasSerialized: true,
  };
  return { index: 1, blade, enabled: true, force, moment, pitchMoment: moment[0], yawMoment: moment[1], rollMoment: moment[2], power };
}

test("blade GUID selection supports replace, add, toggle, clear and mapping", () => {
  let selected = updateBladeSelection(new Set(), "a");
  selected = updateBladeSelection(selected, "b", "add");
  assert.deepEqual([...selected], ["a", "b"]);
  selected = updateBladeSelection(selected, "a", "toggle");
  assert.deepEqual([...selected], ["b"]);
  assert.deepEqual([...bladeSelectionMap(["a", "b"], selected)], [["a", false], ["b", true]]);
  assert.equal(updateBladeSelection(selected, null).size, 0);
});

test("selection summary sums force, moment, power and active derivative contribution", () => {
  const rows = [row("a", [1, 2, 3], [4, 5, 6], 7), row("b", [-1, 3, 2], [1, -2, 4], -2)];
  const contribution = {
    derivative: "pitch-damping" as const, input: "q" as const, output: "M_pitch" as const, step: 0.01,
    units: "moment/(rad/s)" as const, totalDerivative: 5, contributionSum: 5,
    blades: rows.map((entry, index) => ({ guid: entry.blade.guid, id: 26, type: "Propeller" as const, position: entry.blade.position, flipped: false, baselineMoment: entry.moment, baselineProjectedMoment: entry.pitchMoment, derivativeContribution: index + 2, absoluteContribution: index + 2, percentageOfTotal: null })),
    convention: ANALYSIS_CONVENTION,
  };
  const summary = summarizeBladeSelection(rows, new Set(["a", "b"]), "pitch-damping", { "pitch-damping": contribution });
  assert.deepEqual(summary.totalForce, [0, 5, 5]);
  assert.equal(summary.totalPower, 5);
  assert.deepEqual([summary.pitchMoment, summary.yawMoment, summary.rollMoment], [5, 3, 10]);
  assert.equal(summary.displayContribution, 5);
  assert.ok(Math.abs((inspectorDisplayValue("force", rows[0], {}) ?? 0) - Math.sqrt(14)) < 1e-12);
  assert.equal(inspectorDisplayValue("power", rows[0], {}), 7);
  assert.equal(inspectorDisplayValue("pitch-moment", rows[0], {}), 4);
  assert.equal(inspectorDisplayValue("yaw-moment", rows[0], {}), 5);
  assert.equal(inspectorDisplayValue("roll-moment", rows[0], {}), 6);
  assert.equal(inspectorDisplayValue("pitch-damping", rows[0], { "pitch-damping": contribution }), 2);
  assert.equal(inspectorDisplayValue("geometry", rows[0], {}), null);
});

test("signed color scale is zero-centered and symmetric", () => {
  const scale = buildInspectorColorScale([-2, 6], true);
  assert.deepEqual([scale.minimum, scale.maximum], [-6, 6]);
  assert.equal(normalizeInspectorColorValue(-3, scale), -0.5);
  assert.equal(normalizeInspectorColorValue(3, scale), 0.5);
  assert.notEqual(inspectorColor(-3, scale), inspectorColor(3, scale));
  assert.equal(normalizeInspectorColorValue(0, scale), 0);
});

test("unsigned color scale starts at zero", () => {
  const scale = buildInspectorColorScale([2, 8], false);
  assert.deepEqual([scale.minimum, scale.maximum], [0, 8]);
  assert.equal(normalizeInspectorColorValue(-2, scale), 0);
  assert.equal(normalizeInspectorColorValue(4, scale), 0.5);
});

test("hide, isolate and show-all visibility states remain distinct", () => {
  const all = ["a", "b", "c"];
  const hidden = hideSelectedBlades(showAllBlades(), new Set(["b"]));
  assert.deepEqual([...visibleBladeGuids(all, hidden)], ["a", "c"]);
  const isolated = isolateSelectedBlades(new Set(["a", "c"]));
  assert.deepEqual([...visibleBladeGuids(all, isolated)], ["a", "c"]);
  assert.deepEqual([...visibleBladeGuids(all, showAllBlades())], all);
});

test("bounds and camera framing center the selected analysis group", () => {
  const bounds = computeInspectorBounds([[-2, -1, 0], [4, 3, 10]]);
  assert.deepEqual(bounds.center, [1, 1, 5]);
  assert.deepEqual(bounds.size, [6, 4, 10]);
  const front = frameInspectorCamera(bounds, "front", 16 / 9);
  assert.deepEqual(front.target, bounds.center);
  assert.ok(front.position[2] > bounds.center[2]);
  assert.ok(front.near > 0 && front.far > front.distance);
  const top = frameInspectorCamera(bounds, "top", 1);
  assert.ok(top.position[1] > bounds.center[1]);
  assert.deepEqual(top.up, [0, 0, 1]);
});

test("camera framing fits the projected aircraft box instead of an oversized bounding sphere", () => {
  const flatAircraft = computeInspectorBounds([[-6, -1, -9], [6, 1, 9]]);
  const perspective = frameInspectorCamera(flatAircraft, "perspective", 16 / 9);
  const front = frameInspectorCamera(flatAircraft, "front", 16 / 9);
  assert.ok(Number.isFinite(perspective.distance));
  assert.ok(perspective.distance > flatAircraft.radius);
  assert.ok(front.distance < flatAircraft.radius * 2, "a shallow front projection should not be framed as a sphere");
});
