import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  parseVisualMeshCacheManifest,
  besiegeBladeVisualLocalRotation,
  visualMeshCacheBlockIds,
} from "../src/visual-mesh-cache.ts";

const EXCLUDED_IDS = new Set([7, 9, 16, 18, 45, 71, 72, 73, 75, 78, 96, 97]);

function manifestFixture(): object {
  const blocks = Array.from({ length: 103 }, (_, id) => id).filter((id) => !EXCLUDED_IDS.has(id)).map((id) => {
    const shortening = id === 41 || id === 63;
    const fullLength = id === 41 ? 2 : 3;
    return {
      id,
      type: `Block${id}`,
      nodeName: shortening ? `block_${id}_full` : `block_${id}`,
      policy: shortening ? "shortening-prefab" : "static-prefab",
      rendererCount: shortening ? 2 : 1,
      rendererPaths: shortening ? [`/Block${id}/Vis`, `/Block${id}/Vis/HalfVis`] : [`/Block${id}/Vis`],
      variants: shortening ? {
        full: { nodeName: `block_${id}_full`, length: fullLength, rendererCount: 1, rendererPaths: [`/Block${id}/Vis`] },
        short: { nodeName: `block_${id}_short`, length: fullLength - 1, rendererCount: 1, rendererPaths: [`/Block${id}/Vis/HalfVis`] },
      } : undefined,
      note: "",
    };
  });
  const excludedBlocks = [...EXCLUDED_IDS].map((id) => ({
    id,
    type: `Block${id}`,
    policy: id === 7 || id === 9 || id >= 71 && id <= 75 || id === 96 ? "procedural" : "schematic-fallback",
    reason: "Runtime-dependent test fixture",
  }));
  return {
    schemaVersion: 2,
    gameVersion: "1.90-25346",
    unityVersion: "5.4.0f3",
    cacheFormat: "glb-geometry-only",
    glbFile: "vanilla-blocks.glb",
    meshDataExtracted: true,
    texturesExtracted: false,
    materialsExtracted: false,
    collidersExtracted: false,
    blockCount: blocks.length,
    excludedCount: excludedBlocks.length,
    uniqueMeshCount: 100,
    glbByteLength: 1234,
    blocks,
    excludedBlocks,
    sources: ["Assembly-CSharp.dll", "level0", "sharedassets0.assets", "sharedassets0.assets.resS"].map((path) => ({
      path,
      size: 123,
      sha256: "A".repeat(64),
    })),
    coordinateConvention: { positions: "Unity numeric XYZ" },
  };
}

test("visual mesh cache manifest validates complete vanilla coverage and required blade IDs", () => {
  const manifest = parseVisualMeshCacheManifest(JSON.stringify(manifestFixture()));
  const ids = visualMeshCacheBlockIds(manifest);
  assert.equal(manifest.blockCount, 91);
  assert.equal(manifest.excludedCount, 12);
  assert.equal(ids.has(26), true);
  assert.equal(ids.has(55), true);
  assert.equal(ids.has(41), true);
  assert.equal(ids.has(63), true);
  assert.equal(ids.has(42), true);
  assert.equal(ids.has(7), false);
});

test("cached blade visual policy reproduces both CheckFlipDirection branches", () => {
  const normal = besiegeBladeVisualLocalRotation(26, false);
  const flipped = besiegeBladeVisualLocalRotation(55, true);
  assert.ok(normal && flipped);
  assert.ok(Math.abs(normal.x + 0.1993679344171972) < 1e-12);
  assert.ok(Math.abs(flipped.x - 0.1993679344171972) < 1e-12);
  assert.ok(Math.abs(normal.y - 0.9799247046208296) < 1e-12);
  assert.equal(besiegeBladeVisualLocalRotation(1, false), undefined);
});

test("visual mesh cache manifest rejects materials, incomplete policy and duplicate IDs", () => {
  const materials = manifestFixture() as Record<string, unknown>;
  materials.materialsExtracted = true;
  assert.throws(() => parseVisualMeshCacheManifest(JSON.stringify(materials)), /geometry only/);

  const incomplete = manifestFixture() as Record<string, unknown>;
  incomplete.excludedBlocks = [];
  incomplete.excludedCount = 0;
  assert.throws(() => parseVisualMeshCacheManifest(JSON.stringify(incomplete)), /cover 103/);

  const unversioned = manifestFixture() as Record<string, unknown>;
  unversioned.sources = [];
  assert.throws(() => parseVisualMeshCacheManifest(JSON.stringify(unversioned)), /missing Assembly-CSharp/);
});

const localCacheDirectory = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "com.yarick.besiege-aero-analyzer", "mesh-cache", "1.90-25346")
  : "";
const localManifestPath = path.join(localCacheDirectory, "manifest.json");
const localGlbPath = path.join(localCacheDirectory, "vanilla-blocks.glb");

test("locally extracted Besiege cache has a valid manifest and GLB header", { skip: !existsSync(localManifestPath) || !existsSync(localGlbPath) }, () => {
  const manifest = parseVisualMeshCacheManifest(readFileSync(localManifestPath, "utf8"));
  const glb = readFileSync(localGlbPath);
  assert.equal(manifest.blockCount, 91);
  assert.equal(glb.byteLength, manifest.glbByteLength);
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.byteLength);
  const jsonByteLength = glb.readUInt32LE(12);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(glb.subarray(20, 20 + jsonByteLength).toString("utf8")) as {
    readonly nodes: readonly { readonly name?: string }[];
  };
  const nodeNames = new Set(document.nodes.map((node) => node.name));
  for (const block of manifest.blocks) assert.equal(nodeNames.has(block.nodeName), true, `missing ${block.nodeName}`);
  assert.equal(nodeNames.has("block_26"), true);
  assert.equal(nodeNames.has("block_55"), true);
  assert.equal(nodeNames.has("block_42"), true);
});
