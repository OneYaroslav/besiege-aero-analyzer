export const VISUAL_MESH_CACHE_SCHEMA_VERSION = 2;
export const VISUAL_MESH_CACHE_GAME_VERSION = "1.90-25346";
export const VISUAL_MESH_CACHE_FORMAT = "glb-geometry-only";
export const VISUAL_MESH_CACHE_GLB_FILE = "vanilla-blocks.glb";

export interface VisualMeshNodeRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * Quaternion equivalent of the installed Besiege 1.90-25346
 * PropellorController.CheckFlipDirection assignment:
 *   normal  -> Vis.localEulerAngles = (0, -180, -23)
 *   flipped -> Vis.localEulerAngles = (0, -180, +23)
 *
 * The signs below are verified against the prefab's serialized normal-state
 * quaternion. q and -q describe the same rotation. This is visual state only.
 */
export function besiegeBladeVisualLocalRotation(blockId: number, flipped: boolean): VisualMeshNodeRotation | undefined {
  if (blockId !== 26 && blockId !== 55) return undefined;
  const halfAngle = 23 * Math.PI / 360;
  return {
    x: (flipped ? 1 : -1) * Math.sin(halfAngle),
    y: Math.cos(halfAngle),
    z: 0,
    w: 0,
  };
}

export interface VisualMeshCacheBlock {
  readonly id: number;
  readonly type: string;
  readonly nodeName: string;
  readonly policy: "static-prefab" | "shortening-prefab";
  readonly rendererCount: number;
  readonly rendererPaths: readonly string[];
  readonly note: string;
  readonly variants?: Readonly<Record<"full" | "short", VisualMeshCacheVariant>>;
}

export interface VisualMeshCacheVariant {
  readonly nodeName: string;
  readonly length: number;
  readonly rendererCount: number;
  readonly rendererPaths: readonly string[];
}

export interface VisualMeshCacheExcludedBlock {
  readonly id: number;
  readonly type: string;
  readonly policy: "procedural" | "schematic-fallback";
  readonly reason: string;
}

export interface VisualMeshCacheSource {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface VisualMeshCacheManifest {
  readonly schemaVersion: number;
  readonly gameVersion: string;
  readonly unityVersion: string;
  readonly cacheFormat: string;
  readonly glbFile: string;
  readonly meshDataExtracted: true;
  readonly texturesExtracted: false;
  readonly materialsExtracted: false;
  readonly collidersExtracted: false;
  readonly blockCount: number;
  readonly excludedCount: number;
  readonly uniqueMeshCount: number;
  readonly glbByteLength: number;
  readonly blocks: readonly VisualMeshCacheBlock[];
  readonly excludedBlocks: readonly VisualMeshCacheExcludedBlock[];
  readonly sources: readonly VisualMeshCacheSource[];
  readonly coordinateConvention: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

export function parseVisualMeshCacheManifest(text: string): VisualMeshCacheManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Visual mesh cache manifest is malformed JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!isRecord(value)) throw new Error("Visual mesh cache manifest must be an object");
  if (value.schemaVersion !== VISUAL_MESH_CACHE_SCHEMA_VERSION) throw new Error(`Unsupported visual mesh cache schema: ${String(value.schemaVersion)}`);
  if (value.gameVersion !== VISUAL_MESH_CACHE_GAME_VERSION) throw new Error(`Visual mesh cache targets ${String(value.gameVersion)}, expected ${VISUAL_MESH_CACHE_GAME_VERSION}`);
  if (value.cacheFormat !== VISUAL_MESH_CACHE_FORMAT || value.glbFile !== VISUAL_MESH_CACHE_GLB_FILE) throw new Error("Unsupported visual mesh cache format or GLB filename");
  if (value.meshDataExtracted !== true || value.texturesExtracted !== false || value.materialsExtracted !== false || value.collidersExtracted !== false) {
    throw new Error("Visual mesh cache must contain geometry only (no textures, materials or colliders)");
  }
  if (!Array.isArray(value.blocks) || !Array.isArray(value.excludedBlocks)) throw new Error("Visual mesh cache block lists are missing");

