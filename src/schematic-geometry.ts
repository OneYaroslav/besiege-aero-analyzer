import visualBoundsJson from "../data/besiege-1.90-25346-visual-bounds.json" with { type: "json" };
import type { BsgBlock, VanillaBlade } from "./bsg.ts";
import { massDatabaseEntry } from "./mass.ts";
import { add, rotateVector, type Quaternion, type Vec3 } from "./math.ts";
import { reconstructBuildSurfaceGeometry } from "./build-surface-geometry.ts";

export type SchematicPrimitiveKind = "box" | "cylinder" | "sphere" | "cone";

export interface SchematicPrimitiveProfile {
  readonly kind: SchematicPrimitiveKind;
  /** Scale applied to a centered unit primitive before local rotation. */
  readonly size: Vec3;
  /** Offset from the parsed BSG block root, in block-local coordinates. */
  readonly offset: Vec3;
  /** Additional schematic rotation only; never the aerodynamic sense rotation. */
  readonly localRotation: Quaternion;
  readonly color: number;
  readonly category: "wood" | "surface" | "round" | "mechanism" | "weapon" | "fallback";
  readonly type: string;
}

export interface SchematicSegment {
  readonly kind: "segment";
  /** Source block ID keeps procedural policy explicit at the render boundary. */
  readonly blockId: number;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly diameter: number;
  readonly crossSection: "round" | "square";
  readonly color: number;
  readonly source: "serialized-endpoints" | "explicit-build-link";
  /** Visual-only attachment plates used by Besiege's regular Brace renderer. */
  readonly endpointMarkers?: {
    readonly size: number;
    readonly thickness: number;
    readonly color: number;
  };
}

export interface SchematicSurface {
  readonly kind: "surface";
  readonly vertices: readonly Vec3[];
  readonly triangleIndices: readonly number[];
  readonly boundaryVertices: readonly Vec3[];
  readonly color: number;
  readonly opacity: number;
  readonly source: "explicit-build-links";
}

export type ResolvedSchematicBlock =
  | { readonly kind: "primitive"; readonly block: BsgBlock; readonly profile: SchematicPrimitiveProfile }
  | SchematicSegment
  | SchematicSurface;

export interface SchematicBladeProfile {
  readonly length: number;
  readonly rootWidth: number;
  readonly tipWidth: number;
  readonly thickness: number;
  readonly offset: Vec3;
  /** Base plate rotation; the renderer applies Besiege's separate visual-only flipped twist. */
  readonly localRotation: Quaternion;
  readonly dimensionsAreSchematic: true;
}

const IDENTITY_ROTATION: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const ROTATE_Y_TO_Z: Quaternion = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

/** Renderer bounds are already in verified block-root-local game units. */
export const SCHEMATIC_BLOCK_GLYPH_SCALE = 1;

interface VisualBoundsEntry {
  readonly id: number;
  readonly rootLocalRendererBounds: { readonly center: Vec3; readonly size: Vec3 } | null;
}

const VISUAL_BOUNDS_BY_ID = new Map(
  (visualBoundsJson.blocks as unknown as readonly VisualBoundsEntry[]).map((entry) => [entry.id, entry.rootLocalRendererBounds]),
);

const WOOD = 0x856446;
const SURFACE = 0x667988;
const ROUND = 0x566674;
const MECHANISM = 0x425a6c;
const WEAPON = 0x6c6259;
const FALLBACK = 0x4d5a66;

// Installed Besiege 1.90-25346 Log/Vis and Log/Vis/HalfVis renderer AABBs,
// transformed to block-root-local coordinates. ShorteningBlock switches
// between exactly these two visual variants for serialized length 3/2.
const LOG_FULL_BOUNDS = {
  center: [0.022614508867263794, -0.002088725566863847, 1.477103769779205] as Vec3,
  size: [1.2122759819030762, 1.080829501152039, 3.3326606750488277] as Vec3,
};
const LOG_SHORT_BOUNDS = {
  center: [0.022614508867263794, -0.002088725566863958, 0.9755342602729797] as Vec3,
  size: [1.2122759819030762, 1.080829501152039, 2.329521656036377] as Vec3,
};

const SURFACE_IDS = new Set([3, 10, 24, 25, 29, 32, 33, 34, 37, 49, 73, 77, 78, 79, 81, 87, 89, 94, 95]);
const ROUND_IDS = new Set([2, 6, 17, 19, 22, 23, 29, 31, 36, 38, 39, 40, 43, 44, 46, 50, 51, 54, 60, 62, 64, 74, 80, 82, 83, 86, 88, 92, 98, 99, 100]);
const WEAPON_IDS = new Set([11, 20, 21, 30, 47, 48, 53, 56, 59, 61, 84, 90, 91, 97, 102]);

