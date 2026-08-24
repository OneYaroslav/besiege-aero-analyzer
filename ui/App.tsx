import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ContributionDerivative } from "../src/analysis.ts";
import { extractVanillaBlades, parseBsg, type BsgMachine } from "../src/bsg.ts";
import {
  buildImportedDataset,
  parseAnalysisImport,
  parseCsv,
  type CsvTable,
  type ImportedAnalysisState,
  type ImportedDataset,
} from "../src/file-workflow.ts";
import { DEFAULT_PLOT_LAB_STATE, deltaPercent, type PlotLabUiState } from "../src/plot-lab.ts";
import type { InspectorDisplayMode } from "../src/inspector.ts";
import {
  createStandardSweepBaseline,
  type StandardSweepBaseline,
  type StandardSweepKey,
  type StickySweepDomain,
} from "../src/sweep-visualization.ts";
import { TUTORIAL_STEPS, type TutorialTab } from "../src/tutorial.ts";
import {
  createBladeGroup,
  createSnapshot,
  deleteBladeGroup,
  duplicateSnapshot,
  renameBladeGroup,
  renameSnapshot,
  setBladeGroupEnabled,
  type AnalysisSessionState,
  type AnalysisSnapshot,
  type BladeGroup,
  type SnapshotMachineState,
} from "../src/session-state.ts";
import {
  flipBladeOverrides,
  missingBladeWhatIfGuids,
  resetBladeOverrides,
  setBladeTransformOverrides,
  type BladeWhatIfOverride,
} from "../src/what-if.ts";
import {
  DEFAULT_OPERATING_POINT,
  assembleComparisonRows,
  buildExportPayload,
  buildUiAnalysis,
  discoverMachine,
  formatNumber,
  type MachineDiscovery,
  type OperatingPoint,
  type PrecisionMode,
  type UiAnalysisBundle,
  type UiGroupSelection,
} from "../src/ui-model.ts";
import { BladeTable } from "./components/BladeTable.tsx";
import { BladeGroupsPanel } from "./components/BladeGroupsPanel.tsx";
import { ComponentsView } from "./components/ComponentsView.tsx";
import { ContributionTable } from "./components/ContributionTable.tsx";
import { OperatingControls } from "./components/Controls.tsx";
import { FileDrop } from "./components/FileDrop.tsx";
import { InfoTooltip } from "./components/InfoTooltip.tsx";
import { BaselinePanel, DerivativesPanel, MachineSummary } from "./components/Overview.tsx";
import { PlotLab } from "./components/PlotLab.tsx";
import { SWEEP_METRICS, SweepChart, type SweepMetric } from "./components/SweepChart.tsx";
import { SnapshotsPanel, type ResolvedSnapshotSource } from "./components/SnapshotsPanel.tsx";
import { WhatIfPanel } from "./components/WhatIfPanel.tsx";
import { DEFAULT_VIEWER_TOGGLES, ThreeViewer, type ViewerToggles } from "./components/ThreeViewer.tsx";
import { TutorialOverlay } from "./components/TutorialOverlay.tsx";
import { CSV_FILE_FILTER, JSON_FILE_FILTER, getFileIo, safeFileName } from "./file-io.ts";
import { setUiLanguage } from "./i18n.ts";

type Mode = "single" | "compare";
type MachineKey = "A" | "B";
type Tab = TutorialTab;

interface LoadedMachine {
  readonly fileName: string;
  readonly machine: BsgMachine;
  readonly discovery: MachineDiscovery;
  readonly sweepBaseline: StandardSweepBaseline;
}

interface CsvImportDraft {
  readonly fileName: string;
  readonly table: CsvTable;
  readonly name: string;
  readonly xColumn: string;
  readonly yColumns: readonly string[];
}

interface StandardGraphVisibility {
  readonly alpha: boolean;
  readonly pitchQ: boolean;
  readonly beta: boolean;
  readonly yawR: boolean;
  readonly rollP: boolean;
}

const DEFAULT_STANDARD_GRAPHS: StandardGraphVisibility = {
  alpha: true,
  pitchQ: true,
  beta: true,
  yawR: true,
  rollP: true,
};

const TUTORIAL_AIRCRAFT_URL = `${import.meta.env.BASE_URL}tutorial/tutorial-aircraft.bsg`;
const TUTORIAL_AIRCRAFT_FILE_NAME = "tutorial-aircraft.bsg";

const TABS: ReadonlyArray<{ key: Tab; labelKey: string }> = [
  { key: "overview", labelKey: "tabs.overview" },
  { key: "sweeps", labelKey: "tabs.sweeps" },
  { key: "plot-lab", labelKey: "tabs.plotLab" },
  { key: "blades", labelKey: "tabs.blades" },
  { key: "contributions", labelKey: "tabs.contributions" },
  { key: "components", labelKey: "tabs.components" },
  { key: "viewer", labelKey: "tabs.viewer" },
  { key: "snapshots", labelKey: "tabs.snapshots" },
];

function sessionId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function initializeLoadedMachine(
  fileName: string,
  machine: BsgMachine,
  discovery: MachineDiscovery,
  group: UiGroupSelection,
  operatingPoint: OperatingPoint,
  contribution: ContributionDerivative,
): LoadedMachine {
  const baselineBundle = buildUiAnalysis(machine, discovery, group, operatingPoint, new Set(), contribution, []);
  return {
    fileName,
    machine,
    discovery,
    sweepBaseline: createStandardSweepBaseline(sessionId("sweep-baseline"), baselineBundle),
  };
}

const CONTRIBUTIONS: ReadonlyArray<{ value: ContributionDerivative; labelKey: string }> = [
  { value: "pitch-damping", labelKey: "contributions.pitchDamping" },
  { value: "yaw-damping", labelKey: "contributions.yawDamping" },
  { value: "roll-damping", labelKey: "contributions.rollDamping" },
  { value: "pitch-alpha", labelKey: "contributions.pitchStatic" },
  { value: "yaw-beta", labelKey: "contributions.yawStatic" },
];

function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : JSON.parse(stored) as T;
    } catch {
      return fallback;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue];
}

