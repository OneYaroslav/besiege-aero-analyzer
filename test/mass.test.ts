import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { extractVanillaBlades, type BsgBlock, type BsgMachine } from "../src/bsg.ts";
import { loadBsg } from "../src/bsg-node.ts";
import { selectAnalysisGroup, suggestComponents, type AnalysisGroup } from "../src/groups.ts";
import { analyzeMass } from "../src/mass.ts";
import type { Quaternion, Vec3 } from "../src/math.ts";

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const DEFAULT_FIXTURE = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Проект Ескапе.bsg";
const fixture = process.env.BESIEGE_BSG_FIXTURE ?? DEFAULT_FIXTURE;

function block(id: number, guid: string, position: Vec3, values: Partial<BsgBlock> = {}): BsgBlock {
  return {
    id,
    guid,
    position,
    rotation: IDENTITY,
    scale: [1, 1, 1],
    booleans: new Map(),
    singles: new Map(),
    integers: new Map(),
    strings: new Map(),
    vectors: new Map(),
    ...values,
  };
}

function group(blocks: readonly BsgBlock[]): AnalysisGroup {
  return { label: "test", mode: "include", blocks, excludedGuids: [], warnings: [] };
}

function machine(blocks: readonly BsgBlock[]): BsgMachine {
  return {
    source: "<test>",
    name: "test",
    version: "test",
    bsgVersion: "1.4",
    globalPosition: [0, 0, 0],
    globalRotation: IDENTITY,
    blocks,
    warnings: [],
  };
}

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("CG is the mass-weighted mean and point inertia is about that CG", () => {
  const result = analyzeMass(group([
    block(68, "half", [0, 0, 0]), // LogicGate mass 0.5
    block(13, "one", [2, 0, 0]), // SteeringBlock mass 1.0
  ]));
  close(result.totalMass, 1.5);
  close(result.centerOfMass[0], 4 / 3);
  close(result.centerOfMass[1], 0);
  close(result.centerOfMass[2], 0);
  close(result.pointMassInertia.xx, 0);
  close(result.pointMassInertia.yy, 4 / 3);
  close(result.pointMassInertia.zz, 4 / 3);
});

test("include and exclude GUIDs select an explicit AnalysisGroup", () => {
  const blocks = [block(68, "a", [0, 0, 0]), block(68, "b", [0.2, 0, 0]), block(68, "c", [0.4, 0, 0])];
  const included = selectAnalysisGroup(machine(blocks), [], {
    mode: "all",
    includeGuids: new Set(["a", "b"]),
    excludeGuids: new Set(["b"]),
  }).group;
  assert.equal(included.mode, "include");
  assert.deepEqual(included.blocks.map((entry) => entry.guid), ["a"]);
  assert.deepEqual(new Set(included.excludedGuids), new Set(["b", "c"]));

  const excluded = selectAnalysisGroup(machine(blocks), [], {
    mode: "all",
    includeGuids: new Set(),
    excludeGuids: new Set(["c"]),
  }).group;
  assert.deepEqual(excluded.blocks.map((entry) => entry.guid), ["a", "b"]);
});

test("only the code-confirmed two-toggle RSM force-mass override is applied", () => {
  const disabled = block(68, "disabled", [0, 0, 0], {
    booleans: new Map([["bmt-SimpleSet", true], ["bmt-Forcemass", false]]),
    singles: new Map([["bmt-RNFmass", 3]]),
  });
  const enabled = block(68, "enabled", [0, 0, 0], {
    booleans: new Map([["bmt-SimpleSet", true], ["bmt-Forcemass", true]]),
    singles: new Map([["bmt-RNFmass", 3]]),
  });
  const result = analyzeMass(group([disabled, enabled]));
  close(result.totalMass, 3.5);
  assert.equal(result.contributions[0].massProvenance, "prefab-verified");
  assert.equal(result.contributions[1].massProvenance, "block-specific-override");
});

test("installed ShorteningBlock Log length override is applied", () => {
  const shortenedLog = block(63, "log", [0, 0, 0], {
    integers: new Map([["bmt-version", 1], ["length", 2]]),
  });
  const result = analyzeMass(group([shortenedLog]));
  close(result.totalMass, 0.6499999761581421);
  assert.equal(result.contributions[0].massProvenance, "block-specific-override");
});

test("Проект Ескапе heuristic remains explicit and identifies the observed spatial clusters", { skip: !existsSync(fixture) }, () => {
  const parsed = loadBsg(fixture);
  const blades = extractVanillaBlades(parsed);
  const suggestion = suggestComponents(parsed, blades, 1.5);
  assert.match(suggestion.warning, /HEURISTIC/);
  assert.deepEqual(suggestion.components.map((entry) => [entry.blocks.length, entry.bladeCount]), [
    [201, 37],
    [28, 0],
    [1, 0],
  ]);
  const all = analyzeMass({ label: "all", mode: "all", blocks: parsed.blocks, excludedGuids: [], warnings: [] });
  const aircraft = analyzeMass({
    label: "aircraft heuristic",
    mode: "aircraft-heuristic",
    blocks: suggestion.suggestedAircraft.blocks,
    excludedGuids: parsed.blocks
      .filter((entry) => !suggestion.suggestedAircraft.blocks.includes(entry))
      .map((entry) => entry.guid),
    warnings: [suggestion.warning],
  });
  close(all.totalMass, 95.30000066954881, 1e-8);
  close(aircraft.totalMass, 77.80000066954881, 1e-8);
  close(all.centerOfMass[1], -1.320020672103829, 1e-6);
  close(aircraft.centerOfMass[1], -2.466807738643861, 1e-6);
});