function profile(
  block: BsgBlock,
  kind: SchematicPrimitiveKind,
  size: Vec3,
  offset: Vec3,
  category: SchematicPrimitiveProfile["category"],
  color: number,
  localRotation: Quaternion = IDENTITY_ROTATION,
): SchematicPrimitiveProfile {
  return { kind, size, offset, category, color, localRotation, type: massDatabaseEntry(block.id)?.type ?? `Unknown(${block.id})` };
}

function shorteningLength(block: BsgBlock, fallback: number): number {
  const serialized = block.integers.get("length");
  return serialized === undefined || !Number.isFinite(serialized)
    ? fallback
    : Math.max(0.5, serialized);
}

/**
 * Type-driven engineering placeholder. Dimensions describe the prefab family,
 * then the parsed BSG Scale is applied by the renderer. They are not exact
 * Besiege meshes or collider dimensions.
 */
function fallbackSchematicBlockProfile(block: BsgBlock): SchematicPrimitiveProfile {
  switch (block.id) {
    case 0: return profile(block, "box", [0.8, 0.8, 0.8], [0, 0, 0.4], "wood", WOOD);
    case 1: return profile(block, "box", [0.45, 0.45, 2], [0, 0, 1], "wood", WOOD);
    case 15: return profile(block, "box", [0.45, 0.45, 1], [0, 0, 0.5], "wood", WOOD);
    case 41: {
      const length = shorteningLength(block, 2);
      return profile(block, "box", [0.34, 0.34, length], [0, 0, length / 2], "wood", WOOD);
    }
    case 63: {
      const length = shorteningLength(block, 3);
      // Russian localisation names Log Block "БРУС". The actual irregular log
      // mesh remains runtime-selected and is not cached as a static prefab; its
      // fallback box uses the exact official renderer bounds for the active
      // full/short visual instead of the nominal mapper length.
      const officialBounds = length === 2 ? LOG_SHORT_BOUNDS : LOG_FULL_BOUNDS;
      return profile(block, "box", officialBounds.size, officialBounds.center, "wood", WOOD);
    }
    // BuildSurface endpoints are presented as square black brace caps in the
    // Inspector. Their measured prefab bounds are retained below, but the
    // original oval prefab mesh is deliberately not used by the renderer.
    case 71: return profile(block, "box", [0.285051, 0.285051, 0.285051], [0, 0, 0], "mechanism", 0x090b0d);
    case 10: return profile(block, "box", [1.1, 0.1, 1.1], [0, 0, 0.55], "surface", SURFACE);
    case 24: return profile(block, "box", [0.85, 0.09, 1.05], [0, 0, 0.525], "surface", SURFACE);
    case 25: return profile(block, "box", [1.2, 0.09, 2.2], [0, 0, 1.1], "surface", 0x718b9a);
    case 29: return profile(block, "cylinder", [1.15, 0.1, 1.15], [0, 0, 0], "surface", SURFACE);
    case 32: return profile(block, "box", [1.45, 0.1, 2.05], [0, 0, 1.025], "surface", SURFACE);
    case 34: return profile(block, "box", [1.9, 0.09, 2.5], [0, 0, 1.25], "surface", 0x718b9a);
    case 73: return profile(block, "box", [1.2, 0.08, 1.2], [0, 0, 0], "surface", SURFACE);
    case 78: return profile(block, "box", [1.6, 0.06, 2.1], [0, 0, 1.05], "surface", 0x718b9a);
    case 79: return profile(block, "box", [0.9, 0.08, 1.8], [0, 0, 0.9], "surface", 0x718b9a);
    case 94:
    case 95: return profile(block, "box", [0.75, 0.08, 1.25], [0, 0, 0.625], "surface", 0x718b9a);
    case 2:
    case 38:
    case 39:
    case 40:
    case 46:
    case 50:
    case 51:
    case 60:
    case 86:
    case 88:
    case 100: {
      const diameter = block.id === 46 || block.id === 60 ? 1.6 : block.id === 50 || block.id === 86 ? 0.62 : 1.05;
      return profile(block, "cylinder", [diameter, 0.28, diameter], [0, 0, 0], "round", ROUND, ROTATE_Y_TO_Z);
    }
    case 6:
    case 23:
    case 31:
    case 36:
    case 43:
    case 44:
    case 54:
    case 64:
    case 74:
    case 82: return profile(block, "sphere", [0.8, 0.8, 0.8], [0, 0, 0], "round", ROUND);
    case 18:
    case 42:
    case 57:
    case 76:
    case 96: return profile(block, "cylinder", [0.38, 1.5, 0.38], [0, 0, 0.75], "mechanism", MECHANISM, ROTATE_Y_TO_Z);
    case 20:
    case 48:
    case 59:
    case 84:
    case 90:
    case 91:
    case 97: return profile(block, "cone", [0.7, 1.7, 0.7], [0, 0, 0.85], "weapon", WEAPON, ROTATE_Y_TO_Z);
    default: {
      if (SURFACE_IDS.has(block.id)) return profile(block, "box", [1, 0.1, 1.35], [0, 0, 0.675], "surface", SURFACE);
      if (ROUND_IDS.has(block.id)) return profile(block, "cylinder", [0.8, 0.6, 0.8], [0, 0, 0], "round", ROUND, ROTATE_Y_TO_Z);
      if (WEAPON_IDS.has(block.id)) return profile(block, "box", [0.65, 0.65, 1.4], [0, 0, 0.7], "weapon", WEAPON);
      return profile(block, "box", [0.68, 0.68, 0.82], [0, 0, 0.35], "fallback", FALLBACK);
    }
  }
}

