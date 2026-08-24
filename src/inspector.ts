import type { ContributionDerivative, BladeContributionAnalysis } from "./analysis.ts";
import type { Vec3 } from "./math.ts";
import type { BladeTableRow } from "./ui-model.ts";

export type InspectorDisplayMode =
  | "geometry"
  | "force"
  | "power"
  | "roll-moment"
  | "pitch-moment"
  | "yaw-moment"
  | "roll-damping"
  | "pitch-damping"
  | "yaw-damping"
  | "pitch-static"
  | "yaw-static";

export interface InspectorDisplayModeDefinition {
  readonly label: string;
  readonly units: string;
  readonly signed: boolean;
  readonly contribution?: ContributionDerivative;
}

export const INSPECTOR_DISPLAY_MODES: Readonly<Record<InspectorDisplayMode, InspectorDisplayModeDefinition>> = {
  geometry: { label: "Geometry", units: "schematic", signed: false },
  force: { label: "Force magnitude", units: "game force units", signed: false },
  power: { label: "Blade power F·v", units: "game power units", signed: true },
  "roll-moment": { label: "Roll moment", units: "game moment units", signed: true },
  "pitch-moment": { label: "Pitch moment", units: "game moment units", signed: true },
  "yaw-moment": { label: "Yaw moment", units: "game moment units", signed: true },
  "roll-damping": { label: "Roll damping contribution", units: "moment/(rad/s)", signed: true, contribution: "roll-damping" },
  "pitch-damping": { label: "Pitch damping contribution", units: "moment/(rad/s)", signed: true, contribution: "pitch-damping" },
  "yaw-damping": { label: "Yaw damping contribution", units: "moment/(rad/s)", signed: true, contribution: "yaw-damping" },
  "pitch-static": { label: "Pitch static contribution", units: "moment/radian", signed: true, contribution: "pitch-alpha" },
  "yaw-static": { label: "Yaw static contribution", units: "moment/radian", signed: true, contribution: "yaw-beta" },
};

export type InspectorContributionMap = Readonly<Partial<Record<ContributionDerivative, BladeContributionAnalysis>>>;

export function inspectorDisplayValue(
  mode: InspectorDisplayMode,
  row: BladeTableRow,
  contributions: InspectorContributionMap,
): number | null {
  if (mode === "geometry") return null;
  if (mode === "force") return Math.hypot(...row.force);
  if (mode === "power") return row.power;
  if (mode === "roll-moment") return row.rollMoment;
  if (mode === "pitch-moment") return row.pitchMoment;
  if (mode === "yaw-moment") return row.yawMoment;
  const derivative = INSPECTOR_DISPLAY_MODES[mode].contribution;
  if (!derivative) return null;
  return contributions[derivative]?.blades.find((entry) => entry.guid === row.blade.guid)?.derivativeContribution ?? 0;
}

export type BladeSelectionModifier = "replace" | "toggle" | "add";

export function updateBladeSelection(
  current: ReadonlySet<string>,
  guid: string | null,
  modifier: BladeSelectionModifier = "replace",
): Set<string> {
  if (guid === null) return new Set();
  if (modifier === "replace") return new Set([guid]);
  const next = new Set(current);
  if (modifier === "toggle") {
    if (next.has(guid)) next.delete(guid); else next.add(guid);
  } else {
    next.add(guid);
  }
  return next;
}

export function bladeSelectionMap(guids: readonly string[], selected: ReadonlySet<string>): ReadonlyMap<string, boolean> {
  return new Map(guids.map((guid) => [guid, selected.has(guid)]));
}

export function sanitizeBladeSelection(selected: ReadonlySet<string>, availableGuids: ReadonlySet<string>): Set<string> {
  return new Set([...selected].filter((guid) => availableGuids.has(guid)));
}

export interface InspectorVisibilityState {
  readonly hiddenGuids: ReadonlySet<string>;
  readonly isolatedGuids: ReadonlySet<string> | null;
}

export const EMPTY_INSPECTOR_VISIBILITY: InspectorVisibilityState = {
  hiddenGuids: new Set(),
  isolatedGuids: null,
};

export function hideSelectedBlades(state: InspectorVisibilityState, selected: ReadonlySet<string>): InspectorVisibilityState {
  return { ...state, hiddenGuids: new Set([...state.hiddenGuids, ...selected]) };
}

