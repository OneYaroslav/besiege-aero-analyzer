import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { extractVanillaBlades } from "../src/bsg.ts";
import { loadBsg } from "../src/bsg-node.ts";

const DEFAULT_FIXTURE = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Проект Ескапе.bsg";
const fixture = process.env.BESIEGE_BSG_FIXTURE ?? DEFAULT_FIXTURE;

test("real Проект Ескапе.bsg parses as the expected vanilla-blade fixture", { skip: !existsSync(fixture) }, () => {
  const machine = loadBsg(fixture);
  const blades = extractVanillaBlades(machine);
  assert.equal(machine.name, "Проект Ескапе");
  assert.equal(machine.bsgVersion, "1.4");
  assert.equal(machine.blocks.length, 230);
  assert.equal(blades.filter((blade) => blade.id === 26).length, 14);
  assert.equal(blades.filter((blade) => blade.id === 55).length, 23);
  assert.ok(blades.every((blade) => blade.flippedWasSerialized));
  assert.ok(blades.some((blade) => blade.flipped));
  assert.ok(blades.some((blade) => !blade.flipped));
  assert.ok(blades.every((blade) => blade.scale.every((component) => component === 1)));
  assert.ok(blades.every((blade) => [...blade.position, blade.rotation.x, blade.rotation.y, blade.rotation.z, blade.rotation.w].every(Number.isFinite)));

  const knownBlade = blades.find((blade) => blade.guid === "c62f2806-f298-46fc-88c3-7b8da325b1ea");
  assert.ok(knownBlade);
  assert.equal(knownBlade.id, 55);
  assert.equal(knownBlade.kind, "SmallPropeller");
  assert.equal(knownBlade.flipped, true);
  assert.deepEqual(knownBlade.position, [1.358338e-14, -2.07258, -2.870709]);
  assert.deepEqual(knownBlade.rotation, { x: 0.4122809, y: -0.6112328, z: -0.5600881, w: -0.3777834 });
  assert.deepEqual(knownBlade.scale, [1, 1, 1]);
});
