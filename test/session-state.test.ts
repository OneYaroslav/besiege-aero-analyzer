import assert from "node:assert/strict";
import test from "node:test";

import type { BsgMachine, VanillaBlade } from "../src/bsg.ts";
import { parseAnalysisImport } from "../src/file-workflow.ts";
import type { Quaternion, Vec3 } from "../src/math.ts";
import { DEFAULT_PLOT_LAB_STATE } from "../src/plot-lab.ts";
import {
  bladeGroupEnabledState,
  createBladeGroup,
  createSnapshot,
  deleteBladeGroup,
  duplicateSnapshot,
  renameBladeGroup,
  setBladeGroupEnabled,
  snapshotChanges,
  summarizeBladeGroup,
  type AnalysisSessionState,
} from "../src/session-state.ts";
import { DEFAULT_OPERATING_POINT, buildBladeRows, buildExportPayload, buildUiAnalysis, discoverMachine } from "../src/ui-model.ts";

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function blade(guid: string, position: Vec3): VanillaBlade {
  return {
    id: 26,
    guid,
    kind: "Propeller",
    position,
    rotation: IDENTITY,
    scale: [1, 1, 1],
    booleans: new Map(),
    singles: new Map(),
    integers: new Map(),
    strings: new Map(),
    vectors: new Map(),
    flipped: false,
    flippedWasSerialized: true,
  };
}

function analysis() {
  const machine: BsgMachine = {
    source: "groups.bsg",
    name: "Groups",
    version: "test",
    bsgVersion: "1.4",
    globalPosition: [0, 0, 0],
    globalRotation: IDENTITY,
    blocks: [blade(A, [-2, 0, 1]), blade(B, [2, 0, 2])],
    warnings: [],
  };
  return buildUiAnalysis(machine, discoverMachine(machine), { kind: "all" }, DEFAULT_OPERATING_POINT, new Set(), "pitch-damping");
}

function state(): AnalysisSessionState {
  return {
    mode: "single",
    activeMachine: "A",
    operatingPoint: { ...DEFAULT_OPERATING_POINT },
    plotLab: { ...DEFAULT_PLOT_LAB_STATE },
    showDeltaPercent: false,
    machines: [{
      machineName: "Groups",
      groupSelection: { kind: "all" },
      cgMode: "auto",
      disabledBladeGuids: [],
      bladeGroups: [createBladeGroup("main", "Main blades", [A, B])],
      whatIfOverrides: [],
    }],
  };
}

test("Blade Groups are GUID sets with rename/delete and group what-if control", () => {
  const group = createBladeGroup("main", "  Main blades ", [A, A, B]);
  assert.equal(group.name, "Main blades");
  assert.deepEqual(group.bladeGuids, [A, B]);
  assert.equal(bladeGroupEnabledState(group, new Set()), "enabled");
  const partiallyDisabled = setBladeGroupEnabled(new Set(), createBladeGroup("one", "One", [A]), false);
  assert.equal(bladeGroupEnabledState(group, partiallyDisabled), "mixed");
  const disabled = setBladeGroupEnabled(partiallyDisabled, group, false);
  assert.equal(bladeGroupEnabledState(group, disabled), "disabled");
  assert.deepEqual([...setBladeGroupEnabled(disabled, group, true)], []);
  assert.equal(renameBladeGroup([group], "main", "Renamed")[0].name, "Renamed");
  assert.deepEqual(deleteBladeGroup([group], "main"), []);
});

test("Blade Group summary equals the sum of its current per-blade solver rows and derivative contributions", () => {
  const bundle = analysis();
  const group = createBladeGroup("main", "All", [A, B]);
  const summary = summarizeBladeGroup(bundle, group, new Set());
  const rows = buildBladeRows(bundle);
  assert.deepEqual(summary.totalForce, rows.reduce<Vec3>((sum, row) => [sum[0] + row.force[0], sum[1] + row.force[1], sum[2] + row.force[2]], [0, 0, 0]));
  assert.equal(summary.bladePower, rows.reduce((sum, row) => sum + row.power, 0));
  for (const kind of ["pitch-damping", "yaw-damping", "roll-damping", "pitch-alpha", "yaw-beta"] as const) {
    const expected = bundle.contributions[kind].blades.reduce((sum, row) => sum + row.derivativeContribution, 0);
    assert.ok(Math.abs(summary.derivativeContributions[kind] - expected) < 1e-9);
  }
});

test("Snapshots deep-copy configuration, duplicate cleanly, and describe state changes", () => {
  const original = state();
  const snapshot = createSnapshot("snapshot-a", "Cruise", "baseline", "2026-08-22T12:00:00.000Z", original);
  const duplicate = duplicateSnapshot(snapshot, "snapshot-b", "2026-08-22T12:01:00.000Z");
  assert.equal(duplicate.name, "Cruise copy");
  assert.notEqual(duplicate.state, snapshot.state);
  assert.notEqual(duplicate.state.machines[0].bladeGroups, snapshot.state.machines[0].bladeGroups);

  const changed: AnalysisSessionState = {
    ...snapshot.state,
    operatingPoint: { ...snapshot.state.operatingPoint, q: 0.25 },
    machines: [{ ...snapshot.state.machines[0], disabledBladeGuids: [A] }],
  };
  assert.deepEqual(snapshotChanges(snapshot.state, changed), ["q: 0 → 0.25", "machine A blades: 1 disabled, 0 enabled"]);
});

test("analysis JSON export/import round-trips Blade Groups and Snapshots", () => {
  const bundle = analysis();
  const group = createBladeGroup("main", "Main blades", [A, B]);
  const saved = createSnapshot("snapshot-a", "Cruise", "", "2026-08-22T12:00:00.000Z", state());
  const payload = buildExportPayload(bundle, undefined, {
    precision: "auto",
    plotLab: DEFAULT_PLOT_LAB_STATE,
    activeMachine: "A",
    showDeltaPercent: false,
    bladeGroups: [[group]],
    snapshots: [saved],
  });
  const imported = parseAnalysisImport(JSON.stringify(payload));
  assert.deepEqual(imported.machines[0].bladeGroups, [group]);
  assert.equal(imported.snapshots[0].name, "Cruise");
  assert.deepEqual(imported.snapshots[0].state.machines[0].bladeGroups[0].bladeGuids, [A, B]);
});