function analyzeLoaded(
  loaded: LoadedMachine | undefined,
  group: UiGroupSelection,
  operatingPoint: OperatingPoint,
  disabled: ReadonlySet<string>,
  contribution: ContributionDerivative,
  whatIfOverrides: readonly BladeWhatIfOverride[],
): { bundle?: UiAnalysisBundle; error?: string } {
  if (!loaded) return {};
  try {
    return { bundle: buildUiAnalysis(loaded.machine, loaded.discovery, group, operatingPoint, disabled, contribution, whatIfOverrides) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function groupLabel(selection: UiGroupSelection, t: TFunction<readonly ["common", "analysis", "plotlab", "snapshots"]>): string {
  if (selection.kind === "all") return t("analysis:group.all");
  if (selection.kind === "aircraft") return t("analysis:group.aircraft");
  return t("analysis:group.component", { index: selection.index });
}

function GroupSelector({ discovery, value, onChange }: { discovery: MachineDiscovery; value: UiGroupSelection; onChange: (value: UiGroupSelection) => void }) {
  const { t } = useTranslation("analysis");
  const serialized = value.kind === "component" ? `component:${value.index}` : value.kind;
  return (
    <label className="select-field group-select">
      <span>{t("group.label")} <InfoTooltip label={t("group.about")}>{t("group.help")}</InfoTooltip></span>
      <select aria-label={t("group.label")} value={serialized} onChange={(event) => {
        if (event.target.value === "all") onChange({ kind: "all" });
        else if (event.target.value === "aircraft") onChange({ kind: "aircraft" });
        else onChange({ kind: "component", index: Number(event.target.value.split(":")[1]) });
      }}>
        <option value="all">{t("group.all")}</option>
        <option value="aircraft">{t("group.aircraft")}</option>
        {discovery.components.filter((component) => !component.suggestedAircraft).map((component) => (
          <option key={component.index} value={`component:${component.index}`}>{t("group.component", { index: component.index })}</option>
        ))}
      </select>
    </label>
  );
}

function ActiveMachineSwitch({ value, secondAvailable, onChange }: { value: MachineKey; secondAvailable: boolean; onChange: (value: MachineKey) => void }) {
  const { t } = useTranslation("analysis");
  if (!secondAvailable) return null;
  return <div className="segmented compact" aria-label={t("machine.active")}><button className={value === "A" ? "active" : ""} onClick={() => onChange("A")}>{t("machine.a")}</button><button className={value === "B" ? "active" : ""} onClick={() => onChange("B")}>{t("machine.b")}</button></div>;
}

function ComparisonTable({ first, second, precision, showPercent, onShowPercentChange }: { first: UiAnalysisBundle; second: UiAnalysisBundle; precision: PrecisionMode; showPercent: boolean; onShowPercentChange: (value: boolean) => void }) {
  const { t } = useTranslation("analysis");
  const rows = assembleComparisonRows(first, second);
  const display = (value: number | readonly [number, number, number]) => typeof value === "number" ? formatNumber(value, precision) : value.map((item) => formatNumber(item, precision)).join(" / ");
  const delta = (firstValue: number | readonly [number, number, number], secondValue: number | readonly [number, number, number]) => {
    if (typeof firstValue === "number" && typeof secondValue === "number") {
      const value = secondValue - firstValue;
      return `${value > 0 ? "+" : ""}${formatNumber(value, precision)}`;
    }
    if (typeof firstValue !== "number" && typeof secondValue !== "number") {
      return secondValue.map((item, index) => {
        const value = item - firstValue[index];
        return `${value > 0 ? "+" : ""}${formatNumber(value, precision)}`;
      }).join(" / ");
    }
    return "—";
  };
  const percent = (firstValue: number | readonly [number, number, number], secondValue: number | readonly [number, number, number]) => {
    const render = (firstNumber: number, secondNumber: number) => {
      const value = deltaPercent(firstNumber, secondNumber);
      return value === null ? "N/A" : `${value > 0 ? "+" : ""}${formatNumber(value, precision)}%`;
    };
    if (typeof firstValue === "number" && typeof secondValue === "number") return render(firstValue, secondValue);
    if (typeof firstValue !== "number" && typeof secondValue !== "number") return secondValue.map((value, index) => render(firstValue[index], value)).join(" / ");
    return "N/A";
  };
  return (
    <section className="data-panel comparison-panel">
      <div className="panel-title comparison-title"><span>{t("comparison.title")}</span><small>{t("comparison.subtitle")}</small><label><input type="checkbox" checked={showPercent} onChange={(event) => onShowPercentChange(event.target.checked)} /> {t("comparison.showPercent")}</label></div>
      <div className="table-scroll"><table className="engineering-table comparison-table">
        <thead><tr><th>{t("comparison.quantity")}</th><th>{t("comparison.units")}</th><th className="machine-a-text">A · {first.report.machine.name}</th><th className="machine-b-text">B · {second.report.machine.name}</th><th>Δ B − A</th>{showPercent && <th>{t("comparison.percentVsA")}</th>}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}><th>{row.label}</th><td>{row.units}</td><td title={JSON.stringify(row.first)}>{display(row.first)}</td><td title={JSON.stringify(row.second)}>{display(row.second)}</td><td className="delta-cell">{delta(row.first, row.second)}</td>{showPercent && <td className="delta-percent-cell">{percent(row.first, row.second)}</td>}</tr>)}</tbody>
      </table></div>
    </section>
  );
}

function MetricSelector({ label, value, onChange }: { label: string; value: SweepMetric; onChange: (value: SweepMetric) => void }) {
  const { t } = useTranslation("analysis");
  return <label className="inline-select">{label}<select value={value} onChange={(event) => onChange(event.target.value as SweepMetric)}>{Object.keys(SWEEP_METRICS).map((key) => <option key={key} value={key}>{t(`sweepMetrics.${key}` as never)}</option>)}</select></label>;
}

function sweepChartMachine(loaded: LoadedMachine, bundle: UiAnalysisBundle, key: keyof UiAnalysisBundle["sweeps"]) {
  return {
    name: bundle.report.machine.name,
    sweep: bundle.sweeps[key],
    baseline: loaded.sweepBaseline.sweeps[key],
    baselineId: loaded.sweepBaseline.id,
  };
}

