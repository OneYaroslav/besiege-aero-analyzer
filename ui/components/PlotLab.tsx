import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  HEATMAP_QUANTITIES,
  PLOT_INPUTS,
  PLOT_QUANTITIES,
  deltaValue,
  evaluatePlot1D,
  evaluatePlot2D,
  formatPlot1DCsv,
  formatPlot2DCsv,
  quasiSteadyTurnEstimate,
  type HeatmapQuantity,
  type Plot1DConfig,
  type Plot1DResult,
  type Plot2DConfig,
  type Plot2DResult,
  type PlotInputVariable,
  type PlotLabUiState,
  type PlotQuantity,
  type PlotRange,
  type PlotMode,
  type CompareDisplay,
  type QuasiSteadyTurnEstimate,
} from "../../src/plot-lab.ts";
import type { ImportedDataset } from "../../src/file-workflow.ts";
import { formatNumber, type PrecisionMode, type UiAnalysisBundle } from "../../src/ui-model.ts";
import { CSV_FILE_FILTER, JSON_FILE_FILTER, getFileIo, safeFileName } from "../file-io.ts";
import { HeatmapChart } from "./HeatmapChart.tsx";
import { InfoTooltip } from "./InfoTooltip.tsx";

interface PlotLabProps {
  readonly first: UiAnalysisBundle;
  readonly second?: UiAnalysisBundle;
  readonly precision: PrecisionMode;
  readonly state: PlotLabUiState;
  readonly onStateChange: (state: PlotLabUiState) => void;
  readonly importedDatasets: readonly ImportedDataset[];
  readonly onImportedDatasetsChange: (datasets: readonly ImportedDataset[]) => void;
}

interface Evaluation {
  readonly first1D?: Plot1DResult;
  readonly second1D?: Plot1DResult;
  readonly first2D?: Plot2DResult;
  readonly second2D?: Plot2DResult;
  readonly firstTurnMoment2D?: Plot2DResult;
  readonly secondTurnMoment2D?: Plot2DResult;
  readonly elapsedMs?: number;
  readonly error?: string;
  readonly computing: boolean;
}

interface Preset {
  readonly key: string;
  readonly mode: PlotMode;
  readonly x: PlotInputVariable;
  readonly y?: PlotInputVariable;
  readonly quantity: PlotQuantity;
}

const PRESETS: readonly Preset[] = [
  { key: "pitch-stability", mode: "1d", x: "alpha", quantity: "pitchMoment" },
  { key: "pitch-damping", mode: "1d", x: "q", quantity: "pitchMoment" },
  { key: "yaw-stability", mode: "1d", x: "beta", quantity: "yawMoment" },
  { key: "yaw-damping", mode: "1d", x: "r", quantity: "yawMoment" },
  { key: "roll-damping", mode: "1d", x: "p", quantity: "rollMoment" },
  { key: "energy-aoa", mode: "1d", x: "alpha", quantity: "bladePower" },
  { key: "pitch-state-map", mode: "2d", x: "alpha", y: "q", quantity: "pitchMoment" },
  { key: "energy-map", mode: "2d", x: "speed", y: "alpha", quantity: "bladePower" },
  { key: "turn-analysis", mode: "2d", x: "speed", y: "q", quantity: "pitchMoment" },
];

const SERIES_COLORS = ["#6fd1ef", "#f0ab69", "#8bcfa8", "#b8a7ed", "#e28aa7", "#d4dbe1"] as const;

function defaultRange(variable: PlotInputVariable, points?: number): PlotRange {
  const range = PLOT_INPUTS[variable].defaultRange;
  return { ...range, points: points ?? range.points };
}

function deltaHeatmap(first: Plot2DResult, second: Plot2DResult): Plot2DResult {
  return {
    ...first,
    points: first.points.map((point, index) => ({ ...point, value: deltaValue(point.value, second.points[index].value) })),
  };
}

function heatmapDomain(results: readonly Plot2DResult[]): readonly [number, number] {
  const values = results.flatMap((result) => result.points.map((point) => point.value)).filter(Number.isFinite);
  return values.length === 0 ? [0, 0] : [Math.min(...values), Math.max(...values)];
}

function RangeEditor({ label, range, units, onChange }: { label: string; range: PlotRange; units: string; onChange: (range: PlotRange) => void }) {
  const { t } = useTranslation("plotlab");
  return (
    <fieldset className="plot-range-fieldset">
      <legend>{label} <small>{units}</small></legend>
      <label className="numeric-field"><span>{t("range.min")}</span><input aria-label={t("range.minimum", { label })} type="number" value={range.minimum} onChange={(event) => onChange({ ...range, minimum: Number(event.target.value) })} /></label>
      <label className="numeric-field"><span>{t("range.max")}</span><input aria-label={t("range.maximum", { label })} type="number" value={range.maximum} onChange={(event) => onChange({ ...range, maximum: Number(event.target.value) })} /></label>
      <label className="numeric-field"><span>{t("range.points")}</span><input aria-label={t("range.pointCount", { label })} type="number" min="2" max="501" step="1" value={range.points} onChange={(event) => onChange({ ...range, points: Number(event.target.value) })} /></label>
    </fieldset>
  );
}

