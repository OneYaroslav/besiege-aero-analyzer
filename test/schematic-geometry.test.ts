import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { extractVanillaBlades, type BsgBlock, type VanillaBlade } from "../src/bsg.ts";
import { selectAnalysisGroup } from "../src/groups.ts";
import { loadBsg } from "../src/bsg-node.ts";
import {
  collectSchematicBoundsPoints,
  resolveBuildSurfaceVertices,
  resolveSchematicBlock,
  schematicBladeProfile,
  schematicBlockProfile,
  transformBlockLocalPoint,
} from "../src/schematic-geometry.ts";

function block(id: number, guid: string, overrides: Partial<BsgBlock> = {}): BsgBlock {
  return {
    id,
    guid,
    position: [0, 0, 0],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: [1, 1, 1],
    booleans: new Map(),
    singles: new Map(),
    integers: new Map(),
    strings: new Map(),
    vectors: new Map(),
    ...overrides,
  };
}

test("schematic block point transform preserves parsed scale, quaternion and position", () => {
  const rotated = block(1, "beam", {
    position: [10, 20, 30],
    scale: [2, 3, 4],
    rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
  });
  const transformed = transformBlockLocalPoint(rotated, [1, 0, 0]);
  assert.ok(Math.abs(transformed[0] - 10) < 1e-12);
  assert.ok(Math.abs(transformed[1] - 22) < 1e-12);
  assert.ok(Math.abs(transformed[2] - 30) < 1e-12);
});

test("type profiles distinguish elongated, surface-like and round blocks", () => {
  const pole = schematicBlockProfile(block(41, "pole", { integers: new Map([["length", 2]]) }));
  const wing = schematicBlockProfile(block(25, "wing"));
  const wheel = schematicBlockProfile(block(50, "wheel"));
  const buildNode = schematicBlockProfile(block(71, "build-node"));
  assert.equal(pole.kind, "box");
  assert.ok(pole.size[2] > pole.size[0] * 2.5);
  assert.equal(wing.category, "surface");
  assert.ok(wing.size[1] < wing.size[0] / 4);
  assert.equal(wheel.kind, "cylinder");
  assert.equal(buildNode.kind, "box");
  assert.equal(buildNode.color, 0x090b0d);
  assert.deepEqual(buildNode.size, [0.285051, 0.285051, 0.285051]);
  assert.ok(Math.abs(wing.offset[2] - 2.6729834) < 1e-5, "wing offset comes from installed prefab renderer bounds");
});

test("WoodenPole shortening variants use serialized vanilla lengths instead of the combined prefab AABB", () => {
  const shortPole = schematicBlockProfile(block(41, "short-pole", { integers: new Map([["length", 1]]) }));
  const longPole = schematicBlockProfile(block(41, "long-pole", { integers: new Map([["length", 2]]) }));
  assert.deepEqual(shortPole.size, [0.34, 0.34, 1]);
  assert.deepEqual(longPole.size, [0.34, 0.34, 2]);
  assert.deepEqual(shortPole.offset, [0, 0, 0.5]);
  assert.deepEqual(longPole.offset, [0, 0, 1]);
});

test("Log Block id=63 is a visible solid beam with its serialized length", () => {
  const shortBeam = schematicBlockProfile(block(63, "short-beam", { integers: new Map([["length", 2]]) }));
  const longBeam = schematicBlockProfile(block(63, "long-beam", { integers: new Map([["length", 3]]) }));
  assert.equal(shortBeam.kind, "box");
  assert.deepEqual(shortBeam.size, [1.2122759819030762, 1.080829501152039, 2.329521656036377]);
  assert.deepEqual(longBeam.size, [1.2122759819030762, 1.080829501152039, 3.3326606750488277]);
  assert.deepEqual(shortBeam.offset, [0.022614508867263794, -0.002088725566863958, 0.9755342602729797]);
  assert.deepEqual(longBeam.offset, [0.022614508867263794, -0.002088725566863847, 1.477103769779205]);
  assert.ok(shortBeam.size[2] > 2.32 && longBeam.size[2] > 3.33, "official visuals overhang both logical endpoints");
});

