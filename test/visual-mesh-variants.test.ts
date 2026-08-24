import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import type { BsgBlock } from "../src/bsg.ts";
import type { VisualMeshLibrary } from "../ui/visual-mesh-cache.ts";
import { visualTemplateForBlock } from "../ui/visual-mesh-cache.ts";

function block(id: number, length?: number): BsgBlock {
  return {
    id,
    guid: `${id}`,
    position: [0, 0, 0],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: [1, 1, 1],
    booleans: new Map(),
    singles: new Map(),
    integers: length === undefined ? new Map() : new Map([["length", length]]),
    strings: new Map(),
    vectors: new Map(),
  };
}

test("ShorteningBlock templates select exact full/short meshes from serialized length", () => {
  const poleFull = new THREE.Group();
  const poleShort = new THREE.Group();
  const logFull = new THREE.Group();
  const logShort = new THREE.Group();
  const staticBlock = new THREE.Group();
  const library = {
    available: true,
    manifest: {} as VisualMeshLibrary["manifest"],
    templates: new Map([[1, staticBlock], [41, poleFull], [63, logFull]]),
    shorteningTemplates: new Map([
      [41, { full: poleFull, short: poleShort, fullLength: 2, shortLength: 1 }],
      [63, { full: logFull, short: logShort, fullLength: 3, shortLength: 2 }],
    ]),
  } satisfies VisualMeshLibrary;
  assert.equal(visualTemplateForBlock(library, block(41, 1)), poleShort);
  assert.equal(visualTemplateForBlock(library, block(41, 2)), poleFull);
  assert.equal(visualTemplateForBlock(library, block(63, 2)), logShort);
  assert.equal(visualTemplateForBlock(library, block(63, 3)), logFull);
  assert.equal(visualTemplateForBlock(library, block(63)), logFull);
  assert.equal(visualTemplateForBlock(library, block(1)), staticBlock);
});