function PlotLineChart({ first, second, display, firstName, secondName, precision, importedDatasets }: {
  first: Plot1DResult;
  second?: Plot1DResult;
  display: CompareDisplay;
  firstName: string;
  secondName?: string;
  precision: PrecisionMode;
  importedDatasets: readonly ImportedDataset[];
}) {
  const { t } = useTranslation("plotlab");
  const translatedUnits = (units: string) => t(`units.${units}`, { defaultValue: units });
  const quantities = first.config.quantities;
  const visibleImportedSeries = importedDatasets.filter((dataset) => dataset.visible).flatMap((dataset) => dataset.series.map((series) => ({ dataset, series })));
  const allUnits = [...new Set([...quantities.map((quantity) => PLOT_QUANTITIES[quantity].units), ...visibleImportedSeries.map(({ series }) => series.units)])];
  const unitGroups = allUnits.slice(0, 2);
  const axisForUnits = (units: string) => unitGroups.includes(units) ? units : unitGroups.at(-1) ?? PLOT_QUANTITIES[quantities[0]].units;
  const rows = new Map<number, Record<string, number>>();
  first.points.forEach((point, index) => {
    const row = rows.get(point.x) ?? { x: point.x };
    for (const quantity of quantities) {
      row[`single-${quantity}`] = point.values[quantity];
      if (second) {
        row[`a-${quantity}`] = point.values[quantity];
        row[`b-${quantity}`] = second.points[index].values[quantity];
        row[`delta-${quantity}`] = deltaValue(point.values[quantity], second.points[index].values[quantity]);
      }
    }
    rows.set(point.x, row);
  });
  for (const { series } of visibleImportedSeries) for (const point of series.points) {
    const row = rows.get(point.x) ?? { x: point.x };
    row[`imported-${series.id}`] = point.value;
    rows.set(point.x, row);
  }
  const data = [...rows.values()].sort((a, b) => a.x - b.x);
  const axisId = (quantity: PlotQuantity) => PLOT_QUANTITIES[quantity].units;
  const xMeta = PLOT_INPUTS[first.config.variable];
  const xLabel = t(`inputs.${first.config.variable}`);
  return (
    <div className="chart-wrap plot-lab-chart-wrap">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 16, right: unitGroups.length > 1 ? 82 : 20, bottom: 12, left: 10 }}>
        <CartesianGrid stroke="#202c36" strokeDasharray="2 5" vertical={false} />
        <XAxis dataKey="x" stroke="#738392" tick={{ fontSize: 11 }} label={{ value: `${xLabel} · ${translatedUnits(xMeta.units)}`, position: "insideBottomRight", offset: -3, fill: "#81909e", fontSize: 10 }} />
        {unitGroups.map((units, index) => <YAxis key={units} yAxisId={units} orientation={index === 0 ? "left" : "right"} stroke={index === 0 ? "#738392" : "#9a816d"} tick={{ fontSize: 11 }} tickFormatter={(value) => formatNumber(Number(value), precision)} width={78} />)}
        <ReferenceLine x={0} stroke="#596a78" strokeWidth={1.25} />
        {unitGroups.map((units) => <ReferenceLine key={units} yAxisId={units} y={0} stroke="#596a78" strokeWidth={1.25} />)}
        <Tooltip contentStyle={{ background: "#0b1117", border: "1px solid #3a4a57", borderRadius: 2, fontFamily: "ui-monospace, monospace", fontSize: 12 }} labelStyle={{ color: "#dce6ed", marginBottom: 6 }} formatter={(value, name) => [formatNumber(Number(value), precision), String(name)]} labelFormatter={(value) => `${xLabel} = ${value} ${translatedUnits(xMeta.units)}`} />
        {(quantities.length > 1 || second || visibleImportedSeries.length > 0) && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {!second && quantities.map((quantity, index) => <Line connectNulls key={quantity} type="linear" yAxisId={axisId(quantity)} dataKey={`single-${quantity}`} name={t(`quantities.${quantity}`)} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
        {second && display === "absolute" && quantities.flatMap((quantity) => [
          <Line connectNulls key={`a-${quantity}`} type="linear" yAxisId={axisId(quantity)} dataKey={`a-${quantity}`} name={`A · ${firstName}`} stroke="#6fd1ef" strokeWidth={2} dot={false} isAnimationActive={false} />,
          <Line connectNulls key={`b-${quantity}`} type="linear" yAxisId={axisId(quantity)} dataKey={`b-${quantity}`} name={`B · ${secondName}`} stroke="#f0ab69" strokeWidth={2} dot={false} isAnimationActive={false} />,
        ])}
        {second && display === "delta" && quantities.map((quantity) => <Line connectNulls key={`delta-${quantity}`} type="linear" yAxisId={axisId(quantity)} dataKey={`delta-${quantity}`} name={t("deltaSeries")} stroke="#dce6ed" strokeWidth={2} dot={false} isAnimationActive={false} />)}
        {visibleImportedSeries.map(({ dataset, series }, index) => <Line connectNulls key={series.id} type="linear" yAxisId={axisForUnits(series.units)} dataKey={`imported-${series.id}`} name={`${dataset.name} · ${series.name}`} stroke={SERIES_COLORS[(index + 3) % SERIES_COLORS.length]} strokeWidth={1.75} strokeDasharray="6 3" dot={{ r: 2 }} isAnimationActive={false} />)}
      </LineChart></ResponsiveContainer>
    </div>
  );
}

function fixedStateText(bundle: UiAnalysisBundle, excluded: readonly PlotInputVariable[], precision: PrecisionMode, speedLabel: string): string {
  const state = bundle.report.state;
  const values: Readonly<Record<PlotInputVariable, string>> = {
    speed: `${speedLabel} ${formatNumber(state.speed, precision)}`,
    alpha: `α ${formatNumber(state.alpha * 180 / Math.PI, precision)}°`,
    beta: `β ${formatNumber(state.beta * 180 / Math.PI, precision)}°`,
    p: `p ${formatNumber(state.p, precision)}`,
    q: `q ${formatNumber(state.q, precision)}`,
    r: `r ${formatNumber(state.r, precision)}`,
  };
  return (Object.keys(values) as PlotInputVariable[]).filter((key) => !excluded.includes(key)).map((key) => values[key]).join(" · ");
}

function TurnEstimatePanel({ first, second, firstName, secondName, precision, speed }: {
  first: QuasiSteadyTurnEstimate | null;
  second?: QuasiSteadyTurnEstimate | null;
  firstName: string;
  secondName?: string;
  precision: PrecisionMode;
  speed: number;
}) {
  const { t } = useTranslation("plotlab");
  const value = (estimate: QuasiSteadyTurnEstimate | null | undefined, key: "qRadiansPerSecond" | "qDegreesPerSecond" | "radiusGameUnits") => {
    const result = estimate?.[key];
    return result === null || result === undefined ? t("turn.na") : formatNumber(result, precision);
  };
  const delta = (key: "qRadiansPerSecond" | "qDegreesPerSecond" | "radiusGameUnits") => {
    const a = first?.[key];
    const b = second?.[key];
    if (a === null || a === undefined || b === null || b === undefined) return t("turn.na");
    const difference = b - a;
    return `${difference > 0 ? "+" : ""}${formatNumber(difference, precision)}`;
  };
  const columns = second ? [
    { key: "A", name: firstName, estimate: first },
    { key: "B", name: secondName ?? "B", estimate: second },
  ] : [{ key: "", name: firstName, estimate: first }];
  return <section className="data-panel turn-estimate-panel">
    <div className="turn-estimate-heading"><div><span className="panel-kicker">{t("turn.estimateKicker")}</span><strong>{t("turn.estimateTitle")}</strong></div><small>{t("turn.atSpeed", { speed: formatNumber(speed, precision) })}</small></div>
    <div className="turn-estimate-grid">
      {columns.map((column) => <div key={column.key || column.name} className={column.key ? `machine-${column.key.toLowerCase()}` : ""}><span>{column.key ? `${column.key} · ${column.name}` : column.name}</span><dl><div><dt>q_eq</dt><dd>{value(column.estimate, "qRadiansPerSecond")}</dd><small>rad/s</small></div><div><dt>q_eq</dt><dd>{value(column.estimate, "qDegreesPerSecond")}</dd><small>deg/s</small></div><div><dt>R</dt><dd>{value(column.estimate, "radiusGameUnits")}</dd><small>{t("turn.gameUnits")}</small></div></dl></div>)}
      {second && <div className="turn-estimate-delta"><span>{t("turn.delta")}</span><dl><div><dt>Δ q_eq</dt><dd>{delta("qRadiansPerSecond")}</dd><small>rad/s</small></div><div><dt>Δ q_eq</dt><dd>{delta("qDegreesPerSecond")}</dd><small>deg/s</small></div><div><dt>Δ R</dt><dd>{delta("radiusGameUnits")}</dd><small>{t("turn.gameUnits")}</small></div></dl></div>}
    </div>
    <p>{t("turn.estimateNote")}</p>
  </section>;
}

export function PlotLab({ first, second, precision, state, onStateChange, importedDatasets, onImportedDatasetsChange }: PlotLabProps) {
  const { t } = useTranslation(["plotlab", "common"]);
  const inputLabel = (value: PlotInputVariable): string => t(`inputs.${value}` as never);
  const quantityLabel = (value: PlotQuantity): string => t(`quantities.${value}` as never);
  const translatedUnits = (units: string): string => t(`units.${units}`, { defaultValue: units });
  const { mode: plotMode, display, xVariable, quantities, range, x2Variable, y2Variable, x2Range, y2Range, heatQuantity } = state;
  const setPlotMode = (value: PlotMode) => onStateChange({ ...state, mode: value });
  const setDisplay = (value: CompareDisplay) => onStateChange({ ...state, display: value });
  const setXVariable = (value: PlotInputVariable) => onStateChange({ ...state, xVariable: value });
  const setQuantities = (value: readonly PlotQuantity[]) => onStateChange({ ...state, quantities: value });
  const setRange = (value: PlotRange) => onStateChange({ ...state, range: value });
  const setX2Variable = (value: PlotInputVariable) => onStateChange({ ...state, x2Variable: value });
  const setY2Variable = (value: PlotInputVariable) => onStateChange({ ...state, y2Variable: value });
  const setX2Range = (value: PlotRange) => onStateChange({ ...state, x2Range: value });
  const setY2Range = (value: PlotRange) => onStateChange({ ...state, y2Range: value });
  const setHeatQuantity = (value: HeatmapQuantity) => onStateChange({ ...state, heatQuantity: value });
  const [addQuantity, setAddQuantity] = useState<PlotQuantity>("bladePower");
  const [evaluation, setEvaluation] = useState<Evaluation>({ computing: true });
  const [exportMessage, setExportMessage] = useState("");

  const effectiveQuantities = useMemo(() => second ? quantities.slice(0, 1) : quantities, [quantities, second]);
  const config1D = useMemo<Plot1DConfig>(() => ({ variable: xVariable, ...range, quantities: effectiveQuantities }), [effectiveQuantities, range, xVariable]);
  const config2D = useMemo<Plot2DConfig>(() => ({ xVariable: x2Variable, yVariable: y2Variable, xRange: x2Range, yRange: y2Range, quantity: heatQuantity }), [heatQuantity, x2Range, x2Variable, y2Range, y2Variable]);
  const turnAnalysis = plotMode === "2d" && x2Variable === "speed" && y2Variable === "q" && (heatQuantity === "pitchMoment" || heatQuantity === "bladePower");

  useEffect(() => {
    let cancelled = false;
    setEvaluation((current) => ({ ...current, computing: true, error: undefined }));
    const timer = window.setTimeout(() => {
      const started = performance.now();
      try {
        if (plotMode === "1d") {
          const first1D = evaluatePlot1D(first.report.blades, first.report.state, config1D, undefined, first.report.buildSurfaces);
          const second1D = second ? evaluatePlot1D(second.report.blades, second.report.state, config1D, undefined, second.report.buildSurfaces) : undefined;
          if (!cancelled) setEvaluation({ first1D, second1D, elapsedMs: performance.now() - started, computing: false });
        } else {
          const first2D = evaluatePlot2D(first.report.blades, first.report.state, config2D, first.report.buildSurfaces);
          const second2D = second ? evaluatePlot2D(second.report.blades, second.report.state, config2D, second.report.buildSurfaces) : undefined;
          const momentConfig = turnAnalysis && config2D.quantity !== "pitchMoment" ? { ...config2D, quantity: "pitchMoment" as const } : config2D;
          const firstTurnMoment2D = turnAnalysis ? (momentConfig === config2D ? first2D : evaluatePlot2D(first.report.blades, first.report.state, momentConfig, first.report.buildSurfaces)) : undefined;
          const secondTurnMoment2D = turnAnalysis && second ? (momentConfig === config2D ? second2D : evaluatePlot2D(second.report.blades, second.report.state, momentConfig, second.report.buildSurfaces)) : undefined;
          if (!cancelled) setEvaluation({ first2D, second2D, firstTurnMoment2D, secondTurnMoment2D, elapsedMs: performance.now() - started, computing: false });
        }
      } catch (cause) {
        if (!cancelled) setEvaluation({ error: cause instanceof Error ? cause.message : String(cause), computing: false });
      }
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [config1D, config2D, first, plotMode, second, turnAnalysis]);

  const availableAdditions = (Object.keys(PLOT_QUANTITIES) as PlotQuantity[]).filter((quantity) => !quantities.includes(quantity));
  const candidateQuantity = availableAdditions.includes(addQuantity) ? addQuantity : availableAdditions[0];
  const unitGroups = [...new Set(effectiveQuantities.map((quantity) => PLOT_QUANTITIES[quantity].units))];
  const first2D = evaluation.first2D;
  const second2D = evaluation.second2D;
  const delta2D = first2D && second2D ? deltaHeatmap(first2D, second2D) : undefined;
  const absoluteDomain = first2D ? heatmapDomain(second2D ? [first2D, second2D] : [first2D]) : undefined;
  const turnEstimateA = evaluation.firstTurnMoment2D ? quasiSteadyTurnEstimate(evaluation.firstTurnMoment2D, first.report.state.speed, first.report.state.q) : null;
  const turnEstimateB = evaluation.secondTurnMoment2D && second ? quasiSteadyTurnEstimate(evaluation.secondTurnMoment2D, second.report.state.speed, second.report.state.q) : null;
  const turnContours = turnAnalysis && first2D ? [
    { result: first2D, label: second ? `A · ${first.report.machine.name} · 0` : `${quantityLabel(heatQuantity)} = 0`, color: "#b9f1ff" },
    ...(second2D && second ? [{ result: second2D, label: `B · ${second.report.machine.name} · 0`, color: "#ffc17f", dashed: true }] : []),
  ] : undefined;
  const visibleImported = importedDatasets.filter((dataset) => dataset.visible);
  const calculatedUnits = new Set(effectiveQuantities.map((quantity) => PLOT_QUANTITIES[quantity].units));
  const importedUnitWarning = visibleImported.some((dataset) => dataset.xUnits !== "unknown" && dataset.xUnits !== PLOT_INPUTS[xVariable].units)
    || visibleImported.flatMap((dataset) => dataset.series).some((series) => series.units === "unknown" || !calculatedUnits.has(series.units));

  function updateImportedDataset(id: string, update: Partial<Pick<ImportedDataset, "name" | "visible">>): void {
    onImportedDatasetsChange(importedDatasets.map((dataset) => dataset.id === id ? { ...dataset, ...update } : dataset));
  }

  function flashExport(message: string): void {
    setExportMessage(message);
    window.setTimeout(() => setExportMessage(""), 4_000);
  }

  function applyPreset(key: string): void {
    const preset = PRESETS.find((candidate) => candidate.key === key);
    if (!preset) return;
    if (preset.mode === "1d") {
      onStateChange({ ...state, mode: "1d", xVariable: preset.x, range: defaultRange(preset.x), quantities: [preset.quantity] });
    } else if (preset.y) {
      onStateChange({
        ...state,
        mode: "2d",
        x2Variable: preset.x,
        y2Variable: preset.y,
        x2Range: defaultRange(preset.x, 31),
        y2Range: defaultRange(preset.y, 31),
        heatQuantity: preset.quantity as HeatmapQuantity,
      });
    }
  }

  function change1DVariable(variable: PlotInputVariable): void {
    onStateChange({ ...state, xVariable: variable, range: defaultRange(variable) });
  }

  function change2DVariable(axis: "x" | "y", variable: PlotInputVariable): void {
    if (axis === "x") {
      if (variable === y2Variable) {
        const replacement = (Object.keys(PLOT_INPUTS) as PlotInputVariable[]).find((candidate) => candidate !== variable) ?? "q";
        onStateChange({ ...state, x2Variable: variable, x2Range: defaultRange(variable, 31), y2Variable: replacement, y2Range: defaultRange(replacement, 31) });
      } else {
        onStateChange({ ...state, x2Variable: variable, x2Range: defaultRange(variable, 31) });
      }
    } else {
      if (variable === x2Variable) {
        const replacement = (Object.keys(PLOT_INPUTS) as PlotInputVariable[]).find((candidate) => candidate !== variable) ?? "alpha";
        onStateChange({ ...state, y2Variable: variable, y2Range: defaultRange(variable, 31), x2Variable: replacement, x2Range: defaultRange(replacement, 31) });
      } else {
        onStateChange({ ...state, y2Variable: variable, y2Range: defaultRange(variable, 31) });
      }
    }
  }

  function addSeries(): void {
    if (second || !candidateQuantity || quantities.includes(candidateQuantity) || quantities.length >= 6) return;
    const nextUnits = [...new Set([...quantities, candidateQuantity].map((quantity) => PLOT_QUANTITIES[quantity].units))];
    if (nextUnits.length > 2) return;
    setQuantities([...quantities, candidateQuantity]);
    const next = availableAdditions.find((quantity) => quantity !== candidateQuantity);
    if (next) setAddQuantity(next);
  }

  async function exportCsv(): Promise<void> {
    const prefix = second ? `${first.report.machine.name}-vs-${second.report.machine.name}` : first.report.machine.name;
    let csv: string | undefined;
    let suggestedName = "";
    if (plotMode === "1d" && evaluation.first1D) {
      csv = formatPlot1DCsv(evaluation.first1D, first.report.machine.name, evaluation.second1D, second?.report.machine.name);
      suggestedName = `${prefix}-${PLOT_INPUTS[xVariable].shortLabel}-${PLOT_QUANTITIES[effectiveQuantities[0]].label}.csv`;
    } else if (plotMode === "2d" && first2D) {
      csv = formatPlot2DCsv(first2D, first.report.machine.name, second2D, second?.report.machine.name);
      suggestedName = `${prefix}-${PLOT_INPUTS[x2Variable].shortLabel}-${PLOT_INPUTS[y2Variable].shortLabel}-${PLOT_QUANTITIES[heatQuantity].label}.csv`;
    }
    if (!csv) return;
    try {
      const saved = await getFileIo().saveTextFile({ content: csv, suggestedName: safeFileName(suggestedName), filter: CSV_FILE_FILTER });
      if (saved) flashExport(t("plotlab:files.saved", { path: saved.path ?? saved.name }));
    } catch (cause) {
      flashExport(t("plotlab:files.failed", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  async function exportJson(): Promise<void> {
    if (plotMode !== "2d" || !first2D) return;
    const payload = {
      format: "besiege-aero-analyzer-plot-lab-2d",
      comparison: second2D ? { direction: "B - A", display } : undefined,
      operatingPoint: {
        speed: first.report.state.speed,
        alphaDegrees: first.report.state.alpha * 180 / Math.PI,
        betaDegrees: first.report.state.beta * 180 / Math.PI,
        p: first.report.state.p,
        q: first.report.state.q,
        r: first.report.state.r,
        centerOfGravity: first.report.state.centerOfGravity,
        analysisGroup: first.report.mass.group.label,
      },
      first: { machine: first.report.machine.name, result: first2D },
      second: second2D && second ? { machine: second.report.machine.name, result: second2D } : undefined,
      delta: delta2D,
    };
    try {
      const prefix = second ? `${first.report.machine.name}-vs-${second.report.machine.name}` : first.report.machine.name;
      const saved = await getFileIo().saveTextFile({
        content: JSON.stringify(payload, null, 2),
        suggestedName: safeFileName(`${prefix}-${PLOT_INPUTS[x2Variable].shortLabel}-${PLOT_INPUTS[y2Variable].shortLabel}-${PLOT_QUANTITIES[heatQuantity].label}.json`),
        filter: JSON_FILE_FILTER,
      });
      if (saved) flashExport(t("plotlab:files.saved", { path: saved.path ?? saved.name }));
    } catch (cause) {
      flashExport(t("plotlab:files.failed", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  return (
    <div className="view-stack plot-lab" data-tutorial="plot-lab">
      <section className="data-panel plot-lab-header">
        <div><span className="panel-kicker">PLOT LAB</span><strong>{t("plotlab:subtitle")}</strong><small>{t("plotlab:fixedInputs")}</small></div>
        <label className="inline-select preset-select">{t("plotlab:preset")}<select aria-label={t("plotlab:presetAria")} defaultValue="" onChange={(event) => { applyPreset(event.target.value); event.target.value = ""; }}><option value="" disabled>{t("plotlab:choose")}</option>{PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{t(`presets.${preset.key}` as never)}</option>)}</select></label>
        <div className="segmented compact" aria-label={t("plotlab:mode")}><button className={plotMode === "1d" ? "active" : ""} onClick={() => setPlotMode("1d")}>{t("plotlab:plot1d")}</button><button className={plotMode === "2d" ? "active" : ""} onClick={() => setPlotMode("2d")}>{t("plotlab:sweep2d")}</button></div>
        {second && <div className="segmented compact" aria-label={t("plotlab:compareDisplay")}><button className={display === "absolute" ? "active" : ""} onClick={() => setDisplay("absolute")}>{t("plotlab:absolute")}</button><button className={display === "delta" ? "active" : ""} onClick={() => setDisplay("delta")}>DELTA</button></div>}
        <div className="plot-export-actions">{exportMessage && <span role="status">{exportMessage}</span>}<button className="secondary-button" disabled={evaluation.computing || Boolean(evaluation.error)} onClick={exportCsv}>{t("common:actions.export")} CSV</button>{plotMode === "2d" && <button className="secondary-button" disabled={evaluation.computing || Boolean(evaluation.error)} onClick={exportJson}>{t("common:actions.export")} JSON</button>}</div>
      </section>

      {plotMode === "1d" ? <>
        <section className="data-panel plot-lab-controls plot-lab-controls-1d">
          <label className="select-field"><span>{t("plotlab:xVariable")}</span><select value={xVariable} onChange={(event) => change1DVariable(event.target.value as PlotInputVariable)}>{Object.keys(PLOT_INPUTS).map((key) => <option key={key} value={key}>{inputLabel(key as PlotInputVariable)}</option>)}</select></label>
          <label className="select-field"><span>{second ? t("plotlab:yQuantity") : t("plotlab:primarySeries")}</span><select value={quantities[0]} onChange={(event) => { const next = event.target.value as PlotQuantity; setQuantities([next, ...quantities.slice(1).filter((quantity) => quantity !== next)]); }}>{Object.keys(PLOT_QUANTITIES).map((key) => <option key={key} value={key}>{quantityLabel(key as PlotQuantity)}</option>)}</select></label>
          {!second && <div className="plot-add-series"><label className="select-field"><span>{t("plotlab:additionalSeries")}</span><select aria-label={t("plotlab:additionalSeries")} value={candidateQuantity ?? ""} onChange={(event) => setAddQuantity(event.target.value as PlotQuantity)}>{availableAdditions.map((quantity) => <option key={quantity} value={quantity}>{quantityLabel(quantity)}</option>)}</select></label><button className="secondary-button" disabled={!candidateQuantity || quantities.length >= 6 || [...new Set([...quantities, candidateQuantity].map((item) => PLOT_QUANTITIES[item].units))].length > 2} onClick={addSeries}>{t("plotlab:addSeries")}</button></div>}
          <RangeEditor label={t("plotlab:xRange")} range={range} units={translatedUnits(PLOT_INPUTS[xVariable].units)} onChange={setRange} />
        </section>
        <section className="data-panel plot-series-strip"><div><span>{t("plotlab:activeSeries")}</span>{effectiveQuantities.map((quantity, index) => <button key={quantity} className="series-chip" style={{ borderColor: SERIES_COLORS[index % SERIES_COLORS.length] }} onClick={() => { if (!second && quantities.length > 1) setQuantities(quantities.filter((item) => item !== quantity)); }} title={!second && quantities.length > 1 ? t("plotlab:removeSeries") : undefined}>{quantityLabel(quantity)}{!second && quantities.length > 1 ? " ×" : ""}</button>)}</div><small>{second ? t("plotlab:compareSame") : unitGroups.length > 1 ? t("plotlab:twoUnits") : translatedUnits(PLOT_QUANTITIES[effectiveQuantities[0]].units)}</small></section>
        {importedDatasets.length > 0 && <section className="data-panel imported-datasets">
          <div className="imported-datasets-heading"><div><span className="panel-kicker">{t("plotlab:imported.title")}</span><strong>{t("plotlab:imported.subtitle")}</strong></div><small>{t("plotlab:imported.visualOnly")}</small></div>
          <div className="imported-dataset-list">{importedDatasets.map((dataset) => <div className="imported-dataset-row" key={dataset.id}>
            <label title={t("plotlab:imported.showHide")}><input type="checkbox" checked={dataset.visible} onChange={(event) => updateImportedDataset(dataset.id, { visible: event.target.checked })} /></label>
            <input aria-label={t("plotlab:datasetNameAria", { file: dataset.sourceFileName })} value={dataset.name} onChange={(event) => updateImportedDataset(dataset.id, { name: event.target.value })} />
            <span>{t("plotlab:imported.series", { count: dataset.series.length, x: dataset.xColumn, units: dataset.xUnits })}</span>
            <small title={dataset.sourceFileName}>{dataset.sourceFileName}</small>
            <button className="secondary-button" onClick={() => onImportedDatasetsChange(importedDatasets.filter((candidate) => candidate.id !== dataset.id))}>{t("common:actions.remove")}</button>
          </div>)}</div>
          {importedUnitWarning && <div className="unit-warning">{t("plotlab:imported.unitWarning")}</div>}
          {second && display === "delta" && visibleImported.length > 0 && <div className="unit-warning">{t("plotlab:imported.deltaWarning")}</div>}
        </section>}
        <section className="chart-panel plot-lab-chart">
          <div className="chart-title"><div><span>{effectiveQuantities.map(quantityLabel).join(" + ")} {t("plotlab:versus")} {inputLabel(xVariable)} <InfoTooltip label={t("plotlab:about1d")}>{t("plotlab:help1d")}</InfoTooltip></span><small>{t("plotlab:fixed")}: {fixedStateText(first, [xVariable], precision, inputLabel("speed"))}</small></div><span className="plot-calc-status">{evaluation.computing ? t("plotlab:calculating") : evaluation.elapsedMs === undefined ? "" : `${formatNumber(evaluation.elapsedMs, "3")} ms`}</span></div>
          {evaluation.error ? <div className="plot-error" role="alert">{evaluation.error}</div> : evaluation.first1D && <PlotLineChart first={evaluation.first1D} second={evaluation.second1D} display={display} firstName={first.report.machine.name} secondName={second?.report.machine.name} precision={precision} importedDatasets={importedDatasets} />}
          {second && <div className="delta-direction">{display === "delta" ? t("plotlab:displayDelta") : t("plotlab:absoluteHelp")}</div>}
        </section>
      </> : <>
        {turnAnalysis && <section className="data-panel turn-analysis-panel">
          <div className="turn-analysis-title"><div><span className="panel-kicker">{t("turn.kicker")}</span><strong>{t("turn.title")} <InfoTooltip label={t("turn.about")}>{t("turn.tooltip")}</InfoTooltip></strong><small>{t("turn.subtitle")}</small></div>
          <div className="segmented compact" aria-label={t("turn.view")}><button className={heatQuantity === "pitchMoment" ? "active" : ""} onClick={() => setHeatQuantity("pitchMoment")}>{t("turn.momentView")}</button><button className={heatQuantity === "bladePower" ? "active" : ""} onClick={() => setHeatQuantity("bladePower")}>{t("turn.energyView")}</button></div></div>
          <div className="turn-analysis-help"><span>{t("turn.helpRate")}</span><span>{t("turn.helpRadius")}</span><span>{t("turn.helpMomentZero")}</span><span>{t("turn.helpPower")}</span></div>
        </section>}
        <section className="data-panel plot-lab-controls plot-lab-controls-2d">
          <label className="select-field"><span>{t("plotlab:xVariable")}</span><select value={x2Variable} onChange={(event) => change2DVariable("x", event.target.value as PlotInputVariable)}>{Object.keys(PLOT_INPUTS).map((key) => <option key={key} value={key} disabled={key === y2Variable}>{inputLabel(key as PlotInputVariable)}</option>)}</select></label>
          <label className="select-field"><span>{t("plotlab:yVariable")}</span><select value={y2Variable} onChange={(event) => change2DVariable("y", event.target.value as PlotInputVariable)}>{Object.keys(PLOT_INPUTS).map((key) => <option key={key} value={key} disabled={key === x2Variable}>{inputLabel(key as PlotInputVariable)}</option>)}</select></label>
          <label className="select-field"><span>{t("plotlab:zQuantity")}</span><select value={heatQuantity} onChange={(event) => setHeatQuantity(event.target.value as HeatmapQuantity)}>{HEATMAP_QUANTITIES.map((quantity) => <option key={quantity} value={quantity}>{quantityLabel(quantity)}</option>)}</select></label>
          <RangeEditor label={t("plotlab:xAxis")} range={x2Range} units={translatedUnits(PLOT_INPUTS[x2Variable].units)} onChange={setX2Range} />
          <RangeEditor label={t("plotlab:yAxis")} range={y2Range} units={translatedUnits(PLOT_INPUTS[y2Variable].units)} onChange={setY2Range} />
        </section>
        <section className="data-panel plot-grid-summary"><div><span>{t("plotlab:grid")}</span><strong>{x2Range.points} × {y2Range.points}</strong><small>{t("plotlab:gridStates", { count: x2Range.points * y2Range.points })}</small></div><div><span>{t("plotlab:value")}</span><strong>{quantityLabel(heatQuantity)}</strong><small>{translatedUnits(PLOT_QUANTITIES[heatQuantity].units)}</small></div><div><span>{t("plotlab:fixedState")}</span><strong>{fixedStateText(first, [x2Variable, y2Variable], precision, inputLabel("speed"))}</strong><small>{t("plotlab:cellHelp")}</small></div><div className="plot-calc-status">{evaluation.computing ? t("plotlab:calculatingGrid") : evaluation.elapsedMs === undefined ? "" : `${formatNumber(evaluation.elapsedMs, "3")} ms`}</div></section>
        {evaluation.error ? <div className="plot-error" role="alert">{evaluation.error}</div> : first2D && <div className={`heatmap-grid ${second2D && display === "absolute" ? "compare" : ""}`}>
          {(!second2D || display === "absolute") && <HeatmapChart title={second2D ? `A · ${first.report.machine.name}` : first.report.machine.name} result={first2D} precision={precision} domain={absoluteDomain} tone="A" contours={turnContours} />}
          {second2D && display === "absolute" && <HeatmapChart title={`B · ${second?.report.machine.name}`} result={second2D} precision={precision} domain={absoluteDomain} tone="B" contours={turnContours} />}
          {second2D && display === "delta" && delta2D && <HeatmapChart title={t("plotlab:deltaSeries")} result={delta2D} precision={precision} tone="delta" contours={turnContours} />}
        </div>}
        {turnAnalysis && evaluation.firstTurnMoment2D && <TurnEstimatePanel first={turnEstimateA} second={second ? turnEstimateB : undefined} firstName={first.report.machine.name} secondName={second?.report.machine.name} precision={precision} speed={first.report.state.speed} />}
        {second && <div className="delta-direction">{display === "delta" ? t("plotlab:displayDelta") : t("plotlab:heatmapAbsoluteHelp")}</div>}
      </>}
    </div>
  );
}
