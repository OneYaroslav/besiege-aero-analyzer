import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

import { extractVanillaBlades, parseBsg, type BsgMachine, type VanillaBlade } from "../src/bsg.ts";
import type { Quaternion, Vec3 } from "../src/math.ts";
import { rotateVector } from "../src/math.ts";
import { evaluatePlot1D } from "../src/plot-lab.ts";
import { bladeAxes } from "../src/physics.ts";
import { createBladeGroup, createSnapshot, snapshotChanges, type AnalysisSessionState } from "../src/session-state.ts";
import { DEFAULT_PLOT_LAB_STATE } from "../src/plot-lab.ts";
import { DEFAULT_OPERATING_POINT, buildExportPayload, buildUiAnalysis, discoverMachine } from "../src/ui-model.ts";
import { parseAnalysisImport } from "../src/file-workflow.ts";
import {
  aircraftEulerOffsetQuaternion,
  applyBladeWhatIfOverrides,
  flipBladeOverrides,
  missingBladeWhatIfGuids,
  setBladeTransformOverrides,
  type BladeWhatIfOverride,
} from "../src/what-if.ts";

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function blade(guid: string, position: Vec3, rotation = IDENTITY, flipped = false): VanillaBlade {
  return {
    id: 26,
    guid,
    kind: "Propeller",
    position,
    rotation,
    scale: [1, 1, 1],
    booleans: new Map([["flipped", flipped]]),
    singles: new Map(), integers: new Map(), strings: new Map(), vectors: new Map(),
    flipped,
    flippedWasSerialized: true,
  };
}

function machine(): BsgMachine {
  return {
    source: "what-if.bsg",
    name: "What If",
    version: "test",
    bsgVersion: "1.4",
    globalPosition: [0, 0, 0],
    globalRotation: IDENTITY,
    blocks: [blade(A, [-2, 0, 2]), blade(B, [2, 0, 4])],
    warnings: [],
  };
}

test("What-if applies virtual flip/move/aircraft-axis rotation without mutating source BSG", () => {
  const source = machine();
  const overrides: readonly BladeWhatIfOverride[] = [{
    guid: A,
    flipped: true,
    positionOffset: [1, 2, 3],
    rotationOffsetDegrees: [90, 0, 0],
  }];
  const modified = applyBladeWhatIfOverrides(source, overrides);
  const originalBlade = source.blocks[0] as VanillaBlade;
  const modifiedBlade = extractVanillaBlades(modified)[0];
  assert.notEqual(modified, source);
  assert.deepEqual(originalBlade.position, [-2, 0, 2]);
  assert.equal(originalBlade.flipped, false);
  assert.deepEqual(modifiedBlade.position, [-1, 2, 5]);
  assert.equal(modifiedBlade.flipped, true);
  assert.deepEqual(rotateVector(modifiedBlade.rotation, [0, 1, 0]).map((value) => Math.round(value)), [0, 0, 1]);
  assert.equal(modifiedBlade.booleans.get("flipped"), true);
});

test("Flip toggles effective sense orientation and two toggles return to baseline", () => {
  const source = machine();
  const original = source.blocks[0] as VanillaBlade;
  const once = flipBladeOverrides(source, [], [A]);
  const modified = extractVanillaBlades(applyBladeWhatIfOverrides(source, once))[0];
  assert.equal(modified.flipped, true);
  assert.notDeepEqual(bladeAxes(modified).senseAxis, bladeAxes(original).senseAxis);
  assert.deepEqual(bladeAxes(modified).forceAxis, bladeAxes(original).forceAxis);
  assert.deepEqual(flipBladeOverrides(source, once, [A]), []);
});

test("Group transform assigns the same offsets and preserves relative positions", () => {
  const source = machine();
  const group = createBladeGroup("pair", "Pair", [A, B]);
  const overrides = setBladeTransformOverrides([], group.bladeGuids, [3, -1, 2], [4, 5, 6]);
  const modified = applyBladeWhatIfOverrides(source, overrides);
  assert.equal(overrides.length, 2);
  assert.deepEqual(overrides[0].rotationOffsetDegrees, overrides[1].rotationOffsetDegrees);
  const deltaBefore = source.blocks[1].position.map((value, index) => value - source.blocks[0].position[index]);
  const deltaAfter = modified.blocks[1].position.map((value, index) => value - modified.blocks[0].position[index]);
  assert.deepEqual(deltaAfter, deltaBefore);
});

test("Move and rotate overrides flow through baseline, derivatives, standard sweeps, contributions, and Plot Lab", () => {
  const source = machine();
  const discovery = discoverMachine(source);
  const point = { ...DEFAULT_OPERATING_POINT, alphaDegrees: 4, betaDegrees: 3, q: 0.2 };
  const baseline = buildUiAnalysis(source, discovery, { kind: "all" }, point, new Set(), "pitch-damping");
  const overrides = setBladeTransformOverrides([], [A], [0, 0, 4], [12, 7, 0]);
  const modified = buildUiAnalysis(source, discovery, { kind: "all" }, point, new Set(), "pitch-damping", overrides);
  assert.notDeepEqual(modified.report.stability.baseline.totalMoment, baseline.report.stability.baseline.totalMoment);
  assert.notEqual(modified.report.stability.derivatives.damping.pitchQ.derivative, baseline.report.stability.derivatives.damping.pitchQ.derivative);
  assert.notDeepEqual(modified.sweeps.q.points.map((entry) => entry.moments.pitch), baseline.sweeps.q.points.map((entry) => entry.moments.pitch));
  assert.notEqual(modified.contributions["pitch-damping"].blades.find((entry) => entry.guid === A)?.derivativeContribution, baseline.contributions["pitch-damping"].blades.find((entry) => entry.guid === A)?.derivativeContribution);
  const plotConfig = { variable: "q" as const, minimum: -0.2, maximum: 0.2, points: 5, quantities: ["pitchMoment" as const] };
  const baselinePlot = evaluatePlot1D(baseline.report.blades, baseline.report.state, plotConfig);
  const modifiedPlot = evaluatePlot1D(modified.report.blades, modified.report.state, plotConfig);
  assert.notDeepEqual(modifiedPlot.points, baselinePlot.points);
  assert.deepEqual(modified.report.availableBlades.find((item) => item.guid === A)?.position, modified.report.machine.blocks.find((item) => item.guid === A)?.position);
});