/**
 * Keeps the type-driven primitive kind/color, but uses renderer AABB dimensions
 * measured from the installed vanilla prefab instead of guessed offsets/sizes.
 */
export function schematicBlockProfile(block: BsgBlock): SchematicPrimitiveProfile {
  const fallback = fallbackSchematicBlockProfile(block);
  // ShorteningBlock prefabs contain multiple mutually exclusive visual variants
  // (for WoodenPole both HalfVis and Vis). Their combined prefab renderer AABB is
  // not a valid loaded-machine shape; use the serialized length and a compact
  // vanilla-sized schematic section instead.
  if (block.id === 41 || block.id === 63 || block.id === 71) return fallback;
  const bounds = VISUAL_BOUNDS_BY_ID.get(block.id);
  if (!bounds || bounds.size.some((value) => !Number.isFinite(value) || value <= 1e-5)) return fallback;
  const size = fallback.kind === "cylinder" || fallback.kind === "cone"
    ? [bounds.size[0], bounds.size[2], bounds.size[1]] as Vec3
    : bounds.size;
  return { ...fallback, size, offset: bounds.center };
}

export function schematicBladeProfile(blade: Pick<VanillaBlade, "id">): SchematicBladeProfile {
  const large = blade.id === 26;
  const bounds = VISUAL_BOUNDS_BY_ID.get(blade.id);
  const length = bounds?.size[2] ?? (large ? 3.05 : 1.95);
  const rootWidth = bounds?.size[0] ?? (large ? 0.78 : 0.54);
  return {
    length,
    rootWidth,
    tipWidth: rootWidth * 0.44,
    thickness: large ? 0.055 : 0.04,
    offset: [0, 0, length / 2],
    localRotation: IDENTITY_ROTATION,
    dimensionsAreSchematic: true,
  };
}

export function transformBlockLocalPoint(block: BsgBlock, point: Vec3): Vec3 {
  const scaled: Vec3 = [point[0] * block.scale[0], point[1] * block.scale[1], point[2] * block.scale[2]];
  return add(block.position, rotateVector(block.rotation, scaled));
}

function serializedSegment(block: BsgBlock): SchematicSegment | undefined {
  const start = block.vectors.get("start-position");
  const end = block.vectors.get("end-position");
  if (!start || !end) return undefined;
  return {
    kind: "segment",
    blockId: block.id,
    start: transformBlockLocalPoint(block, start),
    end: transformBlockLocalPoint(block, end),
    diameter: block.id === 7 ? 0.15 : 0.1,
    crossSection: block.id === 7 ? "square" : "round",
    color: block.id === 7 ? 0x81909b : 0x667684,
    source: "serialized-endpoints",
    ...(block.id === 7
      ? { endpointMarkers: { size: 0.285051, thickness: 0.285051, color: 0x090b0d } }
      : {}),
  };
}

function explicitBuildEdge(block: BsgBlock, blocksByGuid: ReadonlyMap<string, BsgBlock>): SchematicSegment | undefined {
  const start = block.strings.get("start");
  const end = block.strings.get("end");
  if (!start || !end) return undefined;
  const startBlock = blocksByGuid.get(start);
  const endBlock = blocksByGuid.get(end);
  if (!startBlock || !endBlock) return undefined;
  return {
    kind: "segment",
    blockId: block.id,
    start: startBlock.position,
    end: endBlock.position,
    diameter: 0.09,
    crossSection: "round",
    color: 0x718a98,
    source: "explicit-build-link",
  };
}

