import type { ContributionDerivative } from "./analysis.ts";
import type { Vec3 } from "./math.ts";
import type { PlotLabUiState } from "./plot-lab.ts";
import { buildBladeRows, type OperatingPoint, type UiAnalysisBundle, type UiGroupSelection } from "./ui-model.ts";
import type { BladeWhatIfOverride } from "./what-if.ts";

export interface BladeGroup {
  readonly id: string;
  readonly name: string;
  readonly bladeGuids: readonly string[];
}

export type BladeGroupEnabledState = "enabled" | "disabled" | "mixed";

export interface BladeGroupSummary {
  readonly requestedBladeCount: number;
  readonly availableBladeCount: number;
  readonly missingBladeGuids: readonly string[];
  readonly enabledState: BladeGroupEnabledState;
  readonly totalForce: Vec3;
  readonly totalMoment: Vec3;
  readonly rollMoment: number;
  readonly pitchMoment: number;
  readonly yawMoment: number;
  readonly bladePower: number;
  readonly derivativeContributions: Readonly<Record<ContributionDerivative, number>>;
}

export interface SnapshotMachineState {
  readonly machineName: string;
  readonly groupSelection: UiGroupSelection;
  readonly cgMode: "auto";
  readonly disabledBladeGuids: readonly string[];
  readonly bladeGroups: readonly BladeGroup[];
  readonly whatIfOverrides: readonly BladeWhatIfOverride[];
}

export interface AnalysisSessionState {
  readonly mode: "single" | "compare";
  readonly activeMachine: "A" | "B";
  readonly operatingPoint: OperatingPoint;
  readonly plotLab: PlotLabUiState;
  readonly showDeltaPercent: boolean;
  readonly machines: readonly SnapshotMachineState[];
}

export interface AnalysisSnapshot {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly createdAt: string;
  readonly state: AnalysisSessionState;
}

const CONTRIBUTIONS: readonly ContributionDerivative[] = [
  "pitch-damping", "yaw-damping", "roll-damping", "pitch-alpha", "yaw-beta",
];

function uniqueGuids(guids: Iterable<string>): string[] {
  return [...new Set(guids)];
}

export function createBladeGroup(id: string, name: string, guids: Iterable<string>): BladeGroup {
  const trimmed = name.trim();
  const bladeGuids = uniqueGuids(guids);
  if (!id.trim()) throw new Error("Blade Group id cannot be empty");
  if (!trimmed) throw new Error("Blade Group name cannot be empty");
  if (bladeGuids.length === 0) throw new Error("Blade Group requires at least one selected blade");
  return { id, name: trimmed, bladeGuids };
}

export function renameBladeGroup(groups: readonly BladeGroup[], id: string, name: string): readonly BladeGroup[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Blade Group name cannot be empty");
  return groups.map((group) => group.id === id ? { ...group, name: trimmed } : group);
}

export function deleteBladeGroup(groups: readonly BladeGroup[], id: string): readonly BladeGroup[] {
  return groups.filter((group) => group.id !== id);
}

export function bladeGroupEnabledState(group: BladeGroup, disabledGuids: ReadonlySet<string>): BladeGroupEnabledState {
  const disabledCount = group.bladeGuids.filter((guid) => disabledGuids.has(guid)).length;
  if (disabledCount === 0) return "enabled";
  if (disabledCount === group.bladeGuids.length) return "disabled";
  return "mixed";
}

export function setBladeGroupEnabled(
  disabledGuids: ReadonlySet<string>,
  group: BladeGroup,
  enabled: boolean,
): Set<string> {
  const next = new Set(disabledGuids);
  for (const guid of group.bladeGuids) enabled ? next.delete(guid) : next.add(guid);
  return next;
}

export function summarizeBladeGroup(
  bundle: UiAnalysisBundle,
  group: BladeGroup,
  disabledGuids: ReadonlySet<string>,
): BladeGroupSummary {
  const wanted = new Set(group.bladeGuids);
  const rows = buildBladeRows(bundle).filter((row) => wanted.has(row.blade.guid));
  const available = new Set(rows.map((row) => row.blade.guid));
  const totalForce = [0, 0, 0] as [number, number, number];
  const totalMoment = [0, 0, 0] as [number, number, number];
  let bladePower = 0;
  for (const row of rows) {
    for (let axis = 0; axis < 3; axis += 1) {
      totalForce[axis] += row.force[axis];
      totalMoment[axis] += row.moment[axis];
    }
    bladePower += row.power;
  }
  const derivativeContributions = Object.fromEntries(CONTRIBUTIONS.map((kind) => {
    const byGuid = new Map(bundle.contributions[kind].blades.map((entry) => [entry.guid, entry.derivativeContribution]));
    return [kind, group.bladeGuids.reduce((sum, guid) => sum + (byGuid.get(guid) ?? 0), 0)];
  })) as Record<ContributionDerivative, number>;
  return {
    requestedBladeCount: group.bladeGuids.length,
    availableBladeCount: rows.length,
    missingBladeGuids: group.bladeGuids.filter((guid) => !available.has(guid)),
    enabledState: bladeGroupEnabledState(group, disabledGuids),
    totalForce,
    totalMoment,
    rollMoment: totalMoment[2],
    pitchMoment: totalMoment[0],
    yawMoment: totalMoment[1],
    bladePower,
    derivativeContributions,
  };
}

