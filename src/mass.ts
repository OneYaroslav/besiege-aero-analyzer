import massDatabaseJson from "../data/besiege-1.90-25346-mass.json" with { type: "json" };
import type { BsgBlock } from "./bsg.ts";
import type { AnalysisGroup } from "./groups.ts";
import { add, rotateVector, scale, subtract, type Vec3 } from "./math.ts";

export type MassProvenance = "prefab-verified" | "block-specific-override" | "runtime-required" | "unknown";

export interface MassDatabaseEntry {
  readonly id: number;
  readonly type: string;
  readonly prefabGameObject: string;
  readonly hasRigidbody: boolean;
  readonly mass: number | null;
  readonly massProvenance: MassProvenance;
  readonly localCenterOfMass: Vec3 | null;
  readonly centerOfMassProvenance: MassProvenance | "not-applicable";
}

export interface MassDatabase {
  readonly schemaVersion: number;
  readonly gameVersion: string;
  readonly unityVersion: string;
  readonly assemblyCSharpSha256: string;
  readonly blocks: readonly MassDatabaseEntry[];
}

export interface BlockMassContribution {
  readonly block: BsgBlock;
  readonly type: string;
  readonly hasRigidbody: boolean;
  /** Mass used by this static approximation. Null means no known own Rigidbody mass. */
  readonly mass: number | null;
  readonly massProvenance: MassProvenance;
  /** Machine-local position used for the contribution. */
  readonly centerOfMass: Vec3 | null;
  readonly centerOfMassProvenance: MassProvenance | "not-applicable";
  readonly warnings: readonly string[];
}

export interface PointMassInertia {
  readonly xx: number;
  readonly yy: number;
  readonly zz: number;
  readonly xy: number;
  readonly xz: number;
  readonly yz: number;
}

export interface MassAnalysis {
  readonly group: AnalysisGroup;
  readonly database: Pick<MassDatabase, "gameVersion" | "unityVersion" | "assemblyCSharpSha256">;
  readonly contributions: readonly BlockMassContribution[];
  readonly totalMass: number;
  readonly centerOfMass: Vec3;
  readonly pointMassInertia: PointMassInertia;
  readonly provenanceCounts: Readonly<Record<MassProvenance, number>>;
  readonly warnings: readonly string[];
}

export const MASS_DATABASE = massDatabaseJson as MassDatabase;
const MASS_BY_ID = new Map(MASS_DATABASE.blocks.map((entry) => [entry.id, entry]));

function transformPoint(block: BsgBlock, localPoint: Vec3): Vec3 {
  const scaled: Vec3 = [
    localPoint[0] * block.scale[0],
    localPoint[1] * block.scale[1],
    localPoint[2] * block.scale[2],
  ];
  return add(block.position, rotateVector(block.rotation, scaled));
}

function draggedBlockMidpoint(block: BsgBlock): Vec3 | undefined {
  const start = block.vectors.get("start-position");
  const end = block.vectors.get("end-position");
  if (!start || !end) return undefined;
  return scale(add(transformPoint(block, start), transformPoint(block, end)), 0.5);
}