test("visual blade base plate contains no aerodynamic sense rotation", () => {
  const visual = schematicBladeProfile({ id: 26 });
  assert.deepEqual(visual.localRotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.deepEqual(visual.offset, [0, 0, visual.length / 2]);
  assert.ok(visual.length > schematicBladeProfile({ id: 55 }).length);
});

test("serialized dragged-block endpoints are transformed into a visible segment", () => {
  const brace = block(7, "brace", {
    position: [1, 2, 3],
    scale: [2, 1, 1],
    vectors: new Map([["start-position", [0, 0, 0]], ["end-position", [1, 0, 0]]]),
  });
  const resolved = resolveSchematicBlock(brace, new Map([[brace.guid, brace]]));
  assert.equal(resolved.kind, "segment");
  if (resolved.kind !== "segment") return;
  assert.deepEqual(resolved.start, [1, 2, 3]);
  assert.deepEqual(resolved.end, [3, 2, 3]);
  assert.equal(resolved.source, "serialized-endpoints");
  assert.equal(resolved.blockId, 7);
  assert.equal(resolved.crossSection, "square");
  assert.equal(resolved.diameter, 0.15);
  assert.deepEqual(resolved.endpointMarkers, {
    size: 0.285051,
    thickness: 0.285051,
    color: 0x090b0d,
  });
});

test("BuildEdge and BuildSurface use only explicit serialized GUID links", () => {
  const a = block(71, "a", { position: [0, 0, 0] });
  const b = block(71, "b", { position: [2, 0, 0] });
  const c = block(71, "c", { position: [0, 0, 2] });
  const ab = block(72, "ab", { strings: new Map([["start", "a"], ["end", "b"]]) });
  const bc = block(72, "bc", { strings: new Map([["start", "b"], ["end", "c"]]) });
  const ca = block(72, "ca", { strings: new Map([["start", "c"], ["end", "a"]]) });
  const surface = block(73, "surface", { strings: new Map([["edges", "ab|bc|ca"]]) });
  const blocks = [a, b, c, ab, bc, ca, surface];
  const byGuid = new Map(blocks.map((entry) => [entry.guid, entry]));
  const edge = resolveSchematicBlock(ab, byGuid);
  assert.equal(edge.kind, "segment");
  if (edge.kind === "segment") {
    assert.deepEqual([edge.start, edge.end], [a.position, b.position]);
    assert.equal(edge.blockId, 72);
    assert.equal(edge.crossSection, "round");
    assert.equal(edge.endpointMarkers, undefined);
  }
  assert.deepEqual(resolveBuildSurfaceVertices(surface, byGuid), [a.position, b.position, c.position]);
  const resolvedSurface = resolveSchematicBlock(surface, byGuid);
  assert.equal(resolvedSurface.kind, "surface");
});

const ESKAPIE = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Проект Ескапе.bsg";
const GRIPEN = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Поцыки\\Saab JAS 39 Gripen2.bsg";

for (const fixture of [ESKAPIE, GRIPEN]) {
  test(`real aircraft group has complete schematic coverage: ${fixture.split("\\").at(-1)}`, { skip: !existsSync(fixture) }, () => {
    const machine = loadBsg(fixture);
    const blades = extractVanillaBlades(machine);
    const { group } = selectAnalysisGroup(machine, blades, {
      mode: "aircraft-heuristic",
      includeGuids: new Set(),
      excludeGuids: new Set(),
    });
    const groupGuids = new Set(group.blocks.map((entry) => entry.guid));
    const selectedBlades = blades.filter((blade): blade is VanillaBlade => groupGuids.has(blade.guid));
    const byGuid = new Map(group.blocks.map((entry) => [entry.guid, entry]));
    const resolved = group.blocks.map((entry) => resolveSchematicBlock(entry, byGuid));
    assert.equal(resolved.length, group.blocks.length);
    assert.ok(resolved.some((entry) => entry.kind === "segment"));
    assert.ok(resolved.some((entry) => entry.kind === "surface"));
    const bounds = collectSchematicBoundsPoints(group.blocks, selectedBlades);
    assert.ok(bounds.length > group.blocks.length);
    assert.ok(Math.max(...bounds.map((point) => point[2])) - Math.min(...bounds.map((point) => point[2])) > 5);
  });
}