export function cloneSessionState(state: AnalysisSessionState): AnalysisSessionState {
  return {
    ...state,
    operatingPoint: { ...state.operatingPoint },
    plotLab: {
      ...state.plotLab,
      quantities: [...state.plotLab.quantities],
      range: { ...state.plotLab.range },
      x2Range: { ...state.plotLab.x2Range },
      y2Range: { ...state.plotLab.y2Range },
    },
    machines: state.machines.map((machine) => ({
      ...machine,
      groupSelection: { ...machine.groupSelection },
      disabledBladeGuids: [...machine.disabledBladeGuids],
      bladeGroups: machine.bladeGroups.map((group) => ({ ...group, bladeGuids: [...group.bladeGuids] })),
      whatIfOverrides: machine.whatIfOverrides.map((override) => ({
        ...override,
        positionOffset: [...override.positionOffset] as Vec3,
        rotationOffsetDegrees: [...override.rotationOffsetDegrees] as Vec3,
      })),
    })),
  };
}

export function createSnapshot(
  id: string,
  name: string,
  note: string,
  createdAt: string,
  state: AnalysisSessionState,
): AnalysisSnapshot {
  const trimmed = name.trim();
  if (!id.trim()) throw new Error("Snapshot id cannot be empty");
  if (!trimmed) throw new Error("Snapshot name cannot be empty");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Snapshot createdAt must be an ISO timestamp");
  return { id, name: trimmed, note: note.trim(), createdAt, state: cloneSessionState(state) };
}

export function duplicateSnapshot(snapshot: AnalysisSnapshot, id: string, createdAt: string): AnalysisSnapshot {
  return createSnapshot(id, `${snapshot.name} copy`, snapshot.note, createdAt, snapshot.state);
}

export function renameSnapshot(snapshots: readonly AnalysisSnapshot[], id: string, name: string): readonly AnalysisSnapshot[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Snapshot name cannot be empty");
  return snapshots.map((snapshot) => snapshot.id === id ? { ...snapshot, name: trimmed } : snapshot);
}

export function snapshotChanges(first: AnalysisSessionState, second: AnalysisSessionState): readonly string[] {
  const changes: string[] = [];
  const pointKeys = ["speed", "alphaDegrees", "betaDegrees", "p", "q", "r"] as const;
  for (const key of pointKeys) {
    if (first.operatingPoint[key] !== second.operatingPoint[key]) changes.push(`${key}: ${first.operatingPoint[key]} → ${second.operatingPoint[key]}`);
  }
  if (first.mode !== second.mode) changes.push(`mode: ${first.mode} → ${second.mode}`);
  if (first.activeMachine !== second.activeMachine) changes.push(`active machine: ${first.activeMachine} → ${second.activeMachine}`);
  const count = Math.max(first.machines.length, second.machines.length);
  for (let index = 0; index < count; index += 1) {
    const a = first.machines[index];
    const b = second.machines[index];
    const label = index === 0 ? "A" : "B";
    if (!a || !b) { changes.push(`machine ${label}: ${a?.machineName ?? "missing"} → ${b?.machineName ?? "missing"}`); continue; }
    if (JSON.stringify(a.groupSelection) !== JSON.stringify(b.groupSelection)) changes.push(`machine ${label} AnalysisGroup changed`);
    const aDisabled = new Set(a.disabledBladeGuids);
    const bDisabled = new Set(b.disabledBladeGuids);
    const disabled = [...bDisabled].filter((guid) => !aDisabled.has(guid)).length;
    const enabled = [...aDisabled].filter((guid) => !bDisabled.has(guid)).length;
    if (disabled || enabled) changes.push(`machine ${label} blades: ${disabled} disabled, ${enabled} enabled`);
    if (JSON.stringify(a.bladeGroups) !== JSON.stringify(b.bladeGroups)) changes.push(`machine ${label} Blade Groups changed`);
    if (JSON.stringify(a.whatIfOverrides) !== JSON.stringify(b.whatIfOverrides)) changes.push(`machine ${label} What-if transforms/flips changed`);
  }
  if (JSON.stringify(first.plotLab) !== JSON.stringify(second.plotLab)) changes.push("Plot Lab settings changed");
  if (first.showDeltaPercent !== second.showDeltaPercent) changes.push("Delta display settings changed");
  return changes;
}