export function isolateSelectedBlades(selected: ReadonlySet<string>): InspectorVisibilityState {
  return { hiddenGuids: new Set(), isolatedGuids: new Set(selected) };
}

export function showAllBlades(): InspectorVisibilityState {
  return { hiddenGuids: new Set(), isolatedGuids: null };
}

export function visibleBladeGuids(
  allGuids: readonly string[],
  state: InspectorVisibilityState,
): Set<string> {
  return new Set(allGuids.filter((guid) =>
    !state.hiddenGuids.has(guid) && (state.isolatedGuids === null || state.isolatedGuids.has(guid)),
  ));
}

export interface InspectorSelectionSummary {
  readonly bladeCount: number;
  readonly totalForce: Vec3;
  readonly totalPower: number;
  readonly rollMoment: number;
  readonly pitchMoment: number;
  readonly yawMoment: number;
  readonly displayContribution: number | null;
}

export function summarizeBladeSelection(
  rows: readonly BladeTableRow[],
  selected: ReadonlySet<string>,
  mode: InspectorDisplayMode,
  contributions: InspectorContributionMap,
): InspectorSelectionSummary {
  let totalForce: Vec3 = [0, 0, 0];
  let totalPower = 0;
  let rollMoment = 0;
  let pitchMoment = 0;
  let yawMoment = 0;
  let bladeCount = 0;
  let displayContribution = INSPECTOR_DISPLAY_MODES[mode].contribution ? 0 : null;
  for (const row of rows) {
    if (!selected.has(row.blade.guid)) continue;
    bladeCount += 1;
    totalForce = [totalForce[0] + row.force[0], totalForce[1] + row.force[1], totalForce[2] + row.force[2]];
    totalPower += row.power;
    rollMoment += row.rollMoment;
    pitchMoment += row.pitchMoment;
    yawMoment += row.yawMoment;
    if (displayContribution !== null) displayContribution += inspectorDisplayValue(mode, row, contributions) ?? 0;
  }
  return { bladeCount, totalForce, totalPower, rollMoment, pitchMoment, yawMoment, displayContribution };
}

export interface InspectorColorScale {
  readonly signed: boolean;
  readonly minimum: number;
  readonly maximum: number;
  readonly maximumAbsolute: number;
}

export function buildInspectorColorScale(values: readonly number[], signed: boolean): InspectorColorScale {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { signed, minimum: 0, maximum: 0, maximumAbsolute: 0 };
  if (signed) {
    const maximumAbsolute = Math.max(...finite.map(Math.abs));
    return { signed, minimum: -maximumAbsolute, maximum: maximumAbsolute, maximumAbsolute };
  }
  const maximum = Math.max(0, ...finite);
  return { signed, minimum: 0, maximum, maximumAbsolute: maximum };
}

export function normalizeInspectorColorValue(value: number, scale: InspectorColorScale): number {
  if (!Number.isFinite(value) || scale.maximumAbsolute <= 1e-15) return 0;
  const normalized = value / scale.maximumAbsolute;
  return scale.signed ? Math.max(-1, Math.min(1, normalized)) : Math.max(0, Math.min(1, normalized));
}

type Rgb = readonly [number, number, number];

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

function rgbNumber(rgb: Rgb): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

const NEUTRAL_RGB: Rgb = [95, 105, 115];
const NEGATIVE_RGB: Rgb = [45, 145, 205];
const POSITIVE_RGB: Rgb = [145, 65, 25];
const SEQUENTIAL_LOW_RGB: Rgb = [42, 54, 64];
const SEQUENTIAL_HIGH_RGB: Rgb = [84, 210, 239];

export function inspectorColor(value: number, scale: InspectorColorScale): number {
  const normalized = normalizeInspectorColorValue(value, scale);
  if (scale.signed) {
    return rgbNumber(mixRgb(NEUTRAL_RGB, normalized < 0 ? NEGATIVE_RGB : POSITIVE_RGB, Math.abs(normalized)));
  }
  return rgbNumber(mixRgb(SEQUENTIAL_LOW_RGB, SEQUENTIAL_HIGH_RGB, normalized));
}

export interface InspectorBounds {
  readonly minimum: Vec3;
  readonly maximum: Vec3;
  readonly center: Vec3;
  readonly size: Vec3;
  readonly radius: number;
  readonly span: number;
}