  const ids = new Set<number>();
  const blocks = value.blocks.map((entry, index): VisualMeshCacheBlock => {
    if (!isRecord(entry)) throw new Error(`blocks[${index}] must be an object`);
    const id = finiteInteger(entry.id, `blocks[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate visual mesh cache block ID ${id}`);
    ids.add(id);
    if (entry.policy !== "static-prefab" && entry.policy !== "shortening-prefab") throw new Error(`blocks[${index}] has unsupported policy`);
    if (!Array.isArray(entry.rendererPaths) || entry.rendererPaths.some((path) => typeof path !== "string")) throw new Error(`blocks[${index}].rendererPaths must be strings`);
    let variants: VisualMeshCacheBlock["variants"];
    if (entry.policy === "shortening-prefab") {
      if (!isRecord(entry.variants)) throw new Error(`blocks[${index}].variants must be an object`);
      const parsedVariants = {} as Record<"full" | "short", VisualMeshCacheVariant>;
      for (const name of ["full", "short"] as const) {
        const variant = entry.variants[name];
        if (!isRecord(variant)) throw new Error(`blocks[${index}].variants.${name} must be an object`);
        if (!Array.isArray(variant.rendererPaths) || variant.rendererPaths.some((path) => typeof path !== "string")) throw new Error(`blocks[${index}].variants.${name}.rendererPaths must be strings`);
        parsedVariants[name] = {
          nodeName: stringValue(variant.nodeName, `blocks[${index}].variants.${name}.nodeName`),
          length: finiteInteger(variant.length, `blocks[${index}].variants.${name}.length`),
          rendererCount: finiteInteger(variant.rendererCount, `blocks[${index}].variants.${name}.rendererCount`),
          rendererPaths: variant.rendererPaths,
        };
      }
      if (parsedVariants.full.length === parsedVariants.short.length) throw new Error(`blocks[${index}] shortening variant lengths must differ`);
      variants = parsedVariants;
    }
    return {
      id,
      type: stringValue(entry.type, `blocks[${index}].type`),
      nodeName: stringValue(entry.nodeName, `blocks[${index}].nodeName`),
      policy: entry.policy,
      rendererCount: finiteInteger(entry.rendererCount, `blocks[${index}].rendererCount`),
      rendererPaths: entry.rendererPaths,
      note: stringValue(entry.note ?? "", `blocks[${index}].note`),
      variants,
    };
  });
  const excludedBlocks = value.excludedBlocks.map((entry, index): VisualMeshCacheExcludedBlock => {
    if (!isRecord(entry)) throw new Error(`excludedBlocks[${index}] must be an object`);
    const id = finiteInteger(entry.id, `excludedBlocks[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate visual mesh cache block ID ${id}`);
    ids.add(id);
    if (entry.policy !== "procedural" && entry.policy !== "schematic-fallback") throw new Error(`excludedBlocks[${index}] has unsupported policy`);
    return {
      id,
      type: stringValue(entry.type, `excludedBlocks[${index}].type`),
      policy: entry.policy,
      reason: stringValue(entry.reason, `excludedBlocks[${index}].reason`),
    };
  });
  const blockCount = finiteInteger(value.blockCount, "blockCount");
  const excludedCount = finiteInteger(value.excludedCount, "excludedCount");
  if (blockCount !== blocks.length || excludedCount !== excludedBlocks.length) throw new Error("Visual mesh cache block counts do not match its lists");
  if (ids.size !== 103) throw new Error(`Visual mesh cache policy must cover 103 vanilla IDs, found ${ids.size}`);
  if (!Array.isArray(value.sources)) throw new Error("Visual mesh cache source fingerprints are missing");
  const sources = value.sources.map((entry, index): VisualMeshCacheSource => {
    if (!isRecord(entry)) throw new Error(`sources[${index}] must be an object`);
    const sha256 = stringValue(entry.sha256, `sources[${index}].sha256`);
    if (!/^[0-9A-F]{64}$/.test(sha256)) throw new Error(`sources[${index}].sha256 must be an uppercase SHA-256`);
    return {
      path: stringValue(entry.path, `sources[${index}].path`),
      size: finiteInteger(entry.size, `sources[${index}].size`),
      sha256,
    };
  });
  const sourceNames = new Set(sources.map((source) => source.path));
  for (const required of ["Assembly-CSharp.dll", "level0", "sharedassets0.assets", "sharedassets0.assets.resS"]) {
    if (!sourceNames.has(required)) throw new Error(`Visual mesh cache source fingerprint is missing ${required}`);
  }

  return {
    schemaVersion: VISUAL_MESH_CACHE_SCHEMA_VERSION,
    gameVersion: VISUAL_MESH_CACHE_GAME_VERSION,
    unityVersion: stringValue(value.unityVersion, "unityVersion"),
    cacheFormat: VISUAL_MESH_CACHE_FORMAT,
    glbFile: VISUAL_MESH_CACHE_GLB_FILE,
    meshDataExtracted: true,
    texturesExtracted: false,
    materialsExtracted: false,
    collidersExtracted: false,
    blockCount,
    excludedCount,
    uniqueMeshCount: finiteInteger(value.uniqueMeshCount, "uniqueMeshCount"),
    glbByteLength: finiteInteger(value.glbByteLength, "glbByteLength"),
    blocks,
    excludedBlocks,
    sources,
    coordinateConvention: isRecord(value.coordinateConvention)
      ? Object.fromEntries(Object.entries(value.coordinateConvention).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {},
  };
}

export function visualMeshCacheBlockIds(manifest: VisualMeshCacheManifest): ReadonlySet<number> {
  return new Set(manifest.blocks.map((block) => block.id));
}