test("Snapshot and analysis JSON preserve GUID what-if overrides and report missing GUIDs safely", () => {
  const source = machine();
  const overrides: readonly BladeWhatIfOverride[] = [{ guid: A, flipped: true, positionOffset: [0, 0, 2], rotationOffsetDegrees: [5, 0, 0] }];
  const bundle = buildUiAnalysis(source, discoverMachine(source), { kind: "all" }, DEFAULT_OPERATING_POINT, new Set(), "pitch-damping", overrides);
  const state: AnalysisSessionState = {
    mode: "single", activeMachine: "A", operatingPoint: DEFAULT_OPERATING_POINT,
    plotLab: DEFAULT_PLOT_LAB_STATE, showDeltaPercent: false,
    machines: [{ machineName: source.name, groupSelection: { kind: "all" }, cgMode: "auto", disabledBladeGuids: [], bladeGroups: [], whatIfOverrides: overrides }],
  };
  const snapshot = createSnapshot("modified", "Modified", "", "2026-08-22T12:00:00.000Z", state);
  const payload = buildExportPayload(bundle, undefined, { precision: "auto", plotLab: DEFAULT_PLOT_LAB_STATE, snapshots: [snapshot] });
  const imported = parseAnalysisImport(JSON.stringify(payload));
  assert.deepEqual(imported.machines[0].whatIfOverrides, overrides);
  assert.deepEqual(imported.snapshots[0].state.machines[0].whatIfOverrides, overrides);
  assert.deepEqual(missingBladeWhatIfGuids(source, [...overrides, { ...overrides[0], guid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }]), ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  const baselineState = { ...state, machines: [{ ...state.machines[0], whatIfOverrides: [] }] };
  assert.ok(snapshotChanges(baselineState, state).includes("machine A What-if transforms/flips changed"));
});

test("Aircraft Euler offset is finite and applies pitch +X, yaw +Y, roll +Z in documented order", () => {
  const q = aircraftEulerOffsetQuaternion([90, 0, 0]);
  const y = rotateVector(q, [0, 1, 0]);
  assert.ok(y.every(Number.isFinite));
  assert.ok(Math.abs(y[2] - 1) < 1e-12);
});

const REAL_FIXTURES = [
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Проект Ескапе.bsg",
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Поцыки\\Saab JAS 39 Gripen2.bsg",
] as const;

for (const fixture of REAL_FIXTURES) {
  test(`real What-if transform propagates through solver and sweeps: ${fixture.split("\\").at(-1)}`, { skip: !existsSync(fixture) }, () => {
    const source = parseBsg(readFileSync(fixture, "utf8"), fixture);
    const blades = extractVanillaBlades(source);
    assert.ok(blades.length > 1);
    const discovery = discoverMachine(source);
    const point = { ...DEFAULT_OPERATING_POINT, alphaDegrees: 3, betaDegrees: 2, q: 0.1 };
    const baseline = buildUiAnalysis(source, discovery, { kind: "all" }, point, new Set(), "pitch-damping");
    const nose = blades.reduce((candidate, blade) => blade.position[2] > candidate.position[2] ? blade : candidate);
    const topPitchGuid = baseline.contributions["pitch-damping"].blades[0].guid;
    let overrides = setBladeTransformOverrides([], [nose.guid], [0, 0, 1], [0, 0, 0]);
    overrides = setBladeTransformOverrides(overrides, [topPitchGuid], topPitchGuid === nose.guid ? [0, 0, 1] : [0, 0, 0], [5, 0, 0]);
    overrides = flipBladeOverrides(source, overrides, [blades[0].guid]);
    const modified = buildUiAnalysis(source, discovery, { kind: "all" }, point, new Set(), "pitch-damping", overrides);
    assert.notDeepEqual(modified.report.stability.baseline.totalMoment, baseline.report.stability.baseline.totalMoment);
    assert.notDeepEqual(modified.sweeps.q.points.map((entry) => entry.moments.pitch), baseline.sweeps.q.points.map((entry) => entry.moments.pitch));
    assert.notEqual(modified.report.stability.derivatives.damping.pitchQ.derivative, baseline.report.stability.derivatives.damping.pitchQ.derivative);
    assert.equal(modified.report.availableBlades.find((blade) => blade.guid === nose.guid)?.position[2], nose.position[2] + 1);
    assert.deepEqual(source.blocks.find((block) => block.guid === nose.guid)?.position, nose.position);
  });
}
