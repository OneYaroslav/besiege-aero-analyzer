import { extractVanillaBlades, type BsgBlock, type BsgMachine, type VanillaBlade } from "./bsg.ts";
import { add, normalizeQuaternion, type Quaternion, type Vec3 } from "./math.ts";

/**
 * GUID-addressed virtual blade transform. Position and rotation offsets are in
 * machine/aircraft axes. Rotation tuple order is pitch +X, yaw +Y, roll +Z.
 */
export interface BladeWhatIfOverride {
  readonly guid: string;
  readonly flipped?: boolean;
  readonly positionOffset: Vec3;
  readonly rotationOffsetDegrees: Vec3;
}

export const ZERO_WHAT_IF_VECTOR: Vec3 = [0, 0, 0];

function finiteVector(value: Vec3, label: string): void {
  for (let index = 0; index < 3; index += 1) {
    if (!Number.isFinite(value[index])) throw new Error(`${label}[${index}] must be finite`);
  }
}

export function validateBladeWhatIfOverride(override: BladeWhatIfOverride): void {
  if (!override.guid.trim()) throw new Error("What-if blade GUID cannot be empty");
  finiteVector(override.positionOffset, `${override.guid}.positionOffset`);
  finiteVector(override.rotationOffsetDegrees, `${override.guid}.rotationOffsetDegrees`);
  if (override.flipped !== undefined && typeof override.flipped !== "boolean") throw new Error(`${override.guid}.flipped must be boolean`);
}

export function quaternionMultiply(left: Quaternion, right: Quaternion): Quaternion {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function axisQuaternion(axis: 0 | 1 | 2, radians: number): Quaternion {
  const half = radians / 2;
  const sine = Math.sin(half);
  return {
    x: axis === 0 ? sine : 0,
    y: axis === 1 ? sine : 0,
    z: axis === 2 ? sine : 0,
    w: Math.cos(half),
  };
}

/** Extrinsic aircraft-axis X then Y then Z rotation, expressed as qZ*qY*qX. */
export function aircraftEulerOffsetQuaternion(rotationDegrees: Vec3): Quaternion {
  finiteVector(rotationDegrees, "rotationOffsetDegrees");
  const radians = rotationDegrees.map((value) => value * Math.PI / 180) as unknown as Vec3;
  return quaternionMultiply(
    axisQuaternion(2, radians[2]),
    quaternionMultiply(axisQuaternion(1, radians[1]), axisQuaternion(0, radians[0])),
  );
}

export function isActiveBladeWhatIfOverride(override: BladeWhatIfOverride): boolean {
  return override.flipped !== undefined
    || override.positionOffset.some((value) => Math.abs(value) > 1e-12)
    || override.rotationOffsetDegrees.some((value) => Math.abs(value) > 1e-12);
}

export function overrideMap(overrides: readonly BladeWhatIfOverride[]): ReadonlyMap<string, BladeWhatIfOverride> {
  const result = new Map<string, BladeWhatIfOverride>();
  for (const override of overrides) {
    validateBladeWhatIfOverride(override);
    if (result.has(override.guid)) throw new Error(`Duplicate what-if override for blade ${override.guid}`);
    if (isActiveBladeWhatIfOverride(override)) result.set(override.guid, override);
  }
  return result;
}

export function setBladeTransformOverrides(
  overrides: readonly BladeWhatIfOverride[],
  guids: Iterable<string>,
  positionOffset: Vec3,
  rotationOffsetDegrees: Vec3,
): readonly BladeWhatIfOverride[] {
  finiteVector(positionOffset, "positionOffset");
  finiteVector(rotationOffsetDegrees, "rotationOffsetDegrees");
  const byGuid = new Map(overrideMap(overrides));
  for (const guid of new Set(guids)) {
    const current = byGuid.get(guid);
    const next: BladeWhatIfOverride = {
      guid,
      flipped: current?.flipped,
      positionOffset: [...positionOffset] as unknown as Vec3,
      rotationOffsetDegrees: [...rotationOffsetDegrees] as unknown as Vec3,
    };
    if (isActiveBladeWhatIfOverride(next)) byGuid.set(guid, next); else byGuid.delete(guid);
  }
  return [...byGuid.values()];
}

export function flipBladeOverrides(
  machine: BsgMachine,
  overrides: readonly BladeWhatIfOverride[],
  guids: Iterable<string>,
): readonly BladeWhatIfOverride[] {
  const original = new Map(extractVanillaBlades(machine).map((blade) => [blade.guid, blade]));
  const byGuid = new Map(overrideMap(overrides));
  for (const guid of new Set(guids)) {
    const blade = original.get(guid);
    if (!blade) continue;
    const current = byGuid.get(guid);
    const modifiedFlipped = current?.flipped ?? blade.flipped;
    const nextFlipped = !modifiedFlipped;
    const next: BladeWhatIfOverride = {
      guid,
      flipped: nextFlipped === blade.flipped ? undefined : nextFlipped,
      positionOffset: current?.positionOffset ?? ZERO_WHAT_IF_VECTOR,
      rotationOffsetDegrees: current?.rotationOffsetDegrees ?? ZERO_WHAT_IF_VECTOR,
    };
    if (isActiveBladeWhatIfOverride(next)) byGuid.set(guid, next); else byGuid.delete(guid);
  }
  return [...byGuid.values()];
}

export function resetBladeOverrides(
  overrides: readonly BladeWhatIfOverride[],
  guids: Iterable<string>,
): readonly BladeWhatIfOverride[] {
  const reset = new Set(guids);
  return overrides.filter((override) => !reset.has(override.guid));
}

export function applyBladeWhatIfOverride(block: BsgBlock, override: BladeWhatIfOverride): BsgBlock {
  validateBladeWhatIfOverride(override);
  const booleans = new Map(block.booleans);
  if (override.flipped !== undefined) booleans.set("flipped", override.flipped);
  return {
    ...block,
    position: add(block.position, override.positionOffset),
    rotation: quaternionMultiply(aircraftEulerOffsetQuaternion(override.rotationOffsetDegrees), block.rotation),
    booleans,
  };
}

/** Returns a virtual machine; source BSG objects/maps are never mutated. */
export function applyBladeWhatIfOverrides(
  machine: BsgMachine,
  overrides: readonly BladeWhatIfOverride[],
): BsgMachine {
  const byGuid = overrideMap(overrides);
  if (byGuid.size === 0) return machine;
  return {
    ...machine,
    blocks: machine.blocks.map((block) => {
      const override = byGuid.get(block.guid);
      return override && (block.id === 26 || block.id === 55) ? applyBladeWhatIfOverride(block, override) : block;
    }),
  };
}

export function missingBladeWhatIfGuids(machine: BsgMachine, overrides: readonly BladeWhatIfOverride[]): readonly string[] {
  const available = new Set(extractVanillaBlades(machine).map((blade) => blade.guid));
  return overrides.map((override) => override.guid).filter((guid) => !available.has(guid));
}

export function originalAndModifiedBlade(
  machine: BsgMachine,
  overrides: readonly BladeWhatIfOverride[],
  guid: string,
): { readonly original?: VanillaBlade; readonly modified?: VanillaBlade } {
  const original = extractVanillaBlades(machine).find((blade) => blade.guid === guid);
  if (!original) return {};
  const modified = extractVanillaBlades(applyBladeWhatIfOverrides(machine, overrides)).find((blade) => blade.guid === guid);
  return { original, modified };
}