function contributionFor(block: BsgBlock): BlockMassContribution {
  const prefab = MASS_BY_ID.get(block.id);
  if (!prefab) {
    return {
      block,
      type: `Unknown(${block.id})`,
      hasRigidbody: false,
      mass: null,
      massProvenance: "unknown",
      centerOfMass: null,
      centerOfMassProvenance: "unknown",
      warnings: [`Block ${block.guid} id=${block.id}: no entry in the versioned mass database`],
    };
  }
  if (!prefab.hasRigidbody) {
    return {
      block,
      type: prefab.type,
      hasRigidbody: false,
      mass: null,
      massProvenance: "prefab-verified",
      centerOfMass: null,
      centerOfMassProvenance: "not-applicable",
      warnings: [],
    };
  }

  let mass = prefab.mass;
  let massProvenance: MassProvenance = "prefab-verified";
  let centerOfMass = block.position;
  let centerOfMassProvenance: MassProvenance = "runtime-required";
  const warnings: string[] = [];

  // Assembly-CSharp ShorteningBlock.UpdateLength, verified for the installed version.
  const version = block.integers.get("bmt-version") ?? 0;
  const length = block.integers.get("length");
  if (version > 0 && length !== undefined && block.id === 41 && length === 1) {
    mass = 0.25;
    massProvenance = "block-specific-override";
  } else if (version > 0 && length !== undefined && block.id === 63 && length === 2) {
    mass = 0.6499999761581421;
    massProvenance = "block-specific-override";
  }

  // GenericDraggedBlock.SetCenterOfMass uses the endpoint midpoint. Its child
  // Rigidbody topology still needs runtime export before their masses can be
  // included without double-counting.
  if (block.id === 9 || block.id === 45) {
    centerOfMass = draggedBlockMidpoint(block) ?? block.position;
    centerOfMassProvenance = draggedBlockMidpoint(block) ? "block-specific-override" : "runtime-required";
    massProvenance = "runtime-required";
    warnings.push(
      `${prefab.type} ${block.guid}: using root prefab mass only; endpoint Rigidbody membership/masses require runtime export`,
    );
  }

  if (block.id === 73) {
    massProvenance = "runtime-required";
    warnings.push(
      `BuildSurface ${block.guid}: using prefab mass fallback; runtime UpdateMass depends on generated colliders and material density`,
    );
  }

  // SigmaGoida RSM.dll CustomJoint: UpdateMassState requires both toggles.
  if (block.booleans.get("bmt-SimpleSet") === true && block.booleans.get("bmt-Forcemass") === true) {
    const forcedMass = block.singles.get("bmt-RNFmass");
    if (forcedMass !== undefined && Number.isFinite(forcedMass) && forcedMass > 0) {
      mass = forcedMass;
      massProvenance = "block-specific-override";
    } else {
      mass = null;
      massProvenance = "unknown";
      warnings.push(`Block ${block.guid}: RSM force-mass is enabled but bmt-RNFmass is missing/invalid`);
    }
  }

  return {
    block,
    type: prefab.type,
    hasRigidbody: true,
    mass,
    massProvenance,
    centerOfMass,
    centerOfMassProvenance,
    warnings,
  };
}

function inertia(contributions: readonly BlockMassContribution[], cg: Vec3): PointMassInertia {
  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (const contribution of contributions) {
    if (contribution.mass === null || contribution.centerOfMass === null) continue;
    const [x, y, z] = subtract(contribution.centerOfMass, cg);
    const mass = contribution.mass;
    xx += mass * (y * y + z * z);
    yy += mass * (x * x + z * z);
    zz += mass * (x * x + y * y);
    xy -= mass * x * y;
    xz -= mass * x * z;
    yz -= mass * y * z;
  }
  return { xx, yy, zz, xy, xz, yz };
}

export function analyzeMass(group: AnalysisGroup): MassAnalysis {
  const contributions = group.blocks.map(contributionFor);
  let totalMass = 0;
  let weighted: Vec3 = [0, 0, 0];
  for (const contribution of contributions) {
    if (contribution.mass === null || contribution.centerOfMass === null) continue;
    totalMass += contribution.mass;
    weighted = add(weighted, scale(contribution.centerOfMass, contribution.mass));
  }
  if (!(totalMass > 0)) throw new Error(`AnalysisGroup ${group.label} has no known positive mass`);
  const centerOfMass = scale(weighted, 1 / totalMass);
  const provenanceCounts: Record<MassProvenance, number> = {
    "prefab-verified": 0,
    "block-specific-override": 0,
    "runtime-required": 0,
    unknown: 0,
  };
  for (const contribution of contributions) provenanceCounts[contribution.massProvenance] += 1;
  const warnings = [...new Set([...group.warnings, ...contributions.flatMap((entry) => entry.warnings)])];
  if (contributions.some((entry) => entry.centerOfMassProvenance === "runtime-required")) {
    warnings.push("CG is approximate: missing prefab/runtime local COM values fall back to BSG block-root positions.");
  }
  return {
    group,
    database: {
      gameVersion: MASS_DATABASE.gameVersion,
      unityVersion: MASS_DATABASE.unityVersion,
      assemblyCSharpSha256: MASS_DATABASE.assemblyCSharpSha256,
    },
    contributions,
    totalMass,
    centerOfMass,
    pointMassInertia: inertia(contributions, centerOfMass),
    provenanceCounts,
    warnings,
  };
}

export function massDatabaseEntry(id: number): MassDatabaseEntry | undefined {
  return MASS_BY_ID.get(id);
}