function orderedSurfaceNodeGuids(surface: BsgBlock, blocksByGuid: ReadonlyMap<string, BsgBlock>): string[] {
  const edgeGuids = surface.strings.get("edges")?.split("|").filter(Boolean) ?? [];
  const endpoints = edgeGuids.flatMap((guid) => {
    const edge = blocksByGuid.get(guid);
    const start = edge?.strings.get("start");
    const end = edge?.strings.get("end");
    return start && end && blocksByGuid.has(start) && blocksByGuid.has(end) ? [[start, end] as const] : [];
  });
  if (endpoints.length < 3) return [];

  const adjacency = new Map<string, string[]>();
  for (const [start, end] of endpoints) {
    adjacency.set(start, [...(adjacency.get(start) ?? []), end]);
    adjacency.set(end, [...(adjacency.get(end) ?? []), start]);
  }
  const first = endpoints[0][0];
  const ordered = [first];
  let previous: string | undefined;
  let current = first;
  for (let index = 0; index < adjacency.size + 1; index += 1) {
    const next = (adjacency.get(current) ?? []).find((candidate) => candidate !== previous);
    if (!next || next === first) break;
    if (ordered.includes(next)) break;
    ordered.push(next);
    previous = current;
    current = next;
  }
  return ordered.length >= 3 ? ordered : [];
}

export function resolveBuildSurfaceVertices(surface: BsgBlock, blocksByGuid: ReadonlyMap<string, BsgBlock>): readonly Vec3[] {
  return orderedSurfaceNodeGuids(surface, blocksByGuid).map((guid) => blocksByGuid.get(guid)!.position);
}

export function resolveSchematicBlock(block: BsgBlock, blocksByGuid: ReadonlyMap<string, BsgBlock>): ResolvedSchematicBlock {
  const endpoint = serializedSegment(block);
  if (endpoint) return endpoint;
  if (block.id === 72) {
    const edge = explicitBuildEdge(block, blocksByGuid);
    if (edge) return edge;
  }
  if (block.id === 73) {
    const geometry = reconstructBuildSurfaceGeometry(block, blocksByGuid);
    if (geometry) {
      return {
        kind: "surface",
        vertices: geometry.vertices.map((vertex) => vertex.machinePosition),
        triangleIndices: geometry.triangleIndices,
        boundaryVertices: geometry.boundaryMachinePositions,
        color: 0x607d8b,
        opacity: 0.46,
        source: "explicit-build-links",
      };
    }
    const vertices = resolveBuildSurfaceVertices(block, blocksByGuid);
    if (vertices.length >= 3) {
      const triangleIndices: number[] = [];
      for (let index = 1; index < vertices.length - 1; index += 1) triangleIndices.push(0, index, index + 1);
      return {
        kind: "surface",
        vertices,
        triangleIndices,
        boundaryVertices: vertices,
        color: 0x607d8b,
        opacity: 0.46,
        source: "explicit-build-links",
      };
    }
  }
  return { kind: "primitive", block, profile: schematicBlockProfile(block) };
}

export function collectSchematicBoundsPoints(blocks: readonly BsgBlock[], blades: readonly VanillaBlade[] = []): Vec3[] {
  const byGuid = new Map(blocks.map((block) => [block.guid, block]));
  const points: Vec3[] = [];
  for (const block of blocks) {
    const resolved = resolveSchematicBlock(block, byGuid);
    if (resolved.kind === "segment") {
      points.push(resolved.start, resolved.end);
    } else if (resolved.kind === "surface") {
      points.push(...resolved.vertices);
    } else {
      const { offset, size, localRotation } = resolved.profile;
      const displayOffset: Vec3 = [
        offset[0] * SCHEMATIC_BLOCK_GLYPH_SCALE,
        offset[1] * SCHEMATIC_BLOCK_GLYPH_SCALE,
        offset[2] * SCHEMATIC_BLOCK_GLYPH_SCALE,
      ];
      const displaySize: Vec3 = [
        size[0] * SCHEMATIC_BLOCK_GLYPH_SCALE,
        size[1] * SCHEMATIC_BLOCK_GLYPH_SCALE,
        size[2] * SCHEMATIC_BLOCK_GLYPH_SCALE,
      ];
      for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
        const corner = rotateVector(localRotation, [displaySize[0] * x, displaySize[1] * y, displaySize[2] * z]);
        points.push(transformBlockLocalPoint(block, add(displayOffset, corner)));
      }
    }
  }
  for (const blade of blades) {
    const bladeProfile = schematicBladeProfile(blade);
    points.push(blade.position, transformBlockLocalPoint(blade, [0, 0, bladeProfile.length]));
  }
  return points;
}
