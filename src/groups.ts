import type { BsgBlock, BsgMachine, VanillaBlade } from "./bsg.ts";
import { add, magnitude, scale, subtract, type Vec3 } from "./math.ts";

export interface HeuristicComponent {
  readonly index: number;
  readonly blocks: readonly BsgBlock[];
  readonly bladeCount: number;
  readonly centroid: Vec3;
  readonly distanceToBladeCentroid: number;
}

export interface ComponentSuggestion {
  readonly method: "spatial-proximity-plus-explicit-build-links";
  readonly threshold: number;
  readonly bladeCentroid: Vec3;
  readonly components: readonly HeuristicComponent[];
  readonly suggestedAircraft: HeuristicComponent;
  readonly warning: string;
}

export interface AnalysisGroup {
  readonly label: string;
  readonly mode: "all" | "include" | "aircraft-heuristic";
  readonly blocks: readonly BsgBlock[];
  readonly excludedGuids: readonly string[];
  readonly warnings: readonly string[];
}

function centroid(blocks: readonly BsgBlock[]): Vec3 {
  if (blocks.length === 0) return [0, 0, 0];
  return scale(blocks.reduce<Vec3>((sum, block) => add(sum, block.position), [0, 0, 0]), 1 / blocks.length);
}

function disjointSet(size: number): { find(index: number): number; union(a: number, b: number): void } {
  const parents = Array.from({ length: size }, (_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  return {
    find,
    union(a: number, b: number): void {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parents[rootB] = rootA;
    },
  };
}

/** Exact GUID links that are explicitly serialized in BSG. This is not a complete joint graph. */
export function explicitBuildLinks(machine: BsgMachine): readonly (readonly [string, string])[] {
  const known = new Set(machine.blocks.map((block) => block.guid));
  const links: [string, string][] = [];
  for (const block of machine.blocks) {
    if (block.id === 72) {
      for (const endpoint of [block.strings.get("start"), block.strings.get("end")]) {
        if (endpoint && known.has(endpoint)) links.push([block.guid, endpoint]);
      }
    } else if (block.id === 73) {
      const edges = block.strings.get("edges")?.split("|").filter(Boolean) ?? [];
      for (const edge of edges) if (known.has(edge)) links.push([block.guid, edge]);
    }
  }
  return links;
}

/**
 * Transparent heuristic only: union block roots within a fixed radius, then add
 * the exact BuildEdge/BuildSurface GUID links that are present in the BSG.
 */
export function suggestComponents(
  machine: BsgMachine,
  blades: readonly VanillaBlade[],
  threshold = 1.5,
): ComponentSuggestion {
  if (!(threshold > 0)) throw new Error("component proximity threshold must be positive");
  const blocks = machine.blocks;
  const byGuid = new Map(blocks.map((block, index) => [block.guid, index]));
  const sets = disjointSet(blocks.length);
  for (let first = 0; first < blocks.length; first += 1) {
    for (let second = first + 1; second < blocks.length; second += 1) {
      if (magnitude(subtract(blocks[first].position, blocks[second].position)) <= threshold) {
        sets.union(first, second);
      }
    }
  }
  for (const [from, to] of explicitBuildLinks(machine)) {
    sets.union(byGuid.get(from)!, byGuid.get(to)!);
  }

  const grouped = new Map<number, BsgBlock[]>();
  blocks.forEach((block, index) => {
    const root = sets.find(index);
    const group = grouped.get(root) ?? [];
    group.push(block);
    grouped.set(root, group);
  });
  const bladeGuids = new Set(blades.map((blade) => blade.guid));
  const bladeCentroid = centroid(blades);
  const unsorted = [...grouped.values()].map((componentBlocks) => {
    const componentCentroid = centroid(componentBlocks);
    return {
      blocks: componentBlocks,
      bladeCount: componentBlocks.filter((block) => bladeGuids.has(block.guid)).length,
      centroid: componentCentroid,
      distanceToBladeCentroid: magnitude(subtract(componentCentroid, bladeCentroid)),
    };
  });
  unsorted.sort((a, b) => b.bladeCount - a.bladeCount || b.blocks.length - a.blocks.length || a.distanceToBladeCentroid - b.distanceToBladeCentroid);
  const components = unsorted.map((component, index) => ({ index, ...component }));
  const suggestedAircraft = components[0];
  if (!suggestedAircraft) throw new Error("Cannot suggest an aircraft component for an empty machine");
  return {
    method: "spatial-proximity-plus-explicit-build-links",
    threshold,
    bladeCentroid,
    components,
    suggestedAircraft,
    warning: "HEURISTIC: root proximity and explicit BuildEdge/Surface links are not Besiege's complete runtime joint graph.",
  };
}

function validateGuids(machine: BsgMachine, guids: ReadonlySet<string>, option: string): void {
  const known = new Set(machine.blocks.map((block) => block.guid));
  const missing = [...guids].filter((guid) => !known.has(guid));
  if (missing.length > 0) throw new Error(`${option}: unknown block GUID(s): ${missing.join(", ")}`);
}

export function selectAnalysisGroup(
  machine: BsgMachine,
  blades: readonly VanillaBlade[],
  options: {
    readonly mode: "all" | "aircraft-heuristic";
    readonly includeGuids: ReadonlySet<string>;
    readonly excludeGuids: ReadonlySet<string>;
    readonly proximityThreshold?: number;
  },
): { group: AnalysisGroup; suggestion: ComponentSuggestion } {
  validateGuids(machine, options.includeGuids, "--include-guid");
  validateGuids(machine, options.excludeGuids, "--exclude-guid");
  if (options.includeGuids.size > 0 && options.mode !== "all") {
    throw new Error("--include-guid cannot be combined with --mass-group aircraft-heuristic");
  }
  const suggestion = suggestComponents(machine, blades, options.proximityThreshold);
  let mode: AnalysisGroup["mode"] = options.mode;
  let selected = machine.blocks;
  const warnings: string[] = [];
  if (options.includeGuids.size > 0) {
    mode = "include";
    selected = machine.blocks.filter((block) => options.includeGuids.has(block.guid));
  } else if (options.mode === "aircraft-heuristic") {
    selected = suggestion.suggestedAircraft.blocks;
    warnings.push(suggestion.warning);
  }
  selected = selected.filter((block) => !options.excludeGuids.has(block.guid));
  const selectedSet = new Set(selected.map((block) => block.guid));
  return {
    group: {
      label: mode === "include"
        ? `explicit include (${selected.length} blocks)`
        : mode === "aircraft-heuristic"
          ? `heuristic aircraft component #${suggestion.suggestedAircraft.index}`
          : "all machine blocks",
      mode,
      blocks: selected,
      excludedGuids: machine.blocks.filter((block) => !selectedSet.has(block.guid)).map((block) => block.guid),
      warnings,
    },
    suggestion,
  };
}
