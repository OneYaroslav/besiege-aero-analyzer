import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ComponentsView } from "./components/ComponentsView.tsx";
import { ContributionTable } from "./components/ContributionTable.tsx";
import { OperatingControls } from "./components/Controls.tsx";
import { FileDrop } from "./components/FileDrop.tsx";
import { InfoTooltip } from "./components/InfoTooltip.tsx";
import { BaselinePanel, DerivativesPanel, MachineSummary } from "./components/Overview.tsx";
import { PlotLab } from "./components/PlotLab.tsx";
import { SWEEP_METRICS, SweepChart, type SweepMetric } from "./components/SweepChart.tsx";
import { DEFAULT_VIEWER_TOGGLES, ThreeViewer, type ViewerToggles } from "./components/ThreeViewer.tsx";
import { CSV_FILE_FILTER, JSON_FILE_FILTER, getFileIo, safeFileName } from "./file-io.ts";

type Mode = "single" | "compare";
type MachineKey = "A" | "B";
type Tab = "overview" | "sweeps" | "plot-lab" | "blades" | "contributions" | "components" | "viewer";

interface LoadedMachine {
  readonly fileName: string;
  readonly machine: BsgMachine;
  readonly discovery: MachineDiscovery;
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

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "sweeps", label: "Sweeps" },
  { key: "plot-lab", label: "Plot Lab" },
  { key: "blades", label: "Blades" },
  { key: "contributions", label: "Contributions" },
  { key: "components", label: "Components" },
  { key: "viewer", label: "3D View · Experimental" },
];

const CONTRIBUTIONS: ReadonlyArray<{ value: ContributionDerivative; label: string }> = [
  { value: "pitch-damping", label: "Pitch damping · dM_pitch/dq" },
  { value: "yaw-damping", label: "Yaw damping · dM_yaw/dr" },
  { value: "roll-damping", label: "Roll damping · dM_roll/dp" },
  { value: "pitch-alpha", label: "Pitch static · dM_pitch/dAlpha" },
  { value: "yaw-beta", label: "Yaw static · dM_yaw/dBeta" },
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
): { bundle?: UiAnalysisBundle; error?: string } {
  if (!loaded) return {};
  try {
    return { bundle: buildUiAnalysis(loaded.machine, loaded.discovery, group, operatingPoint, disabled, contribution) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function groupLabel(selection: UiGroupSelection): string {
  if (selection.kind === "all") return "All machine blocks";
  if (selection.kind === "aircraft") return "Aircraft heuristic · Estimated";
  return `Spatial component ${selection.index} · Estimated`;
}

function GroupSelector({ discovery, value, onChange }: { discovery: MachineDiscovery; value: UiGroupSelection; onChange: (value: UiGroupSelection) => void }) {
  const serialized = value.kind === "component" ? `component:${value.index}` : value.kind;
  return (
    <label className="select-field group-select">
      <span>Analysis group <InfoTooltip label="About estimated analysis groups">Spatially inferred groups are estimates, not a verified Besiege runtime joint graph.</InfoTooltip></span>
      <select aria-label="Analysis group" value={serialized} onChange={(event) => {
        if (event.target.value === "all") onChange({ kind: "all" });
        else if (event.target.value === "aircraft") onChange({ kind: "aircraft" });
        else onChange({ kind: "component", index: Number(event.target.value.split(":")[1]) });
      }}>
        <option value="all">All machine blocks</option>
        <option value="aircraft">Aircraft heuristic — Estimated</option>
        {discovery.components.filter((component) => !component.suggestedAircraft).map((component) => (
          <option key={component.index} value={`component:${component.index}`}>Component {component.index} — Estimated</option>
        ))}
      </select>
    </label>
  );
}

function ActiveMachineSwitch({ value, secondAvailable, onChange }: { value: MachineKey; secondAvailable: boolean; onChange: (value: MachineKey) => void }) {
  if (!secondAvailable) return null;
  return <div className="segmented compact" aria-label="Active machine"><button className={value === "A" ? "active" : ""} onClick={() => onChange("A")}>Machine A</button><button className={value === "B" ? "active" : ""} onClick={() => onChange("B")}>Machine B</button></div>;
}

function ComparisonTable({ first, second, precision, showPercent, onShowPercentChange }: { first: UiAnalysisBundle; second: UiAnalysisBundle; precision: PrecisionMode; showPercent: boolean; onShowPercentChange: (value: boolean) => void }) {
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
      <div className="panel-title comparison-title"><span>NUMERICAL COMPARISON</span><small>same operating point · Δ = B − A · no ranking</small><label><input type="checkbox" checked={showPercent} onChange={(event) => onShowPercentChange(event.target.checked)} /> Show Δ%</label></div>
      <div className="table-scroll"><table className="engineering-table comparison-table">
        <thead><tr><th>Quantity</th><th>Units</th><th className="machine-a-text">A · {first.report.machine.name}</th><th className="machine-b-text">B · {second.report.machine.name}</th><th>Δ B − A</th>{showPercent && <th>Δ% vs A</th>}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}><th>{row.label}</th><td>{row.units}</td><td title={JSON.stringify(row.first)}>{display(row.first)}</td><td title={JSON.stringify(row.second)}>{display(row.second)}</td><td className="delta-cell">{delta(row.first, row.second)}</td>{showPercent && <td className="delta-percent-cell">{percent(row.first, row.second)}</td>}</tr>)}</tbody>
      </table></div>
    </section>
  );
}