function ModelStatus({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const { t } = useTranslation("analysis");
  return (
    <details className="model-status" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>{t("model.title")}</summary>
      <div className="model-status-grid">
        <span>{t("model.forceLaw")}</span><strong className="status-recovered">{t("model.recovered")}</strong>
        <span>{t("model.grouping")}</span><strong className="status-estimated">{t("model.heuristic")}</strong>
        <span>{t("model.cg")}</span><strong>{t("model.approximate")}</strong>
        <span>{t("model.si")}</span><strong>{t("model.unavailable")}</strong>
      </div>
      <ul>
        <li>{t("model.noteForce")}</li><li>{t("model.noteGroups")}</li><li>{t("model.noteCg")}</li><li>{t("model.noteLimits")}</li>
      </ul>
    </details>
  );
}

function CsvImportPanel({ draft, onChange, onCancel, onImport }: {
  readonly draft: CsvImportDraft;
  readonly onChange: (draft: CsvImportDraft) => void;
  readonly onCancel: () => void;
  readonly onImport: () => void;
}) {
  const { t } = useTranslation(["plotlab", "common"]);
  const yCandidates = draft.table.numericColumns.filter((column) => column !== draft.xColumn);
  return <div className="modal-backdrop" role="presentation"><section className="data-panel csv-import-panel" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
    <div className="csv-import-title"><div><span className="panel-kicker">{t("plotlab:csv.import")}</span><strong id="csv-import-title">{t("plotlab:csv.configure")}</strong><small>{t("plotlab:csv.rows", { file: draft.fileName, count: draft.table.rows.length })}</small></div><button className="icon-button" aria-label={t("common:actions.close")} onClick={onCancel}>×</button></div>
    <label className="select-field"><span>{t("plotlab:csv.datasetName")}</span><input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
    <label className="select-field"><span>{t("plotlab:csv.xColumn")}</span><select value={draft.xColumn} onChange={(event) => {
      const xColumn = event.target.value;
      onChange({ ...draft, xColumn, yColumns: draft.yColumns.filter((column) => column !== xColumn) });
    }}>{draft.table.numericColumns.map((column) => <option key={column} value={column}>{column} · {draft.table.units[column]}</option>)}</select></label>
    <fieldset className="csv-y-columns"><legend>{t("plotlab:csv.yColumns")}</legend>{yCandidates.map((column) => <label key={column}><input type="checkbox" checked={draft.yColumns.includes(column)} onChange={(event) => onChange({ ...draft, yColumns: event.target.checked ? [...draft.yColumns, column] : draft.yColumns.filter((candidate) => candidate !== column) })} /> <span>{column}</span><small>{draft.table.units[column]}</small></label>)}{yCandidates.length === 0 && <p>{t("plotlab:csv.noY")}</p>}</fieldset>
    <div className="csv-import-actions"><small>{t("plotlab:csv.visualOnly")}</small><button className="secondary-button" onClick={onCancel}>{t("common:actions.cancel")}</button><button className="primary-button" disabled={!draft.name.trim() || draft.yColumns.length === 0} onClick={onImport}>{t("plotlab:csv.importDataset")}</button></div>
  </section></div>;
}

export function App() {
  const { t, i18n } = useTranslation(["common", "analysis", "plotlab", "snapshots"]);
  const [mode, setMode] = useState<Mode>("single");
  const [first, setFirst] = useState<LoadedMachine>();
  const [second, setSecond] = useState<LoadedMachine>();
  const [groupA, setGroupA] = useState<UiGroupSelection>({ kind: "all" });
  const [groupB, setGroupB] = useState<UiGroupSelection>({ kind: "all" });
  const [disabledA, setDisabledA] = useState<Set<string>>(() => new Set());
  const [disabledB, setDisabledB] = useState<Set<string>>(() => new Set());
  const [bladeGroupsA, setBladeGroupsA] = useState<readonly BladeGroup[]>([]);
  const [bladeGroupsB, setBladeGroupsB] = useState<readonly BladeGroup[]>([]);
  const [whatIfA, setWhatIfA] = useState<readonly BladeWhatIfOverride[]>([]);
  const [whatIfB, setWhatIfB] = useState<readonly BladeWhatIfOverride[]>([]);
  const [snapshots, setSnapshots] = useState<readonly AnalysisSnapshot[]>([]);
  const [selectedA, setSelectedA] = useState<Set<string>>(() => new Set());
  const [selectedB, setSelectedB] = useState<Set<string>>(() => new Set());
  const [focusedA, setFocusedA] = useState<string>();
  const [focusedB, setFocusedB] = useState<string>();
  const [operatingPoint, setOperatingPoint] = useState<OperatingPoint>(DEFAULT_OPERATING_POINT);
  const [contribution, setContribution] = useState<ContributionDerivative>("pitch-damping");
  const [activeMachine, setActiveMachine] = useState<MachineKey>("A");
  const [loadError, setLoadError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [pendingAnalysisImport, setPendingAnalysisImport] = useState<ImportedAnalysisState>();
  const [csvImportDraft, setCsvImportDraft] = useState<CsvImportDraft>();
  const [importedDatasets, setImportedDatasets] = useState<readonly ImportedDataset[]>([]);
  const [tab, setTab] = useStoredState<Tab>("baa:last-tab", "overview");
  const [precision, setPrecision] = useStoredState<PrecisionMode>("baa:precision", "auto");
  const [plotLabState, setPlotLabState] = useStoredState<PlotLabUiState>("baa:plot-lab-state", DEFAULT_PLOT_LAB_STATE);
  const [alphaMetric, setAlphaMetric] = useStoredState<SweepMetric>("baa:alpha-metric", "pitch");
  const [betaMetric, setBetaMetric] = useStoredState<SweepMetric>("baa:beta-metric", "yaw");
  const [statusOpen, setStatusOpen] = useStoredState<boolean>("baa:model-status-open", false);
  const [sidebarVisible, setSidebarVisible] = useStoredState<boolean>("baa:sidebar-visible", true);
  // v2 intentionally resets legacy viewer visibility. Earlier builds could
  // persist blocks=false and make a correctly built scene look completely empty.
  const [viewerToggles, setViewerToggles] = useStoredState<ViewerToggles>("baa:viewer-toggles-v2", DEFAULT_VIEWER_TOGGLES);
  const [viewerDisplayMode, setViewerDisplayMode] = useStoredState<InspectorDisplayMode>("baa:viewer-display-mode", "geometry");
  const [standardGraphs, setStandardGraphs] = useStoredState<StandardGraphVisibility>("baa:standard-graphs", DEFAULT_STANDARD_GRAPHS);
  const [stickySweepDomains, setStickySweepDomains] = useState<Partial<Record<StandardSweepKey, StickySweepDomain>>>({});
  const [showDeltaPercent, setShowDeltaPercent] = useStoredState<boolean>("baa:show-delta-percent", false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState<number | null>(null);
  const [tutorialLoading, setTutorialLoading] = useState(false);
  const analysisA = useMemo(() => analyzeLoaded(first, groupA, operatingPoint, disabledA, contribution, whatIfA), [first, groupA, operatingPoint, disabledA, contribution, whatIfA]);
  const analysisB = useMemo(() => analyzeLoaded(second, groupB, operatingPoint, disabledB, contribution, whatIfB), [second, groupB, operatingPoint, disabledB, contribution, whatIfB]);
  const bundleA = analysisA.bundle;
  const bundleB = mode === "compare" ? analysisB.bundle : undefined;
  const activeBundle = activeMachine === "B" && bundleB ? bundleB : bundleA;
  const activeLoaded = activeMachine === "B" && second ? second : first;
  const activeGroup = activeMachine === "B" ? groupB : groupA;
  const activeSelected = activeMachine === "B" ? selectedB : selectedA;
  const activeFocused = activeMachine === "B" ? focusedB : focusedA;
  const activeBladeGroups = activeMachine === "B" && bundleB ? bladeGroupsB : bladeGroupsA;
  const activeWhatIf = activeMachine === "B" && bundleB ? whatIfB : whatIfA;
  const tutorialStep = tutorialStepIndex === null ? undefined : TUTORIAL_STEPS[tutorialStepIndex];
  const baselineSnapshot = snapshots.find((snapshot) => snapshot.name.trim().toLocaleLowerCase() === "baseline");
  const focusActive = useCallback((guid: string | undefined) => { if (activeMachine === "B") setFocusedB(guid); else setFocusedA(guid); }, [activeMachine]);
  const updateStickySweepDomain = useCallback((key: StandardSweepKey, next: StickySweepDomain) => {
    setStickySweepDomains((current) => {
      const previous = current[key];
      if (previous?.signature === next.signature && previous.domain[0] === next.domain[0] && previous.domain[1] === next.domain[1]) return current;
      return { ...current, [key]: next };
    });
  }, []);

  useEffect(() => {
    if (!tutorialStep) return;
    if (tutorialStep.tab) setTab(tutorialStep.tab);
    if (tutorialStep.id === "operating-point") setSidebarVisible(true);
  }, [tutorialStep?.id]);

  function flashFileStatus(message: string): void {
    setExportMessage(message);
    window.setTimeout(() => setExportMessage(""), 5_000);
  }

  function matchesImportedMachine(loaded: LoadedMachine, expectedName: string): boolean {
    const normalize = (value: string) => value.replace(/\.bsg$/i, "").trim().toLocaleLowerCase();
    const expected = normalize(expectedName);
    return normalize(loaded.machine.name) === expected || normalize(loaded.fileName) === expected;
  }

  function restoredGroup(loaded: Pick<LoadedMachine, "discovery">, requested: UiGroupSelection): UiGroupSelection {
    if (requested.kind !== "component") return requested;
    return loaded.discovery.components.some((component) => component.index === requested.index) ? requested : { kind: "all" };
  }

  function restoredDisabledBlades(loaded: LoadedMachine, requested: readonly string[]): Set<string> {
    const available = new Set(extractVanillaBlades(loaded.machine).map((blade) => blade.guid));
    return new Set(requested.filter((guid) => available.has(guid)));
  }

  function importedGuidWarnings(loaded: LoadedMachine, imported: ImportedAnalysisState["machines"][number]): readonly string[] {
    const available = new Set(extractVanillaBlades(loaded.machine).map((blade) => blade.guid));
    const missingDisabled = imported.disabledBladeGuids.filter((guid) => !available.has(guid));
    const missingMembers = new Set(imported.bladeGroups.flatMap((group) => group.bladeGuids).filter((guid) => !available.has(guid)));
    const missingOverrides = missingBladeWhatIfGuids(loaded.machine, imported.whatIfOverrides);
    return [
      ...(missingDisabled.length > 0 ? [`${missingDisabled.length} disabled blade GUID(s) are absent`] : []),
      ...(missingMembers.size > 0 ? [`${missingMembers.size} Blade Group member GUID(s) are absent`] : []),
      ...(missingOverrides.length > 0 ? [`${missingOverrides.length} What-if blade GUID(s) are absent`] : []),
    ];
  }

  function applyImportedMachine(key: MachineKey, loaded: LoadedMachine, imported: ImportedAnalysisState["machines"][number]): boolean {
    if (!matchesImportedMachine(loaded, imported.name)) return false;
    const group = restoredGroup(loaded, imported.groupSelection);
    const disabled = restoredDisabledBlades(loaded, imported.disabledBladeGuids);
    if (key === "A") { setGroupA(group); setDisabledA(disabled); setBladeGroupsA(imported.bladeGroups); setWhatIfA(imported.whatIfOverrides); setSelectedA(new Set()); setFocusedA(undefined); }
    else { setGroupB(group); setDisabledB(disabled); setBladeGroupsB(imported.bladeGroups); setWhatIfB(imported.whatIfOverrides); setSelectedB(new Set()); setFocusedB(undefined); }
    return true;
  }

  async function loadFile(key: MachineKey, file: File) {
    setLoadError("");
    try {
      const machine = parseBsg(await file.text(), file.name);
      const discovery = discoverMachine(machine);
      const importedMachine = pendingAnalysisImport?.machines[key === "A" ? 0 : 1];
      const baselineGroup: UiGroupSelection = importedMachine ? restoredGroup({ discovery }, importedMachine.groupSelection) : { kind: "all" };
      const loaded = initializeLoadedMachine(file.name, machine, discovery, baselineGroup, operatingPoint, contribution);
      setStickySweepDomains({});
      const restored = importedMachine ? applyImportedMachine(key, loaded, importedMachine) : false;
      if (key === "A") {
        setFirst(loaded);
        if (!restored) { setGroupA({ kind: "all" }); setDisabledA(new Set()); setBladeGroupsA([]); setWhatIfA([]); setSelectedA(new Set()); setFocusedA(undefined); }
      } else {
        setSecond(loaded);
        if (!restored) { setGroupB({ kind: "all" }); setDisabledB(new Set()); setBladeGroupsB([]); setWhatIfB([]); setSelectedB(new Set()); setFocusedB(undefined); }
      }
      if (importedMachine) {
        const warnings = restored ? importedGuidWarnings(loaded, importedMachine) : [];
        flashFileStatus(restored
          ? t("analysis:notices.stateApplied", { machine: loaded.machine.name, warning: warnings.length > 0 ? ` ${t("analysis:notices.warning")}: ${warnings.join("; ")}.` : "" })
          : t("analysis:notices.loadedExpected", { loaded: loaded.machine.name, expected: importedMachine.name }));
      }
    } catch (cause) {
      setLoadError(`${t(key === "A" ? "analysis:machine.a" : "analysis:machine.b")}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function startTutorial(): Promise<void> {
    setTutorialLoading(true);
    setLoadError("");
    try {
      const response = await fetch(TUTORIAL_AIRCRAFT_URL);
        if (!response.ok) throw new Error(t("analysis:errors.tutorialLoad", { status: response.status }));
      const machine = parseBsg(await response.text(), TUTORIAL_AIRCRAFT_FILE_NAME);
      const discovery = discoverMachine(machine);
      const loaded = initializeLoadedMachine(TUTORIAL_AIRCRAFT_FILE_NAME, machine, discovery, { kind: "aircraft" }, DEFAULT_OPERATING_POINT, contribution);
      setStickySweepDomains({});
      setMode("single");
      setActiveMachine("A");
      setFirst(loaded);
      setSecond(undefined);
      setGroupA({ kind: "aircraft" });
      setGroupB({ kind: "all" });
      setDisabledA(new Set());
      setDisabledB(new Set());
      setBladeGroupsA([]);
      setBladeGroupsB([]);
      setWhatIfA([]);
      setWhatIfB([]);
      setSnapshots([]);
      setSelectedA(new Set());
      setSelectedB(new Set());
      setFocusedA(undefined);
      setFocusedB(undefined);
      setOperatingPoint(DEFAULT_OPERATING_POINT);
      setPlotLabState(DEFAULT_PLOT_LAB_STATE);
      setStandardGraphs(DEFAULT_STANDARD_GRAPHS);
      setPendingAnalysisImport(undefined);
      setViewerToggles({ ...DEFAULT_VIEWER_TOGGLES, blocks: true, blades: true });
      setSidebarVisible(true);
      setTab("overview");
      setTutorialStepIndex(0);
    } catch (cause) {
      setLoadError(`${t("analysis:tutorial.title")}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setTutorialLoading(false);
    }
  }

  function openAircraftFromTutorial(): void {
    const openButton = document.querySelector<HTMLElement>("[data-tutorial='machine-file'] button");
    setTutorialStepIndex(null);
    openButton?.click();
  }

  function changeGroup(key: MachineKey, selection: UiGroupSelection) {
    if (key === "A") { setGroupA(selection); setDisabledA(new Set()); setSelectedA(new Set()); setFocusedA(undefined); }
    else { setGroupB(selection); setDisabledB(new Set()); setSelectedB(new Set()); setFocusedB(undefined); }
  }

  function setBladeEnabled(key: MachineKey, guid: string, enabled: boolean) {
    const update = (current: Set<string>) => { const next = new Set(current); if (enabled) next.delete(guid); else next.add(guid); return next; };
    if (key === "A") setDisabledA(update); else setDisabledB(update);
  }
  function enableAll(key: MachineKey) { if (key === "A") setDisabledA(new Set()); else setDisabledB(new Set()); }
  function disableSelected(key: MachineKey) { if (key === "A") setDisabledA((current) => new Set([...current, ...selectedA])); else setDisabledB((current) => new Set([...current, ...selectedB])); }
  function resetBlades(key: MachineKey) {
    enableAll(key);
    if (key === "A") { setSelectedA(new Set()); setFocusedA(undefined); }
    else { setSelectedB(new Set()); setFocusedB(undefined); }
  }

  function createGroup(key: MachineKey, name: string): void {
    const selection = key === "A" ? selectedA : selectedB;
    try {
      const group = createBladeGroup(sessionId("blade-group"), name, selection);
      if (key === "A") setBladeGroupsA((current) => [...current, group]);
      else setBladeGroupsB((current) => [...current, group]);
      flashFileStatus(t("analysis:notices.groupCreated", { name: group.name }));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function renameGroup(key: MachineKey, id: string, name: string): void {
    try {
      if (key === "A") setBladeGroupsA((current) => renameBladeGroup(current, id, name));
      else setBladeGroupsB((current) => renameBladeGroup(current, id, name));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function removeGroup(key: MachineKey, id: string): void {
    if (key === "A") setBladeGroupsA((current) => deleteBladeGroup(current, id));
    else setBladeGroupsB((current) => deleteBladeGroup(current, id));
  }

  function setGroupEnabled(key: MachineKey, group: BladeGroup, enabled: boolean): void {
    if (key === "A") setDisabledA((current) => setBladeGroupEnabled(current, group, enabled));
    else setDisabledB((current) => setBladeGroupEnabled(current, group, enabled));
  }

  function setSelectedEnabled(key: MachineKey, enabled: boolean): void {
    const selected = key === "A" ? selectedA : selectedB;
    const update = (current: Set<string>) => {
      const next = new Set(current);
      for (const guid of selected) enabled ? next.delete(guid) : next.add(guid);
      return next;
    };
    if (key === "A") setDisabledA(update); else setDisabledB(update);
  }

  function flipSelected(key: MachineKey): void {
    const loaded = key === "A" ? first : second;
    const selected = key === "A" ? selectedA : selectedB;
    if (!loaded) return;
    if (key === "A") setWhatIfA((current) => flipBladeOverrides(loaded.machine, current, selected));
    else setWhatIfB((current) => flipBladeOverrides(loaded.machine, current, selected));
  }

  function applySelectedTransform(key: MachineKey, positionOffset: readonly [number, number, number], rotationOffsetDegrees: readonly [number, number, number]): void {
    const selected = key === "A" ? selectedA : selectedB;
    if (key === "A") setWhatIfA((current) => setBladeTransformOverrides(current, selected, positionOffset, rotationOffsetDegrees));
    else setWhatIfB((current) => setBladeTransformOverrides(current, selected, positionOffset, rotationOffsetDegrees));
  }

  function resetSelectedWhatIf(key: MachineKey): void {
    const selected = key === "A" ? selectedA : selectedB;
    if (key === "A") {
      setWhatIfA((current) => resetBladeOverrides(current, selected));
      setDisabledA((current) => { const next = new Set(current); for (const guid of selected) next.delete(guid); return next; });
    } else {
      setWhatIfB((current) => resetBladeOverrides(current, selected));
      setDisabledB((current) => { const next = new Set(current); for (const guid of selected) next.delete(guid); return next; });
    }
  }

  function resetAllWhatIf(key: MachineKey): void {
    if (key === "A") { setWhatIfA([]); setDisabledA(new Set()); }
    else { setWhatIfB([]); setDisabledB(new Set()); }
  }

  async function exportAnalysis(): Promise<void> {
    if (!bundleA) return;
    try {
      const name = safeFileName(`${bundleA.report.machine.name}${bundleB ? `-vs-${bundleB.report.machine.name}` : ""}-analysis.json`);
      const saved = await getFileIo().saveTextFile({
        suggestedName: name,
        content: JSON.stringify(buildExportPayload(bundleA, bundleB, {
          precision,
          plotLab: plotLabState,
          activeMachine,
          showDeltaPercent,
          bladeGroups: bundleB ? [bladeGroupsA, bladeGroupsB] : [bladeGroupsA],
          snapshots,
        }), null, 2),
        filter: JSON_FILE_FILTER,
      });
      if (saved) flashFileStatus(t("analysis:notices.saved", { path: saved.path ?? saved.name }));
    } catch (cause) {
      setLoadError(t("analysis:errors.exportJson", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  async function importAnalysisJson(): Promise<void> {
    setLoadError("");
    try {
      const opened = await getFileIo().openTextFile({ filter: JSON_FILE_FILTER, title: t("analysis:files.importAnalysis") });
      if (!opened) return;
      const imported = parseAnalysisImport(opened.text);
      setPendingAnalysisImport(imported);
      setMode(imported.mode);
      setActiveMachine(imported.activeMachine);
      setOperatingPoint(imported.operatingPoint);
      if (imported.precision) setPrecision(imported.precision);
      setPlotLabState(imported.plotLab);
      setShowDeltaPercent(imported.showDeltaPercent);
      setSnapshots(imported.snapshots);
      const appliedA = first && imported.machines[0] ? applyImportedMachine("A", first, imported.machines[0]) : false;
      const appliedB = second && imported.machines[1] ? applyImportedMachine("B", second, imported.machines[1]) : false;
      const missing = imported.machines.filter((_, index) => index === 0 ? !appliedA : !appliedB).map((machine) => machine.name);
      const guidWarnings = [
        ...(appliedA && first ? importedGuidWarnings(first, imported.machines[0]) : []),
        ...(appliedB && second && imported.machines[1] ? importedGuidWarnings(second, imported.machines[1]) : []),
      ];
      flashFileStatus(`${missing.length === 0
        ? t("analysis:notices.imported", { path: opened.path ?? opened.name })
        : t("analysis:notices.importedDeferred", { file: opened.name, machines: missing.join(` ${t("analysis:notices.and")} `) })}${guidWarnings.length > 0 ? `. ${t("analysis:notices.warning")}: ${guidWarnings.join("; ")}.` : ""}`);
    } catch (cause) {
      setLoadError(t("analysis:errors.importJson", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  async function importCsv(): Promise<void> {
    setLoadError("");
    try {
      const opened = await getFileIo().openTextFile({ filter: CSV_FILE_FILTER, title: t("plotlab:csv.importDataset") });
      if (!opened) return;
      const table = parseCsv(opened.text);
      const xColumn = table.suggestedXColumn ?? table.numericColumns[0];
      setCsvImportDraft({
        fileName: opened.name,
        table,
        name: opened.name.replace(/\.csv$/i, ""),
        xColumn,
        yColumns: table.suggestedYColumns.filter((column) => column !== xColumn),
      });
    } catch (cause) {
      setLoadError(t("analysis:errors.importCsv", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  function confirmCsvImport(): void {
    if (!csvImportDraft) return;
    try {
      const dataset = buildImportedDataset(csvImportDraft.table, {
        name: csvImportDraft.name,
        sourceFileName: csvImportDraft.fileName,
        xColumn: csvImportDraft.xColumn,
        yColumns: csvImportDraft.yColumns,
      });
      setImportedDatasets([...importedDatasets, dataset]);
      setCsvImportDraft(undefined);
      setTab("plot-lab");
      flashFileStatus(t("analysis:notices.datasetImported", { file: csvImportDraft.fileName }));
    } catch (cause) {
      setLoadError(t("analysis:errors.importCsv", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  function snapshotMachineState(
    loaded: LoadedMachine,
    selection: UiGroupSelection,
    disabled: ReadonlySet<string>,
    groups: readonly BladeGroup[],
    whatIfOverrides: readonly BladeWhatIfOverride[],
  ): SnapshotMachineState {
    return {
      machineName: loaded.machine.name,
      groupSelection: selection,
      cgMode: "auto",
      disabledBladeGuids: [...disabled].sort(),
      bladeGroups: groups,
      whatIfOverrides,
    };
  }

  function captureCurrentState(): AnalysisSessionState {
    if (!first) throw new Error(t("analysis:errors.loadBeforeSnapshot"));
    const machines: SnapshotMachineState[] = [snapshotMachineState(first, groupA, disabledA, bladeGroupsA, whatIfA)];
    if (mode === "compare" && second) machines.push(snapshotMachineState(second, groupB, disabledB, bladeGroupsB, whatIfB));
    return {
      mode,
      activeMachine: mode === "compare" ? activeMachine : "A",
      operatingPoint,
      plotLab: plotLabState,
      showDeltaPercent,
      machines,
    };
  }

  function saveSnapshot(name: string, note: string): void {
    try {
      const snapshot = createSnapshot(sessionId("snapshot"), name, note, new Date().toISOString(), captureCurrentState());
      setSnapshots((current) => [...current, snapshot]);
      flashFileStatus(t("analysis:notices.snapshotSaved", { name: snapshot.name }));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function applySnapshotMachine(key: MachineKey, loaded: LoadedMachine | undefined, state: SnapshotMachineState | undefined): readonly string[] {
    if (!state) return [t("analysis:warnings.snapshotNoMachine", { key })];
    if (!loaded) return [t("analysis:warnings.openToRestore", { name: state.machineName, key })];
    if (!matchesImportedMachine(loaded, state.machineName)) return [t("analysis:warnings.snapshotExpects", { key, loaded: loaded.machine.name, expected: state.machineName })];
    const available = new Set(extractVanillaBlades(loaded.machine).map((blade) => blade.guid));
    const missingDisabled = state.disabledBladeGuids.filter((guid) => !available.has(guid));
    const missingMembers = new Set(state.bladeGroups.flatMap((group) => group.bladeGuids).filter((guid) => !available.has(guid)));
    const missingOverrides = missingBladeWhatIfGuids(loaded.machine, state.whatIfOverrides);
    const group = restoredGroup(loaded, state.groupSelection);
    const warnings: string[] = [];
    if (JSON.stringify(group) !== JSON.stringify(state.groupSelection)) warnings.push(t("analysis:warnings.groupUnavailable", { key }));
    if (missingDisabled.length > 0) warnings.push(t("analysis:warnings.disabledMissing", { key, count: missingDisabled.length }));
    if (missingMembers.size > 0) warnings.push(t("analysis:warnings.groupMembersMissing", { key, count: missingMembers.size }));
    if (missingOverrides.length > 0) warnings.push(t("analysis:warnings.overridesMissing", { key, count: missingOverrides.length }));
    const disabled = restoredDisabledBlades(loaded, state.disabledBladeGuids);
    if (key === "A") {
      setGroupA(group); setDisabledA(disabled); setBladeGroupsA(state.bladeGroups); setWhatIfA(state.whatIfOverrides); setSelectedA(new Set()); setFocusedA(undefined);
    } else {
      setGroupB(group); setDisabledB(disabled); setBladeGroupsB(state.bladeGroups); setWhatIfB(state.whatIfOverrides); setSelectedB(new Set()); setFocusedB(undefined);
    }
    return warnings;
  }

  function restoreSnapshot(snapshot: AnalysisSnapshot): void {
    const state = snapshot.state;
    setMode(state.mode);
    setActiveMachine(state.mode === "compare" ? state.activeMachine : "A");
    setOperatingPoint(state.operatingPoint);
    setPlotLabState(state.plotLab);
    setShowDeltaPercent(state.showDeltaPercent);
    const warnings = [
      ...applySnapshotMachine("A", first, state.machines[0]),
      ...(state.mode === "compare" ? applySnapshotMachine("B", second, state.machines[1]) : []),
    ];
    setTab("overview");
    flashFileStatus(warnings.length > 0 ? `${t("analysis:notices.restored", { name: snapshot.name })}. ${warnings.join(" ")}` : t("analysis:notices.snapshotRestored", { name: snapshot.name }));
  }

  function resolveSnapshotSource(id: "current" | string): ResolvedSnapshotSource {
    const snapshot = id === "current" ? undefined : snapshots.find((candidate) => candidate.id === id);
    const state = snapshot?.state ?? captureCurrentState();
    const label = snapshot?.name ?? t("snapshots:current");
    const machineIndex = state.mode === "compare" && state.activeMachine === "B" ? 1 : 0;
    const machineState = state.machines[machineIndex] ?? state.machines[0];
    const loaded = machineIndex === 1 ? second : first;
    const warnings: string[] = [];
    if (!machineState) return { label, state, warnings: [t("analysis:errors.noMachineState")] };
    if (!loaded) return { label, state, warnings: [t("analysis:warnings.openToCalculate", { name: machineState.machineName })] };
    if (!matchesImportedMachine(loaded, machineState.machineName)) {
      return { label, state, warnings: [t("analysis:warnings.loadedMismatch", { loaded: loaded.machine.name, label, expected: machineState.machineName })] };
    }
    const available = new Set(extractVanillaBlades(loaded.machine).map((blade) => blade.guid));
    const missingDisabled = machineState.disabledBladeGuids.filter((guid) => !available.has(guid));
    const missingMembers = new Set(machineState.bladeGroups.flatMap((group) => group.bladeGuids).filter((guid) => !available.has(guid)));
    const missingOverrides = missingBladeWhatIfGuids(loaded.machine, machineState.whatIfOverrides);
    if (missingDisabled.length > 0) warnings.push(t("analysis:warnings.disabledIgnored", { count: missingDisabled.length }));
    if (missingMembers.size > 0) warnings.push(t("analysis:warnings.membersAbsent", { count: missingMembers.size }));
    if (missingOverrides.length > 0) warnings.push(t("analysis:warnings.overridesIgnored", { count: missingOverrides.length }));
    const selection = restoredGroup(loaded, machineState.groupSelection);
    if (JSON.stringify(selection) !== JSON.stringify(machineState.groupSelection)) warnings.push(t("analysis:warnings.comparisonAll"));
    try {
      const bundle = buildUiAnalysis(
        loaded.machine,
        loaded.discovery,
        selection,
        state.operatingPoint,
        restoredDisabledBlades(loaded, machineState.disabledBladeGuids),
        contribution,
        machineState.whatIfOverrides,
      );
      return { label, state, bundle, warnings };
    } catch (cause) {
      warnings.push(t("analysis:errors.solver", { error: cause instanceof Error ? cause.message : String(cause) }));
      return { label, state, warnings };
    }
  }

  function duplicateSavedSnapshot(snapshot: AnalysisSnapshot): void {
    try {
      const duplicate = duplicateSnapshot(snapshot, sessionId("snapshot"), new Date().toISOString());
      setSnapshots((current) => [...current, duplicate]);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function renameSavedSnapshot(id: string, name: string): void {
    try {
      setSnapshots((current) => renameSnapshot(current, id, name));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function switchMode(next: Mode) { setMode(next); if (next === "single") setActiveMachine("A"); }

  if (!first) {
    return <div className="app-shell import-shell"><main className="loader-main"><section className="loader-copy"><div className="brand-mark import-mark">BA</div><h1>{t("common:app.title")}</h1><p>{t("analysis:landing.description")} <code>.bsg</code>.</p></section><button className="primary-button tutorial-start-button" disabled={tutorialLoading} onClick={() => void startTutorial()}>{tutorialLoading ? t("analysis:tutorial.loading") : t("analysis:tutorial.title")}</button><FileDrop label={t("analysis:machine.bsg")} onFile={(file) => loadFile("A", file)} /><div className="loader-file-actions"><button className="secondary-button" onClick={importAnalysisJson}>{t("analysis:files.importAnalysis")}</button><button className="secondary-button" onClick={importCsv}>{t("plotlab:csv.importDataset")}</button></div>{exportMessage && <div className="import-status" role="status">{exportMessage}</div>}{loadError && <div className="error-box" role="alert">{loadError}</div>}<div className="import-meta"><span>{t("analysis:landing.physicsTarget")}</span><strong>Besiege 1.90-25346</strong><small>{t("analysis:landing.localNote")}</small></div><label className="language-switch"><span>{t("common:language.label")}</span><select value={i18n.resolvedLanguage === "ru" ? "ru" : "en"} onChange={(event) => void setUiLanguage(event.target.value)}><option value="en">English</option><option value="ru">Русский</option></select></label><ModelStatus open={statusOpen} onOpenChange={setStatusOpen} /></main>{csvImportDraft && <CsvImportPanel draft={csvImportDraft} onChange={setCsvImportDraft} onCancel={() => setCsvImportDraft(undefined)} onImport={confirmCsvImport} />}</div>;
  }

  const secondReady = mode === "compare" && Boolean(bundleB);
  const key: MachineKey = activeMachine === "B" && secondReady ? "B" : "A";
  return (
    <div className="app-shell workspace-shell">
      <header className="workspace-header">
        <div className="header-brand"><button className="icon-button" title={t("analysis:layout.toggleSidebar")} aria-label={t("analysis:layout.toggleSidebar")} onClick={() => setSidebarVisible(!sidebarVisible)}>☰</button><div className="brand-mark small">BA</div><div><h1>{t("common:app.title")}</h1><p>{t("common:app.subtitle")}</p></div></div>
        <div className="segmented" aria-label={t("analysis:mode.label")}><button className={mode === "single" ? "active" : ""} onClick={() => switchMode("single")}>{t("analysis:mode.single")}</button><button className={mode === "compare" ? "active" : ""} onClick={() => switchMode("compare")}>{t("analysis:mode.compare")}</button></div>
        <div className="header-actions">{exportMessage && <span className="export-status" role="status">{exportMessage}</span>}<button className="secondary-button compact-button" disabled={tutorialLoading} onClick={() => void startTutorial()}>{t("analysis:tutorial.title")}</button><details className="file-actions-menu"><summary className="primary-button">{t("common:actions.import")} / {t("common:actions.export")}</summary><div><button onClick={importAnalysisJson}>{t("common:actions.import")} JSON</button><button onClick={importCsv}>{t("common:actions.import")} CSV</button><span></span><button disabled={!bundleA || (mode === "compare" && !bundleB)} onClick={exportAnalysis}>{t("analysis:files.exportAnalysis")}</button><small>{t("plotlab:files.available")}</small></div></details></div>
      </header>
      {loadError && <div className="global-error" role="alert">{loadError}<button onClick={() => setLoadError("")}>×</button></div>}
      {(analysisA.error || (mode === "compare" && analysisB.error)) && <div className="global-error" role="alert">{analysisA.error ?? analysisB.error}</div>}
      <div className={`workspace-grid ${sidebarVisible ? "" : "sidebar-hidden"}`}>
        {sidebarVisible && <aside className="sidebar">
          <section className="sidebar-section machine-section">
            <div className="section-heading"><span>{mode === "compare" ? t("analysis:machine.plural") : t("analysis:machine.singular")}</span><span className="section-code">{t("analysis:machine.local")}</span></div>
            <FileDrop label={mode === "compare" ? t("analysis:machine.aUpper") : t("analysis:machine.upper")} compact tone="A" fileName={first.fileName} machineName={first.machine.name} details={t("analysis:machine.details", { count: first.machine.blocks.length, version: first.machine.bsgVersion })} onFile={(file) => loadFile("A", file)} tutorialId="machine-file" />
            <GroupSelector discovery={first.discovery} value={groupA} onChange={(selection) => changeGroup("A", selection)} />
            <small className="selection-note">{t("analysis:group.using")}: {groupLabel(groupA, t)}</small>
            {mode === "compare" && <div className="machine-b-stack"><FileDrop label={t("analysis:machine.bUpper")} compact tone="B" fileName={second?.fileName} machineName={second?.machine.name} details={second ? t("analysis:machine.details", { count: second.machine.blocks.length, version: second.machine.bsgVersion }) : undefined} onFile={(file) => loadFile("B", file)} />{second && <><GroupSelector discovery={second.discovery} value={groupB} onChange={(selection) => changeGroup("B", selection)} /><small className="selection-note">{t("analysis:group.using")}: {groupLabel(groupB, t)}</small></>}</div>}
          </section>
          <OperatingControls value={operatingPoint} onChange={setOperatingPoint} />
          <section className="sidebar-section settings-section"><div className="section-heading"><span>{t("analysis:settings.title")}</span></div><label className="select-field"><span>{t("common:language.label")}</span><select value={i18n.resolvedLanguage === "ru" ? "ru" : "en"} onChange={(event) => void setUiLanguage(event.target.value)}><option value="en">English</option><option value="ru">Русский</option></select></label><label className="select-field"><span>{t("analysis:settings.precision")}</span><select value={precision} onChange={(event) => setPrecision(event.target.value as PrecisionMode)}><option value="auto">{t("analysis:settings.auto")}</option><option value="3">{t("analysis:settings.three")}</option><option value="6">{t("analysis:settings.six")}</option></select></label></section>
          <ModelStatus open={statusOpen} onOpenChange={setStatusOpen} />
        </aside>}
        <main className="workspace-main">
          {mode === "compare" && !second && <section className="compare-empty"><div><span className="panel-kicker">{t("analysis:mode.compareMode")}</span><h2>{t("analysis:machine.loadB")}</h2><p>{t("analysis:comparison.loadHelp")}</p></div><FileDrop label={t("analysis:machine.bUpper")} onFile={(file) => loadFile("B", file)} /></section>}
          <nav className="tabbar" aria-label={t("analysis:tabs.aria")}>{TABS.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>{t(`analysis:${item.labelKey}` as never)}</button>)}</nav>
          <div className="tab-context"><div><span className="context-mode">{t(`analysis:mode.${mode}` as never)}</span><div className="context-title"><strong>{t(`analysis:${TABS.find((item) => item.key === tab)?.labelKey}` as never)}</strong><small>{activeLoaded?.machine.name} · {groupLabel(activeGroup, t)}</small></div></div>{mode === "compare" && <ActiveMachineSwitch value={key} secondAvailable={secondReady} onChange={setActiveMachine} />}</div>
          {bundleA && tab === "overview" && <div className="view-stack"><div className={bundleB ? "summary-pair" : ""}><MachineSummary bundle={bundleA} precision={precision} label={bundleB ? "A" : undefined} />{bundleB && <MachineSummary bundle={bundleB} precision={precision} label="B" />}</div>{bundleB ? <><ComparisonTable first={bundleA} second={bundleB} precision={precision} showPercent={showDeltaPercent} onShowPercentChange={setShowDeltaPercent} /><div className="machine-result-pair"><div><div className="pair-title">{t("analysis:machine.aUpper")} · {bundleA.report.machine.name}</div><BaselinePanel bundle={bundleA} precision={precision} /><DerivativesPanel bundle={bundleA} precision={precision} /></div><div><div className="pair-title">{t("analysis:machine.bUpper")} · {bundleB.report.machine.name}</div><BaselinePanel bundle={bundleB} precision={precision} /><DerivativesPanel bundle={bundleB} precision={precision} /></div></div></> : <><BaselinePanel bundle={bundleA} precision={precision} /><DerivativesPanel bundle={bundleA} precision={precision} /></>}</div>}
          {bundleA && tab === "sweeps" && <div className="view-stack sweep-page" data-tutorial="sweeps">
            <section className="sweep-controls data-panel"><div><span className="panel-kicker">{t("analysis:sweeps.title")}</span><strong>{t("analysis:sweeps.live")}</strong><small>{t("analysis:sweeps.samples")}</small></div><MetricSelector label={t("analysis:sweeps.alphaQuantity")} value={alphaMetric} onChange={setAlphaMetric} /><MetricSelector label={t("analysis:sweeps.betaQuantity")} value={betaMetric} onChange={setBetaMetric} /><details className="sweep-visibility"><summary>{t("analysis:sweeps.visible")}</summary><div>{([['alpha', 'alpha'], ['pitchQ', 'pitchQ'], ['beta', 'beta'], ['yawR', 'yawR'], ['rollP', 'rollP']] as const).map(([graph, label]) => <label key={graph}><input type="checkbox" checked={standardGraphs[graph]} onChange={(event) => setStandardGraphs({ ...standardGraphs, [graph]: event.target.checked })} /> {t(`analysis:sweeps.${label}`)}</label>)}</div></details></section>
            {(standardGraphs.alpha || standardGraphs.pitchQ) && <><div className="analysis-band"><span>{t("analysis:sweeps.longitudinal")}</span><small>{t("analysis:sweeps.longitudinalHelp")}</small></div><div className="charts-grid longitudinal-grid">
              {standardGraphs.alpha && <SweepChart tutorialId="alpha-sweep" title={t("analysis:sweeps.alpha")} help={t("analysis:sweeps.help.alpha")} xLabel={t("analysis:sweeps.xAlpha")} centralValue={operatingPoint.alphaDegrees} first={sweepChartMachine(first!, bundleA, "alpha")} second={bundleB && second ? sweepChartMachine(second, bundleB, "alpha") : undefined} metric={alphaMetric} precision={precision} stickyDomain={stickySweepDomains.alpha} onStickyDomainChange={(domain) => updateStickySweepDomain("alpha", domain)} />}
              {standardGraphs.pitchQ && <SweepChart tutorialId="pitch-q-sweep" title={t("analysis:sweeps.pitchQ")} help={t("analysis:sweeps.help.pitchQ")} xLabel={t("analysis:sweeps.xPitchQ")} centralValue={operatingPoint.q} first={sweepChartMachine(first!, bundleA, "q")} second={bundleB && second ? sweepChartMachine(second, bundleB, "q") : undefined} metric="pitch" precision={precision} stickyDomain={stickySweepDomains.pitchQ} onStickyDomainChange={(domain) => updateStickySweepDomain("pitchQ", domain)} />}
            </div></>}
            {(standardGraphs.beta || standardGraphs.yawR || standardGraphs.rollP) && <><div className="analysis-band"><span>{t("analysis:sweeps.lateral")}</span><small>{t("analysis:sweeps.lateralHelp")}</small></div><div className="charts-grid lateral-grid">
              {standardGraphs.beta && <SweepChart tutorialId="beta-sweep" title={t("analysis:sweeps.beta")} help={t("analysis:sweeps.help.beta")} xLabel={t("analysis:sweeps.xBeta")} centralValue={operatingPoint.betaDegrees} first={sweepChartMachine(first!, bundleA, "beta")} second={bundleB && second ? sweepChartMachine(second, bundleB, "beta") : undefined} metric={betaMetric} precision={precision} stickyDomain={stickySweepDomains.beta} onStickyDomainChange={(domain) => updateStickySweepDomain("beta", domain)} />}
              {standardGraphs.yawR && <SweepChart tutorialId="yaw-r-sweep" title={t("analysis:sweeps.yawR")} help={t("analysis:sweeps.help.yawR")} xLabel={t("analysis:sweeps.xYawR")} centralValue={operatingPoint.r} first={sweepChartMachine(first!, bundleA, "r")} second={bundleB && second ? sweepChartMachine(second, bundleB, "r") : undefined} metric="yaw" precision={precision} stickyDomain={stickySweepDomains.yawR} onStickyDomainChange={(domain) => updateStickySweepDomain("yawR", domain)} />}
              {standardGraphs.rollP && <SweepChart tutorialId="roll-p-sweep" title={t("analysis:sweeps.rollP")} help={t("analysis:sweeps.help.rollP")} xLabel={t("analysis:sweeps.xRollP")} centralValue={operatingPoint.p} first={sweepChartMachine(first!, bundleA, "p")} second={bundleB && second ? sweepChartMachine(second, bundleB, "p") : undefined} metric="roll" precision={precision} stickyDomain={stickySweepDomains.rollP} onStickyDomainChange={(domain) => updateStickySweepDomain("rollP", domain)} />}
            </div></>}
            {!Object.values(standardGraphs).some(Boolean) && <section className="data-panel empty-standard-graphs">{t("analysis:sweeps.hidden")}</section>}
          </div>}
          {bundleA && tab === "plot-lab" && <PlotLab first={bundleA} second={bundleB} precision={precision} state={plotLabState} onStateChange={setPlotLabState} importedDatasets={importedDatasets} onImportedDatasetsChange={setImportedDatasets} />}
          {activeBundle && activeLoaded && tab === "blades" && <div className="view-stack"><WhatIfPanel sourceMachine={activeLoaded.machine} bundle={activeBundle} precision={precision} selectedGuids={activeSelected} disabledGuids={activeBundle.report.disabledBladeGuids} overrides={activeWhatIf} onSetEnabled={(enabled) => setSelectedEnabled(key, enabled)} onFlip={() => flipSelected(key)} onApplyTransform={(position, rotation) => applySelectedTransform(key, position, rotation)} onResetSelected={() => resetSelectedWhatIf(key)} onResetAll={() => resetAllWhatIf(key)} /><BladeGroupsPanel bundle={activeBundle} precision={precision} groups={activeBladeGroups} disabledGuids={activeBundle.report.disabledBladeGuids} selectedGuids={activeSelected} onCreate={(name) => createGroup(key, name)} onRename={(id, name) => renameGroup(key, id, name)} onDelete={(id) => removeGroup(key, id)} onSelect={(guids) => (key === "A" ? setSelectedA : setSelectedB)(new Set(guids))} onSetEnabled={(group, enabled) => setGroupEnabled(key, group, enabled)} /><BladeTable bundle={activeBundle} precision={precision} selectedGuids={activeSelected} focusedGuid={activeFocused} onSelectionChange={key === "A" ? setSelectedA : setSelectedB} onFocus={focusActive} onEnabledChange={(guid, enabled) => setBladeEnabled(key, guid, enabled)} onEnableAll={() => enableAll(key)} onDisableSelected={() => disableSelected(key)} onReset={() => resetBlades(key)} /></div>}
          {activeBundle && tab === "contributions" && <div className="view-stack"><section className="data-panel contribution-selector"><label>{t("analysis:contributions.to")} <InfoTooltip label={t("analysis:contributions.about")}>{t("analysis:contributions.help")}</InfoTooltip><select value={contribution} onChange={(event) => setContribution(event.target.value as ContributionDerivative)}>{CONTRIBUTIONS.map((item) => <option key={item.value} value={item.value}>{t(`analysis:${item.labelKey}` as never)}</option>)}</select></label><span>{t("analysis:contributions.sorted")}</span></section><ContributionTable bundle={activeBundle} precision={precision} tone={key} onFocus={focusActive} /></div>}
          {activeBundle && tab === "components" && <ComponentsView bundle={activeBundle} precision={precision} onSelect={(selection) => changeGroup(key, selection)} />}
          {activeBundle && activeLoaded && tab === "viewer" && <ThreeViewer sourceMachine={activeLoaded.machine} bundle={activeBundle} precision={precision} selectedGuids={activeSelected} focusedGuid={activeFocused} toggles={viewerToggles} displayMode={viewerDisplayMode} onToggle={setViewerToggles} onDisplayModeChange={setViewerDisplayMode} onSelectionChange={key === "A" ? setSelectedA : setSelectedB} onFocusChange={focusActive} onDisableSelected={() => disableSelected(key)} bladeGroups={activeBladeGroups} onCreateBladeGroup={(name) => createGroup(key, name)} onRenameBladeGroup={(id, name) => renameGroup(key, id, name)} onDeleteBladeGroup={(id) => removeGroup(key, id)} onSetBladeGroupEnabled={(group, enabled) => setGroupEnabled(key, group, enabled)} whatIfOverrides={activeWhatIf} onSetSelectedEnabled={(enabled) => setSelectedEnabled(key, enabled)} onFlipSelected={() => flipSelected(key)} onApplySelectedTransform={(position, rotation) => applySelectedTransform(key, position, rotation)} onResetSelectedWhatIf={() => resetSelectedWhatIf(key)} onResetAllWhatIf={() => resetAllWhatIf(key)} />}
          {bundleA && tab === "snapshots" && <SnapshotsPanel snapshots={snapshots} currentState={captureCurrentState()} precision={precision} onSave={saveSnapshot} onRestore={restoreSnapshot} onDuplicate={duplicateSavedSnapshot} onRename={renameSavedSnapshot} onDelete={(id) => setSnapshots((current) => current.filter((snapshot) => snapshot.id !== id))} resolveSource={resolveSnapshotSource} tutorialDefaultName={tutorialStep?.id === "snapshot" ? "Baseline" : undefined} tutorialCompareSnapshotId={tutorialStep?.id === "snapshot-compare" ? baselineSnapshot?.id : undefined} />}
        </main>
      </div>
      {csvImportDraft && <CsvImportPanel draft={csvImportDraft} onChange={setCsvImportDraft} onCancel={() => setCsvImportDraft(undefined)} onImport={confirmCsvImport} />}
      {tutorialStepIndex !== null && <TutorialOverlay
        stepIndex={tutorialStepIndex}
        progress={{
          selectedBladeCount: selectedA.size,
          bladeGroupCount: bladeGroupsA.length,
          largestBladeGroupSize: Math.max(0, ...bladeGroupsA.map((group) => group.bladeGuids.length)),
          hasBaselineSnapshot: Boolean(baselineSnapshot),
          whatIfChanged: disabledA.size > 0 || whatIfA.length > 0,
          pitchDampingExample: bundleA?.report.stability.derivatives.damping.pitchQ.derivative ?? null,
        }}
        onStepChange={setTutorialStepIndex}
        onSkip={() => setTutorialStepIndex(null)}
        onFinish={() => setTutorialStepIndex(null)}
        onOpenAircraft={openAircraftFromTutorial}
      />}
    </div>
  );
}
