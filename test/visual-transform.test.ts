import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { extractVanillaBlades } from "../src/bsg.ts";
import { loadBsg } from "../src/bsg-node.ts";
import { besiegeBladeVisualLocalRotation } from "../src/visual-mesh-cache.ts";
import { composeBesiegeVisualMatrix, transformVisualPoint, visualTrsMatrix } from "../src/visual-transform.ts";

const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("Eskapie blade e407 uses Machine * BSG block * flipped Vis matrix order", () => {
  const childRotation = besiegeBladeVisualLocalRotation(26, true);
  assert.ok(childRotation);
  const matrix = composeBesiegeVisualMatrix(
    {
      position: [0, 5.257363, 4.504908e-7],
      rotation: { x: 2.392272e-15, y: 0, z: 3.579676e-15, w: 1 },
      scale: [1, 1, 1],
    },
    {
      position: [0.5262694, -2.129524, -1.342212],
      rotation: { x: 4.275575e-8, y: 2.33539e-7, z: -0.2840154, w: 0.9588197 },
      scale: [1, 1, 1],
    },
    {
      position: [0, 0, 0],
      rotation: childRotation,
      scale: [0.6941729187965393, 0.7613170146942139, 0.4499472677707672],
    },
  );
  const expected = [
    -0.38817649754980854, 0.5754954803822419, 2.879435283359721e-7, 0,
    0.6311604633816532, 0.4257229924807159, -1.7595208251816636e-7, 0,
    -1.9057832388359304e-7, 9.658004183815202e-8, -0.44994726777071653, 0,
    0.5262694000000152, 3.1278390000000096, -1.3422115495092102, 1,
  ];
  matrix.forEach((value, index) => close(value, expected[index]));
});

test("visual TRS keeps negative scale and transforms child position in parent order", () => {
  const parent = visualTrsMatrix({
    position: [0, 0, 0],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: [-2, 3, 4],
  });
  assert.deepEqual(transformVisualPoint(parent, [1, 1, 1]), [-2, 3, 4]);
  close(parent[0] * parent[5] * parent[10], -24);
});

const REAL_FIXTURES = [
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Проект Ескапе.bsg",
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Поцыки\\Saab JAS 39 Gripen2.bsg",
] as const;

for (const fixture of REAL_FIXTURES) {
  test(`real blades produce finite game-ordered visual matrices for both flipped states: ${fixture.split("\\").at(-1)}`, { skip: !existsSync(fixture) }, () => {
    const machine = loadBsg(fixture);
    const blades = extractVanillaBlades(machine);
    assert.ok(blades.some((blade) => blade.flipped));
    assert.ok(blades.some((blade) => !blade.flipped));
    for (const blade of blades) {
      const rotation = besiegeBladeVisualLocalRotation(blade.id, blade.flipped);
      assert.ok(rotation);
      const child = blade.id === 26
        ? { position: [0, 0, 0] as const, scale: [0.6941729187965393, 0.7613170146942139, 0.4499472677707672] as const }
        : { position: [2.738540842983639e-6, 1.1444091796875e-5, 0.014397801831364632] as const, scale: [0.6425632238388062, 0.7047152519226074, 0.34525066614151] as const };
      const matrix = composeBesiegeVisualMatrix(
        { position: machine.globalPosition, rotation: machine.globalRotation, scale: [1, 1, 1] },
        { position: blade.position, rotation: blade.rotation, scale: blade.scale },
        { position: child.position, rotation, scale: child.scale },
      );
      assert.ok(matrix.every(Number.isFinite), blade.guid);
      const determinant3 =
        matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
        - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
        + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);
      assert.ok(Math.abs(determinant3) > 1e-8, `${blade.guid} has a singular visual transform`);
    }
  });
}