function MetricSelector({ label, value, onChange }: { label: string; value: SweepMetric; onChange: (value: SweepMetric) => void }) {
  return <label className="inline-select">{label}<select value={value} onChange={(event) => onChange(event.target.value as SweepMetric)}>{Object.entries(SWEEP_METRICS).map(([key, metric]) => <option key={key} value={key}>{metric.label}</option>)}</select></label>;
}

function ModelStatus({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  return (
    <details className="model-status" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>Model status & assumptions</summary>
      <div className="model-status-grid">
        <span>Blade force law</span><strong className="status-recovered">RECOVERED</strong>
        <span>Component grouping</span><strong className="status-estimated">HEURISTIC</strong>
        <span>Center of gravity</span><strong>APPROXIMATE</strong>
        <span>SI conversion</span><strong>NOT AVAILABLE</strong>
      </div>
      <ul>
        <li>Vanilla Propeller id=26 and SmallPropeller id=55 use the recovered Besiege 1.90-25346 AxialDrag law.</li>
        <li>Spatial components are estimates, not a verified runtime joint graph.</li>
        <li>CG is approximate where runtime Rigidbody COM or mass overrides are unavailable.</li>
        <li>No SI conversion, multibody dynamics, inertia time response, or control actuation is modeled.</li>
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
  const yCandidates = draft.table.numericColumns.filter((column) => column !== draft.xColumn);
  return <div className="modal-backdrop" role="presentation"><section className="data-panel csv-import-panel" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
    <div className="csv-import-title"><div><span className="panel-kicker">IMPORT CSV</span><strong id="csv-import-title">Configure external dataset</strong><small>{draft.fileName} · {draft.table.rows.length} rows</small></div><button className="icon-button" aria-label="Cancel CSV import" onClick={onCancel}>×</button></div>
    <label className="select-field"><span>Dataset name</span><input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
    <label className="select-field"><span>X column</span><select value={draft.xColumn} onChange={(event) => {
      const xColumn = event.target.value;
      onChange({ ...draft, xColumn, yColumns: draft.yColumns.filter((column) => column !== xColumn) });
    }}>{draft.table.numericColumns.map((column) => <option key={column} value={column}>{column} · {draft.table.units[column]}</option>)}</select></label>
    <fieldset className="csv-y-columns"><legend>Y columns</legend>{yCandidates.map((column) => <label key={column}><input type="checkbox" checked={draft.yColumns.includes(column)} onChange={(event) => onChange({ ...draft, yColumns: event.target.checked ? [...draft.yColumns, column] : draft.yColumns.filter((candidate) => candidate !== column) })} /> <span>{column}</span><small>{draft.table.units[column]}</small></label>)}{yCandidates.length === 0 && <p>No additional numeric column is available for Y.</p>}</fieldset>
    <div className="csv-import-actions"><small>Imported values are visualization-only and are never passed to the solver.</small><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={!draft.name.trim() || draft.yColumns.length === 0} onClick={onImport}>Import dataset</button></div>
  </section></div>;
}

export function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [first, setFirst] = useState<LoadedMachine>();
  const [second, setSecond] = useState<LoadedMachine>();
  const [groupA, setGroupA] = useState<UiGroupSelection>({ kind: "all" });
  const [groupB, setGroupB] = useState<UiGroupSelection>({ kind: "all" });
  const [disabledA, setDisabledA] = useState<Set<string>>(() => new Set());
  const [disabledB, setDisabledB] = useState<Set<string>>(() => new Set());
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
  const [viewerToggles, setViewerToggles] = useStoredState<ViewerToggles>("baa:viewer-toggles", DEFAULT_VIEWER_TOGGLES);
  const [standardGraphs, setStandardGraphs] = useStoredState<StandardGraphVisibility>("baa:standard-graphs", DEFAULT_STANDARD_GRAPHS);
  const [showDeltaPercent, setShowDeltaPercent] = useStoredState<boolean>("baa:show-delta-percent", false);

  const analysisA = useMemo(() => analyzeLoaded(first, groupA, operatingPoint, disabledA, contribution), [first, groupA, operatingPoint, disabledA, contribution]);
  const analysisB = useMemo(() => analyzeLoaded(second, groupB, operatingPoint, disabledB, contribution), [second, groupB, operatingPoint, disabledB, contribution]);
  const bundleA = analysisA.bundle;
  const bundleB = mode === "compare" ? analysisB.bundle : undefined;
  const activeBundle = activeMachine === "B" && bundleB ? bundleB : bundleA;
  const activeLoaded = activeMachine === "B" && second ? second : first;
  const activeGroup = activeMachine === "B" ? groupB : groupA;
  const activeSelected = activeMachine === "B" ? selectedB : selectedA;
  const activeFocused = activeMachine === "B" ? focusedB : focusedA;
  const focusActive = useCallback((guid: string) => { if (activeMachine === "B") setFocusedB(guid); else setFocusedA(guid); }, [activeMachine]);

  function flashFileStatus(message: string): void {
    setExportMessage(message);
    window.setTimeout(() => setExportMessage(""), 5_000);
  }

  function matchesImportedMachine(loaded: LoadedMachine, expectedName: string): boolean {
    const normalize = (value: string) => value.replace(/\.bsg$/i, "").trim().toLocaleLowerCase();
    const expected = normalize(expectedName);
    return normalize(loaded.machine.name) === expected || normalize(loaded.fileName) === expected;
  }

  function restoredGroup(loaded: LoadedMachine, requested: UiGroupSelection): UiGroupSelection {
    if (requested.kind !== "component") return requested;
    return loaded.discovery.components.some((component) => component.index === requested.index) ? requested : { kind: "all" };
  }

  function restoredDisabledBlades(loaded: LoadedMachine, requested: readonly string[]): Set<string> {
    const available = new Set(extractVanillaBlades(loaded.machine).map((blade) => blade.guid));
    return new Set(requested.filter((guid) => available.has(guid)));
  }

  function applyImportedMachine(key: MachineKey, loaded: LoadedMachine, imported: ImportedAnalysisState["machines"][number]): boolean {
    if (!matchesImportedMachine(loaded, imported.name)) return false;
    const group = restoredGroup(loaded, imported.groupSelection);
    const disabled = restoredDisabledBlades(loaded, imported.disabledBladeGuids);
    if (key === "A") { setGroupA(group); setDisabledA(disabled); setSelectedA(new Set()); setFocusedA(undefined); }
    else { setGroupB(group); setDisabledB(disabled); setSelectedB(new Set()); setFocusedB(undefined); }
    return true;
  }

  async function loadFile(key: MachineKey, file: File) {
    setLoadError("");
    try {
      const machine = parseBsg(await file.text(), file.name);
      const loaded = { fileName: file.name, machine, discovery: discoverMachine(machine) } satisfies LoadedMachine;
      const importedMachine = pendingAnalysisImport?.machines[key === "A" ? 0 : 1];
      const restored = importedMachine ? applyImportedMachine(key, loaded, importedMachine) : false;
      if (key === "A") {
        setFirst(loaded);
        if (!restored) { setGroupA({ kind: "all" }); setDisabledA(new Set()); setSelectedA(new Set()); setFocusedA(undefined); }
      } else {
        setSecond(loaded);
        if (!restored) { setGroupB({ kind: "all" }); setDisabledB(new Set()); setSelectedB(new Set()); setFocusedB(undefined); }
      }
      if (importedMachine) flashFileStatus(restored ? `Imported analysis state applied to ${loaded.machine.name}` : `Loaded ${loaded.machine.name}; imported state expects ${importedMachine.name}`);
    } catch (cause) {
      setLoadError(`${key === "A" ? "Machine A" : "Machine B"}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  function changeGroup(key: MachineKey, selection: UiGroupSelection) {
    if (key === "A") { setGroupA(selection); setDisabledA(new Set()); setSelectedA(new Set()); }
    else { setGroupB(selection); setDisabledB(new Set()); setSelectedB(new Set()); }
  }

  function setBladeEnabled(key: MachineKey, guid: string, enabled: boolean) {
    const update = (current: Set<string>) => { const next = new Set(current); if (enabled) next.delete(guid); else next.add(guid); return next; };
    if (key === "A") setDisabledA(update); else setDisabledB(update);
  }
  function enableAll(key: MachineKey) { if (key === "A") setDisabledA(new Set()); else setDisabledB(new Set()); }
  function disableSelected(key: MachineKey) { if (key === "A") setDisabledA((current) => new Set([...current, ...selectedA])); else setDisabledB((current) => new Set([...current, ...selectedB])); }
  function resetBlades(key: MachineKey) { enableAll(key); if (key === "A") setSelectedA(new Set()); else setSelectedB(new Set()); }

  async function exportAnalysis(): Promise<void> {
    if (!bundleA) return;
    try {
      const name = safeFileName(`${bundleA.report.machine.name}${bundleB ? `-vs-${bundleB.report.machine.name}` : ""}-analysis.json`);
      const saved = await getFileIo().saveTextFile({
        suggestedName: name,
        content: JSON.stringify(buildExportPayload(bundleA, bundleB, { precision, plotLab: plotLabState }), null, 2),
        filter: JSON_FILE_FILTER,
      });
      if (saved) flashFileStatus(`Saved: ${saved.path ?? saved.name}`);
    } catch (cause) {
      setLoadError(`Export JSON failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function importAnalysisJson(): Promise<void> {
    setLoadError("");
    try {
      const opened = await getFileIo().openTextFile({ filter: JSON_FILE_FILTER, title: "Import analysis JSON" });
      if (!opened) return;
      const imported = parseAnalysisImport(opened.text);
      setPendingAnalysisImport(imported);
      setMode(imported.mode);
      setActiveMachine("A");
      setOperatingPoint(imported.operatingPoint);
      if (imported.precision) setPrecision(imported.precision);
      setPlotLabState(imported.plotLab);
      const appliedA = first && imported.machines[0] ? applyImportedMachine("A", first, imported.machines[0]) : false;
      const appliedB = second && imported.machines[1] ? applyImportedMachine("B", second, imported.machines[1]) : false;
      const missing = imported.machines.filter((_, index) => index === 0 ? !appliedA : !appliedB).map((machine) => machine.name);
      flashFileStatus(missing.length === 0
        ? `Imported: ${opened.path ?? opened.name}`
        : `Imported settings from ${opened.name}; open ${missing.join(" and ")} .bsg to apply machine-specific state`);
    } catch (cause) {
      setLoadError(`Import JSON failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function importCsv(): Promise<void> {
    setLoadError("");
    try {
      const opened = await getFileIo().openTextFile({ filter: CSV_FILE_FILTER, title: "Import CSV dataset" });
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
      setLoadError(`Import CSV failed: ${cause instanceof Error ? cause.message : String(cause)}`);
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
      flashFileStatus(`Imported dataset: ${csvImportDraft.fileName}`);
    } catch (cause) {
      setLoadError(`Import CSV failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  function switchMode(next: Mode) { setMode(next); if (next === "single") setActiveMachine("A"); }

  if (!first) {
    return <div className="app-shell import-shell"><main className="loader-main"><section className="loader-copy"><div className="brand-mark import-mark">BA</div><h1>Besiege Aero Analyzer</h1><p>Analyze aerodynamic forces, moments and stability directly from a local Besiege <code>.bsg</code> machine.</p></section><FileDrop label="BSG MACHINE" onFile={(file) => loadFile("A", file)} /><div className="loader-file-actions"><button className="secondary-button" onClick={importAnalysisJson}>Import analysis JSON</button><button className="secondary-button" onClick={importCsv}>Import CSV dataset</button></div>{exportMessage && <div className="import-status" role="status">{exportMessage}</div>}{loadError && <div className="error-box" role="alert">{loadError}</div>}<div className="import-meta"><span>RECOVERED PHYSICS TARGET</span><strong>Besiege 1.90-25346</strong><small>Processed locally · the machine file is not uploaded or persisted</small></div><ModelStatus open={statusOpen} onOpenChange={setStatusOpen} /></main>{csvImportDraft && <CsvImportPanel draft={csvImportDraft} onChange={setCsvImportDraft} onCancel={() => setCsvImportDraft(undefined)} onImport={confirmCsvImport} />}</div>;
  }

  const secondReady = mode === "compare" && Boolean(bundleB);
  const key: MachineKey = activeMachine === "B" && secondReady ? "B" : "A";
  return (
    <div className="app-shell workspace-shell">
      <header className="workspace-header">
        <div className="header-brand"><button className="icon-button" title="Toggle settings sidebar" aria-label="Toggle settings sidebar" onClick={() => setSidebarVisible(!sidebarVisible)}>☰</button><div className="brand-mark small">BA</div><div><h1>Besiege Aero Analyzer</h1><p>engineering analysis workspace</p></div></div>
        <div className="segmented" aria-label="Analysis mode"><button className={mode === "single" ? "active" : ""} onClick={() => switchMode("single")}>SINGLE</button><button className={mode === "compare" ? "active" : ""} onClick={() => switchMode("compare")}>COMPARE</button></div>
        <div className="header-actions">{exportMessage && <span className="export-status" role="status">{exportMessage}</span>}<details className="file-actions-menu"><summary className="primary-button">Import / Export</summary><div><button onClick={importAnalysisJson}>Import JSON</button><button onClick={importCsv}>Import CSV</button><span></span><button disabled={!bundleA || (mode === "compare" && !bundleB)} onClick={exportAnalysis}>Export Analysis JSON</button><small>Plot CSV/JSON exports are available in Plot Lab.</small></div></details></div>
      </header>
      {loadError && <div className="global-error" role="alert">{loadError}<button onClick={() => setLoadError("")}>×</button></div>}
      {(analysisA.error || (mode === "compare" && analysisB.error)) && <div className="global-error" role="alert">{analysisA.error ?? analysisB.error}</div>}
      <div className={`workspace-grid ${sidebarVisible ? "" : "sidebar-hidden"}`}>
        {sidebarVisible && <aside className="sidebar">
          <section className="sidebar-section machine-section">
            <div className="section-heading"><span>{mode === "compare" ? "Machines" : "Machine"}</span><span className="section-code">LOCAL</span></div>
            <FileDrop label={mode === "compare" ? "MACHINE A" : "MACHINE"} compact tone="A" fileName={first.fileName} machineName={first.machine.name} details={`${first.machine.blocks.length} blocks · BSG ${first.machine.bsgVersion}`} onFile={(file) => loadFile("A", file)} />
            <GroupSelector discovery={first.discovery} value={groupA} onChange={(selection) => changeGroup("A", selection)} />
            <small className="selection-note">Using: {groupLabel(groupA)}</small>
            {mode === "compare" && <div className="machine-b-stack"><FileDrop label="MACHINE B" compact tone="B" fileName={second?.fileName} machineName={second?.machine.name} details={second ? `${second.machine.blocks.length} blocks · BSG ${second.machine.bsgVersion}` : undefined} onFile={(file) => loadFile("B", file)} />{second && <><GroupSelector discovery={second.discovery} value={groupB} onChange={(selection) => changeGroup("B", selection)} /><small className="selection-note">Using: {groupLabel(groupB)}</small></>}</div>}
          </section>
          <OperatingControls value={operatingPoint} onChange={setOperatingPoint} />
          <section className="sidebar-section settings-section"><div className="section-heading"><span>Settings</span></div><label className="select-field"><span>Number precision</span><select value={precision} onChange={(event) => setPrecision(event.target.value as PrecisionMode)}><option value="auto">Auto</option><option value="3">3 decimals</option><option value="6">6 decimals</option></select></label></section>
          <ModelStatus open={statusOpen} onOpenChange={setStatusOpen} />
        </aside>}
        <main className="workspace-main">
          {mode === "compare" && !second && <section className="compare-empty"><div><span className="panel-kicker">COMPARE MODE</span><h2>Load Machine B</h2><p>Both machines use the same operating point. Analysis groups and disabled blades remain independent.</p></div><FileDrop label="MACHINE B" onFile={(file) => loadFile("B", file)} /></section>}
          <nav className="tabbar" aria-label="Analysis views">{TABS.map((item) => <button key={item.key} className={`${tab === item.key ? "active" : ""} ${item.key === "viewer" ? "experimental-tab" : ""}`} onClick={() => setTab(item.key)}>{item.label}</button>)}</nav>
          <div className="tab-context"><div><span className="context-mode">{mode.toUpperCase()}</span><div className="context-title"><strong>{TABS.find((item) => item.key === tab)?.label}</strong><small>{activeLoaded?.machine.name} · {groupLabel(activeGroup)}</small></div></div>{mode === "compare" && <ActiveMachineSwitch value={key} secondAvailable={secondReady} onChange={setActiveMachine} />}</div>
          {bundleA && tab === "overview" && <div className="view-stack"><div className={bundleB ? "summary-pair" : ""}><MachineSummary bundle={bundleA} precision={precision} label={bundleB ? "A" : undefined} />{bundleB && <MachineSummary bundle={bundleB} precision={precision} label="B" />}</div>{bundleB ? <><ComparisonTable first={bundleA} second={bundleB} precision={precision} showPercent={showDeltaPercent} onShowPercentChange={setShowDeltaPercent} /><div className="machine-result-pair"><div><div className="pair-title">MACHINE A · {bundleA.report.machine.name}</div><BaselinePanel bundle={bundleA} precision={precision} /><DerivativesPanel bundle={bundleA} precision={precision} /></div><div><div className="pair-title">MACHINE B · {bundleB.report.machine.name}</div><BaselinePanel bundle={bundleB} precision={precision} /><DerivativesPanel bundle={bundleB} precision={precision} /></div></div></> : <><BaselinePanel bundle={bundleA} precision={precision} /><DerivativesPanel bundle={bundleA} precision={precision} /></>}</div>}
          {bundleA && tab === "sweeps" && <div className="view-stack sweep-page">
            <section className="sweep-controls data-panel"><div><span className="panel-kicker">SWEEP ANALYSIS</span><strong>Central operating point remains live</strong><small>Only sampled solver points are shown; no curve fitting or interpolation.</small></div><MetricSelector label="Alpha sweep quantity" value={alphaMetric} onChange={setAlphaMetric} /><MetricSelector label="Beta sweep quantity" value={betaMetric} onChange={setBetaMetric} /><details className="sweep-visibility"><summary>Visible graphs</summary><div>{([['alpha', 'Alpha sweep'], ['pitchQ', 'Pitch moment vs q'], ['beta', 'Beta sweep'], ['yawR', 'Yaw moment vs r'], ['rollP', 'Roll moment vs p']] as const).map(([graph, label]) => <label key={graph}><input type="checkbox" checked={standardGraphs[graph]} onChange={(event) => setStandardGraphs({ ...standardGraphs, [graph]: event.target.checked })} /> {label}</label>)}</div></details></section>
            {(standardGraphs.alpha || standardGraphs.pitchQ) && <><div className="analysis-band"><span>LONGITUDINAL</span><small>angle of attack and pitch-rate response</small></div><div className="charts-grid longitudinal-grid">{standardGraphs.alpha && <SweepChart title="Alpha sweep" help="Shows how the selected aerodynamic quantity changes as angle of attack α changes. X is α in degrees; Y is the selected raw solver quantity." xLabel="Alpha · α" centralValue={operatingPoint.alphaDegrees} first={{ name: bundleA.report.machine.name, sweep: bundleA.sweeps.alpha }} second={bundleB ? { name: bundleB.report.machine.name, sweep: bundleB.sweeps.alpha } : undefined} metric={alphaMetric} precision={precision} />}{standardGraphs.pitchQ && <SweepChart title="Pitch moment vs q" help="Shows how pitching moment changes with pitch angular rate q. Its local slope is the calculated pitch damping derivative." xLabel="Pitch rate · q" centralValue={operatingPoint.q} first={{ name: bundleA.report.machine.name, sweep: bundleA.sweeps.q }} second={bundleB ? { name: bundleB.report.machine.name, sweep: bundleB.sweeps.q } : undefined} metric="pitch" precision={precision} />}</div></>}
            {(standardGraphs.beta || standardGraphs.yawR || standardGraphs.rollP) && <><div className="analysis-band"><span>LATERAL / DIRECTIONAL</span><small>sideslip, yaw-rate and roll-rate response</small></div><div className="charts-grid lateral-grid">{standardGraphs.beta && <SweepChart title="Beta sweep" help="Shows how the selected aerodynamic quantity changes with sideslip angle β. β = 0° is zero sideslip." xLabel="Beta · β" centralValue={operatingPoint.betaDegrees} first={{ name: bundleA.report.machine.name, sweep: bundleA.sweeps.beta }} second={bundleB ? { name: bundleB.report.machine.name, sweep: bundleB.sweeps.beta } : undefined} metric={betaMetric} precision={precision} />}{standardGraphs.yawR && <SweepChart title="Yaw moment vs r" help="Shows how yawing moment changes with yaw rate r. Its local slope is the directional damping response used by the current model." xLabel="Yaw rate · r" centralValue={operatingPoint.r} first={{ name: bundleA.report.machine.name, sweep: bundleA.sweeps.r }} second={bundleB ? { name: bundleB.report.machine.name, sweep: bundleB.sweeps.r } : undefined} metric="yaw" precision={precision} />}{standardGraphs.rollP && <SweepChart title="Roll moment vs p" help="Shows how rolling moment changes with roll rate p. Its local slope is the roll damping response used by the current model." xLabel="Roll rate · p" centralValue={operatingPoint.p} first={{ name: bundleA.report.machine.name, sweep: bundleA.sweeps.p }} second={bundleB ? { name: bundleB.report.machine.name, sweep: bundleB.sweeps.p } : undefined} metric="roll" precision={precision} />}</div></>}
            {!Object.values(standardGraphs).some(Boolean) && <section className="data-panel empty-standard-graphs">All standard graphs are hidden. Use “Visible graphs” above to restore them.</section>}
          </div>}
          {bundleA && tab === "plot-lab" && <PlotLab first={bundleA} second={bundleB} precision={precision} state={plotLabState} onStateChange={setPlotLabState} importedDatasets={importedDatasets} onImportedDatasetsChange={setImportedDatasets} />}
          {activeBundle && tab === "blades" && <BladeTable bundle={activeBundle} precision={precision} selectedGuids={activeSelected} focusedGuid={activeFocused} onSelectionChange={key === "A" ? setSelectedA : setSelectedB} onFocus={focusActive} onEnabledChange={(guid, enabled) => setBladeEnabled(key, guid, enabled)} onEnableAll={() => enableAll(key)} onDisableSelected={() => disableSelected(key)} onReset={() => resetBlades(key)} />}
          {activeBundle && tab === "contributions" && <div className="view-stack"><section className="data-panel contribution-selector"><label>Contribution to <InfoTooltip label="About derivative contribution">Select which total stability or damping derivative to decompose into per-blade central-difference contributions.</InfoTooltip><select value={contribution} onChange={(event) => setContribution(event.target.value as ContributionDerivative)}>{CONTRIBUTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><span>Sorted by absolute contribution</span></section><ContributionTable bundle={activeBundle} precision={precision} tone={key} onFocus={focusActive} /></div>}
          {activeBundle && tab === "components" && <ComponentsView bundle={activeBundle} precision={precision} onSelect={(selection) => changeGroup(key, selection)} />}
          {activeBundle && tab === "viewer" && <ThreeViewer bundle={activeBundle} selectedGuid={activeFocused} toggles={viewerToggles} onToggle={setViewerToggles} onSelect={focusActive} />}
        </main>
      </div>
      {csvImportDraft && <CsvImportPanel draft={csvImportDraft} onChange={setCsvImportDraft} onCancel={() => setCsvImportDraft(undefined)} onImport={confirmCsvImport} />}
    </div>
  );
}
