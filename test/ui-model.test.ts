import assert from "node:assert/strict";
import test from "node:test";
import type { BsgMachine, VanillaBlade } from "../src/bsg.ts";
import type { Quaternion, Vec3 } from "../src/math.ts";
import {
  DEFAULT_OPERATING_POINT,
  assembleComparisonRows,
  buildBladeRows,
  buildUiAnalysis,
  discoverMachine,
  formatNumber,
} from "../src/ui-model.ts";

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

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

function machine(name: string, blades: readonly VanillaBlade[]): BsgMachine {
  return {
    source: `${name}.bsg`,
    name,
    version: "test",
    bsgVersion: "1.4",
    globalPosition: [0, 0, 0],
    globalRotation: IDENTITY,
    blocks: blades,
    warnings: [],
  };
}

test("UI view model assembles compare rows and zeroes disabled blade table output", () => {
  const firstMachine = machine("A", [blade("a1", [0, 0, 1]), blade("a2", [0, 0, 2])]);
  const secondMachine = machine("B", [blade("b1", [0, 0, 3])]);
  const firstDiscovery = discoverMachine(firstMachine);
  const secondDiscovery = discoverMachine(secondMachine);
  const first = buildUiAnalysis(
    firstMachine,
    firstDiscovery,
    { kind: "all" },
    { ...DEFAULT_OPERATING_POINT, alphaDegrees: 5 },
    new Set(["a2"]),
    "pitch-damping",
  );
  const second = buildUiAnalysis(
    secondMachine,
    secondDiscovery,
    { kind: "all" },
    { ...DEFAULT_OPERATING_POINT, alphaDegrees: 5 },
    new Set(),
    "pitch-damping",
  );
  const rows = buildBladeRows(first);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].enabled, false);
  assert.deepEqual(rows[1].force, [0, 0, 0]);
  const comparison = assembleComparisonRows(first, second);
  assert.deepEqual(comparison.map((row) => row.key), [
    "mass", "cg", "blades", "force", "moment", "power",
    "pitch-alpha", "yaw-beta", "roll-beta", "roll-p", "pitch-q", "yaw-r",
  ]);
  assert.equal(comparison.find((row) => row.key === "blades")?.first, 1);
});

test("number precision modes are deterministic", () => {
  assert.equal(formatNumber(12.34567, "3"), "12.346");
  assert.equal(formatNumber(12.34567, "6"), "12.345670");
  assert.equal(formatNumber(0, "auto"), "0");
});
