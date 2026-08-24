export type TutorialTab =
  | "overview"
  | "sweeps"
  | "plot-lab"
  | "blades"
  | "contributions"
  | "components"
  | "viewer"
  | "snapshots";

export type TutorialPlacement = "top" | "right" | "bottom" | "left" | "center";
export type TutorialCompletion = "blade-selected" | "blade-group-created" | "baseline-snapshot" | "what-if-changed";

export interface TutorialStepDefinition {
  readonly id:
    | "program-overview"
    | "tutorial-aircraft"
    | "components"
    | "viewer"
    | "operating-point"
    | "current-state"
    | "static-response"
    | "damping-response"
    | "alpha-sweep"
    | "pitch-q-sweep"
    | "beta-sweep"
    | "yaw-r-sweep"
    | "roll-p-sweep"
    | "plot-lab"
    | "blade-selection"
    | "blade-groups"
    | "snapshot"
    | "what-if"
    | "changed-analysis"
    | "snapshot-compare"
    | "extended-what-if"
    | "finish";
  readonly target?: string;
  readonly tab?: TutorialTab;
  readonly placement: TutorialPlacement;
  readonly completion?: TutorialCompletion;
  readonly compactCard?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStepDefinition[] = [
  { id: "program-overview", placement: "center" },
  { id: "tutorial-aircraft", target: "[data-tutorial='machine-file']", tab: "overview", placement: "right" },
  { id: "components", target: "[data-tutorial='components']", tab: "components", placement: "left", compactCard: true },
  { id: "operating-point", target: "[data-tutorial='operating-point']", tab: "overview", placement: "right" },
  { id: "current-state", target: "[data-tutorial='baseline']", tab: "overview", placement: "left", compactCard: true },
  { id: "static-response", target: "[data-tutorial='static-response']", tab: "overview", placement: "top" },
  { id: "damping-response", target: "[data-tutorial='damping-response']", tab: "overview", placement: "top" },
  { id: "alpha-sweep", target: "[data-tutorial='alpha-sweep']", tab: "sweeps", placement: "top" },
  { id: "pitch-q-sweep", target: "[data-tutorial='pitch-q-sweep']", tab: "sweeps", placement: "top" },
  { id: "beta-sweep", target: "[data-tutorial='beta-sweep']", tab: "sweeps", placement: "top" },
  { id: "yaw-r-sweep", target: "[data-tutorial='yaw-r-sweep']", tab: "sweeps", placement: "top" },
  { id: "roll-p-sweep", target: "[data-tutorial='roll-p-sweep']", tab: "sweeps", placement: "top" },
  { id: "plot-lab", target: "[data-tutorial='plot-lab']", tab: "plot-lab", placement: "top" },
  { id: "viewer", target: "[data-tutorial='viewer']", tab: "viewer", placement: "left" },
  { id: "blade-selection", target: "[data-tutorial='viewer-canvas']", tab: "viewer", placement: "left", completion: "blade-selected", compactCard: true },
  { id: "blade-groups", target: "[data-tutorial='blade-groups']", tab: "viewer", placement: "left", completion: "blade-group-created" },
  { id: "snapshot", target: "[data-tutorial='snapshot-save']", tab: "snapshots", placement: "bottom", completion: "baseline-snapshot" },
  { id: "what-if", target: "[data-tutorial='what-if']", tab: "viewer", placement: "left", completion: "what-if-changed" },
  { id: "changed-analysis", target: "[data-tutorial='sweeps']", tab: "sweeps", placement: "top" },
  { id: "snapshot-compare", target: "[data-tutorial='snapshot-compare']", tab: "snapshots", placement: "top" },
  { id: "extended-what-if", target: "[data-tutorial='what-if']", tab: "viewer", placement: "left" },
  { id: "finish", placement: "center" },
];

export interface TutorialProgress {
  readonly selectedBladeCount: number;
  readonly bladeGroupCount: number;
  readonly largestBladeGroupSize: number;
  readonly hasBaselineSnapshot: boolean;
  readonly whatIfChanged: boolean;
  readonly pitchDampingExample: number | null;
}

export function isTutorialStepComplete(step: TutorialStepDefinition, progress: TutorialProgress): boolean {
  if (step.completion === "blade-selected") return progress.selectedBladeCount > 0;
  if (step.completion === "blade-group-created") return progress.bladeGroupCount > 0 && progress.largestBladeGroupSize > 1;
  if (step.completion === "baseline-snapshot") return progress.hasBaselineSnapshot;
  if (step.completion === "what-if-changed") return progress.whatIfChanged;
  return true;
}

export interface TutorialRect {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface TutorialSize {
  readonly width: number;
  readonly height: number;
}

export interface TutorialCardPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: TutorialPlacement;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function computeTutorialCardPosition(
  target: TutorialRect | null,
  card: TutorialSize,
  viewport: TutorialSize,
  preferred: TutorialPlacement,
  gap = 16,
  margin = 12,
): TutorialCardPosition {
  if (!target || preferred === "center") {
    return {
      top: clamp((viewport.height - card.height) / 2, margin, viewport.height - card.height - margin),
      left: clamp((viewport.width - card.width) / 2, margin, viewport.width - card.width - margin),
      placement: "center",
    };
  }

  const orderedPlacements: Exclude<TutorialPlacement, "center">[] = [
    preferred,
    "bottom",
    "top",
    "right",
    "left",
  ];
  const candidates = orderedPlacements.filter((placement, index, values) => values.indexOf(placement) === index);

  const position = (placement: Exclude<TutorialPlacement, "center">) => {
    if (placement === "top") return { top: target.top - card.height - gap, left: target.left + (target.width - card.width) / 2 };
    if (placement === "bottom") return { top: target.bottom + gap, left: target.left + (target.width - card.width) / 2 };
    if (placement === "left") return { top: target.top + (target.height - card.height) / 2, left: target.left - card.width - gap };
    return { top: target.top + (target.height - card.height) / 2, left: target.right + gap };
  };

  for (const placement of candidates) {
    const candidate = position(placement);
    if (candidate.left >= margin && candidate.top >= margin && candidate.left + card.width <= viewport.width - margin && candidate.top + card.height <= viewport.height - margin) {
      return { ...candidate, placement };
    }
  }

  const fallback = position(candidates[0]);
  return {
    top: clamp(fallback.top, margin, viewport.height - card.height - margin),
    left: clamp(fallback.left, margin, viewport.width - card.width - margin),
    placement: candidates[0],
  };
}