export function computeInspectorBounds(points: readonly Vec3[]): InspectorBounds {
  if (points.length === 0) {
    return { minimum: [-1, -1, -1], maximum: [1, 1, 1], center: [0, 0, 0], size: [2, 2, 2], radius: Math.sqrt(3), span: 2 };
  }
  const minimum: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  }
  const center: Vec3 = [
    (minimum[0] + maximum[0]) / 2,
    (minimum[1] + maximum[1]) / 2,
    (minimum[2] + maximum[2]) / 2,
  ];
  const size: Vec3 = [maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]];
  const span = Math.max(...size, 1e-3);
  const radius = Math.max(Math.hypot(size[0], size[1], size[2]) / 2, span * 0.5, 0.5);
  return { minimum, maximum, center, size, radius, span };
}

export type InspectorViewPreset = "front" | "rear" | "left" | "right" | "top" | "bottom" | "perspective";

export interface InspectorCameraFrame {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly near: number;
  readonly far: number;
  readonly distance: number;
}

const PRESET_DIRECTIONS: Readonly<Record<InspectorViewPreset, { direction: Vec3; up: Vec3 }>> = {
  front: { direction: [0, 0, 1], up: [0, 1, 0] },
  rear: { direction: [0, 0, -1], up: [0, 1, 0] },
  left: { direction: [-1, 0, 0], up: [0, 1, 0] },
  right: { direction: [1, 0, 0], up: [0, 1, 0] },
  top: { direction: [0, 1, 0], up: [0, 0, 1] },
  bottom: { direction: [0, -1, 0], up: [0, 0, -1] },
  // A side-biased three-quarter view keeps the machine-local +Z fuselage axis
  // readable. Looking too closely along +Z made compact aircraft appear as a
  // small vertical stack even though all blocks were present.
  perspective: { direction: [1.4, 0.72, 0.7], up: [0, 1, 0] },
};

function normalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  return length > 1e-12 ? [vector[0] / length, vector[1] / length, vector[2] / length] : [0, 0, 1];
}

export function frameInspectorCamera(
  bounds: InspectorBounds,
  preset: InspectorViewPreset,
  aspect = 1,
  verticalFovDegrees = 45,
): InspectorCameraFrame {
  const verticalHalfFov = Math.max(verticalFovDegrees * Math.PI / 360, 0.05);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(aspect, 0.05));
  const direction = normalizeVec3(PRESET_DIRECTIONS[preset].direction);
  // Fit the projected AABB, not a sphere around it. Aircraft are normally long
  // and flat; sphere fitting made a valid model occupy only a small strip of the
  // viewport (most visibly on Gripen). These are the same axes THREE.lookAt uses.
  const nominalUp = PRESET_DIRECTIONS[preset].up;
  const right = normalizeVec3([
    nominalUp[1] * direction[2] - nominalUp[2] * direction[1],
    nominalUp[2] * direction[0] - nominalUp[0] * direction[2],
    nominalUp[0] * direction[1] - nominalUp[1] * direction[0],
  ]);
  const screenUp = normalizeVec3([
    direction[1] * right[2] - direction[2] * right[1],
    direction[2] * right[0] - direction[0] * right[2],
    direction[0] * right[1] - direction[1] * right[0],
  ]);
  const halfSize: Vec3 = [bounds.size[0] / 2, bounds.size[1] / 2, bounds.size[2] / 2];
  let requiredDistance = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const corner: Vec3 = [halfSize[0] * sx, halfSize[1] * sy, halfSize[2] * sz];
    const depth = corner[0] * direction[0] + corner[1] * direction[1] + corner[2] * direction[2];
    const horizontal = Math.abs(corner[0] * right[0] + corner[1] * right[1] + corner[2] * right[2]);
    const vertical = Math.abs(corner[0] * screenUp[0] + corner[1] * screenUp[1] + corner[2] * screenUp[2]);
    requiredDistance = Math.max(
      requiredDistance,
      depth + horizontal / Math.tan(horizontalHalfFov),
      depth + vertical / Math.tan(verticalHalfFov),
    );
  }
  const distance = Math.max(requiredDistance * 1.14, bounds.radius * 1.02, 1);
  const position: Vec3 = [
    bounds.center[0] + direction[0] * distance,
    bounds.center[1] + direction[1] * distance,
    bounds.center[2] + direction[2] * distance,
  ];
  const near = Math.max(bounds.radius * 0.002, 0.001);
  const far = Math.max(distance + bounds.radius * 40, 100);
  return { position, target: bounds.center, up: PRESET_DIRECTIONS[preset].up, near, far, distance };
}
