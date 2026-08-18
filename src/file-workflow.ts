import {
  DEFAULT_PLOT_LAB_STATE,
  HEATMAP_QUANTITIES,
  PLOT_INPUTS,
  PLOT_QUANTITIES,
  type CompareDisplay,
  type HeatmapQuantity,
  type PlotInputVariable,
  type PlotLabUiState,
  type PlotMode,
  type PlotQuantity,
  type PlotRange,
} from "./plot-lab.ts";
import {
  UI_ANALYSIS_VERSION,
  type OperatingPoint,
  type PrecisionMode,
  type UiGroupSelection,
} from "./ui-model.ts";

export const ANALYSIS_EXPORT_FORMAT = "besiege-aero-analyzer-analysis";

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export interface ImportedMachineState {
  readonly name: string;
  readonly groupSelection: UiGroupSelection;
  readonly disabledBladeGuids: readonly string[];
}

export interface ImportedAnalysisState {
  readonly analysisVersion: string;
  readonly mode: "single" | "compare";
  readonly operatingPoint: OperatingPoint;
  readonly precision?: PrecisionMode;
  readonly plotLab: PlotLabUiState;
  readonly machines: readonly ImportedMachineState[];
}

export interface CsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly numericColumns: readonly string[];
  readonly suggestedXColumn?: string;
  readonly suggestedYColumns: readonly string[];
  readonly units: Readonly<Record<string, string>>;
}

export interface ImportedSeriesPoint {
  readonly x: number;
  readonly value: number;
}

export interface ImportedSeries {
  readonly id: string;
  readonly name: string;
  readonly column: string;
  readonly units: string;
  readonly points: readonly ImportedSeriesPoint[];
}

export interface ImportedDataset {
  readonly id: string;
  readonly name: string;
  readonly sourceFileName: string;
  readonly xColumn: string;
  readonly xUnits: string;
  readonly visible: boolean;
  readonly series: readonly ImportedSeries[];
}

export interface ImportedDatasetConfig {
  readonly name: string;
  readonly sourceFileName: string;
  readonly xColumn: string;
  readonly yColumns: readonly string[];
  readonly id?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ImportValidationError(`${label} must be an object`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ImportValidationError(`${label} must be a non-empty string`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ImportValidationError(`${label} must be a finite number`);
  return value;
}

function parseMode(value: unknown): "single" | "compare" {
  if (value !== "single" && value !== "compare") throw new ImportValidationError("mode must be single or compare");
  return value;
}

function parsePrecision(value: unknown): PrecisionMode | undefined {
  if (value === undefined) return undefined;
  if (value !== "auto" && value !== "3" && value !== "6") throw new ImportValidationError("ui.precision is unsupported");
  return value;
}

function parseGroup(value: unknown, label: string): UiGroupSelection {
  const group = requiredRecord(value, label);
  if (group.kind === "all" || group.kind === "aircraft") return { kind: group.kind };
  if (group.kind === "component" && Number.isInteger(group.index) && Number(group.index) >= 0) {
    return { kind: "component", index: Number(group.index) };
  }
  throw new ImportValidationError(`${label} is not a supported analysis group selection`);
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseGuids(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new ImportValidationError(`${label} must be an array`);
  const guids = value.map((item, index) => requiredString(item, `${label}[${index}]`));
  const invalid = guids.find((guid) => !GUID_PATTERN.test(guid));
  if (invalid) throw new ImportValidationError(`${label} contains an invalid GUID: ${invalid}`);
  return [...new Set(guids)];
}

function parseOperatingPoint(value: unknown): OperatingPoint {
  const point = requiredRecord(value, "machines[0].operatingPoint");
  const speed = finiteNumber(point.speed, "operatingPoint.speed");
  if (speed < 0) throw new ImportValidationError("operatingPoint.speed cannot be negative");
  return {
    speed,
    alphaDegrees: finiteNumber(point.alphaDegrees, "operatingPoint.alphaDegrees"),
    betaDegrees: finiteNumber(point.betaDegrees, "operatingPoint.betaDegrees"),
    p: finiteNumber(point.p, "operatingPoint.p"),
    q: finiteNumber(point.q, "operatingPoint.q"),
    r: finiteNumber(point.r, "operatingPoint.r"),
  };
}

function parseRange(value: unknown, fallback: PlotRange, label: string): PlotRange {
  if (value === undefined) return { ...fallback };
  const range = requiredRecord(value, label);
  const minimum = finiteNumber(range.minimum, `${label}.minimum`);
  const maximum = finiteNumber(range.maximum, `${label}.maximum`);
  const points = finiteNumber(range.points, `${label}.points`);
  if (maximum <= minimum) throw new ImportValidationError(`${label}.maximum must be greater than minimum`);
  if (!Number.isInteger(points) || points < 2 || points > 10_000) throw new ImportValidationError(`${label}.points must be an integer from 2 to 10000`);
  return { minimum, maximum, points };
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], fallback: T, label: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) throw new ImportValidationError(`${label} is unsupported`);
  return value as T;
}

export function normalizePlotLabState(value: unknown): PlotLabUiState {
  if (value === undefined) return { ...DEFAULT_PLOT_LAB_STATE };
  const state = requiredRecord(value, "ui.plotLab");
  const inputs = Object.keys(PLOT_INPUTS) as PlotInputVariable[];
  const outputs = Object.keys(PLOT_QUANTITIES) as PlotQuantity[];
  const mode = oneOf<PlotMode>(state.mode, ["1d", "2d"], DEFAULT_PLOT_LAB_STATE.mode, "ui.plotLab.mode");
  const display = oneOf<CompareDisplay>(state.display, ["absolute", "delta"], DEFAULT_PLOT_LAB_STATE.display, "ui.plotLab.display");
  const xVariable = oneOf(state.xVariable, inputs, DEFAULT_PLOT_LAB_STATE.xVariable, "ui.plotLab.xVariable");
  const x2Variable = oneOf(state.x2Variable, inputs, DEFAULT_PLOT_LAB_STATE.x2Variable, "ui.plotLab.x2Variable");
  const y2Variable = oneOf(state.y2Variable, inputs, DEFAULT_PLOT_LAB_STATE.y2Variable, "ui.plotLab.y2Variable");
  if (x2Variable === y2Variable) throw new ImportValidationError("ui.plotLab 2D axes must be different");
  const quantities = state.quantities === undefined ? [...DEFAULT_PLOT_LAB_STATE.quantities] : Array.isArray(state.quantities)
    ? state.quantities.map((quantity, index) => oneOf(quantity, outputs, "pitchMoment", `ui.plotLab.quantities[${index}]`))
    : (() => { throw new ImportValidationError("ui.plotLab.quantities must be an array"); })();
  if (quantities.length === 0 || quantities.length > 6) throw new ImportValidationError("ui.plotLab.quantities must contain 1 to 6 series");
  const heatQuantity = oneOf<HeatmapQuantity>(state.heatQuantity, HEATMAP_QUANTITIES, DEFAULT_PLOT_LAB_STATE.heatQuantity, "ui.plotLab.heatQuantity");
  return {
    mode,
    display,
    xVariable,
    quantities: [...new Set(quantities)],
    range: parseRange(state.range, DEFAULT_PLOT_LAB_STATE.range, "ui.plotLab.range"),
    x2Variable,
    y2Variable,
    x2Range: parseRange(state.x2Range, DEFAULT_PLOT_LAB_STATE.x2Range, "ui.plotLab.x2Range"),
    y2Range: parseRange(state.y2Range, DEFAULT_PLOT_LAB_STATE.y2Range, "ui.plotLab.y2Range"),
    heatQuantity,
  };
}

function compareVersion(left: string, right: string): number {
  const parse = (value: string) => value.split(/[-.]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function parseAnalysisImport(text: string): ImportedAnalysisState {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ImportValidationError(`Malformed JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const root = requiredRecord(raw, "Analysis JSON");
  if (root.format !== ANALYSIS_EXPORT_FORMAT) throw new ImportValidationError("Unsupported JSON format; expected a Besiege Aero Analyzer analysis export");
  const version = requiredString(root.analysisVersion, "analysisVersion");
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) throw new ImportValidationError(`Unsupported analysisVersion: ${version}`);
  if (compareVersion(version, UI_ANALYSIS_VERSION) > 0) {
    throw new ImportValidationError(`Analysis schema ${version} is newer than supported ${UI_ANALYSIS_VERSION}`);
  }
  const mode = parseMode(root.mode);
  if (!Array.isArray(root.machines) || root.machines.length < 1 || root.machines.length > 2) throw new ImportValidationError("machines must contain one or two machine records");
  if (mode === "single" && root.machines.length !== 1) throw new ImportValidationError("Single analysis must contain one machine record");
  if (mode === "compare" && root.machines.length !== 2) throw new ImportValidationError("Compare analysis must contain two machine records");
  const machines = root.machines.map((value, index) => {
    const machine = requiredRecord(value, `machines[${index}]`);
    const metadata = requiredRecord(machine.metadata, `machines[${index}].metadata`);
    const selectedGroup = requiredRecord(machine.selectedAnalysisGroup, `machines[${index}].selectedAnalysisGroup`);
    const blades = requiredRecord(machine.blades, `machines[${index}].blades`);
    return {
      name: requiredString(metadata.name, `machines[${index}].metadata.name`),
      groupSelection: parseGroup(selectedGroup.uiSelection, `machines[${index}].selectedAnalysisGroup.uiSelection`),
      disabledBladeGuids: parseGuids(blades.disabledGuids, `machines[${index}].blades.disabledGuids`),
    } satisfies ImportedMachineState;
  });
  const ui = root.ui === undefined ? undefined : requiredRecord(root.ui, "ui");
  return {
    analysisVersion: version,
    mode,
    operatingPoint: parseOperatingPoint(requiredRecord(root.machines[0], "machines[0]").operatingPoint),
    precision: parsePrecision(ui?.precision),
    plotLab: normalizePlotLabState(ui?.plotLab),
    machines,
  };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      if (cell !== "") throw new ImportValidationError(`Malformed CSV: unexpected quote at character ${index + 1}`);
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new ImportValidationError("Malformed CSV: unterminated quoted field");
  row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function headerUnits(header: string): string {
  const trimmed = header.trim();
  const marker = trimmed.lastIndexOf(" (");
  return marker >= 0 && trimmed.endsWith(")") ? trimmed.slice(marker + 2, -1).trim() || "unknown" : "unknown";
}

export function parseCsv(text: string): CsvTable {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new ImportValidationError("CSV must contain a header and at least one data row");
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => header === "")) throw new ImportValidationError("CSV contains an empty header");
  if (new Set(headers).size !== headers.length) throw new ImportValidationError("CSV headers must be unique");
  const dataRows = rows.slice(1);
  const wideRow = dataRows.find((dataRow) => dataRow.length > headers.length);
  if (wideRow) throw new ImportValidationError("CSV data row has more fields than the header");
  const normalizedRows = dataRows.map((dataRow) => headers.map((_, index) => dataRow[index]?.trim() ?? ""));
  const numericColumns = headers.filter((_, columnIndex) => {
    const values = normalizedRows.map((dataRow) => dataRow[columnIndex]).filter((value) => value !== "");
    return values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
  });
  if (numericColumns.length === 0) throw new ImportValidationError("CSV does not contain any numeric columns");
  const units = Object.fromEntries(headers.map((header) => [header, headerUnits(header)]));
  return {
    headers,
    rows: normalizedRows,
    numericColumns,
    suggestedXColumn: numericColumns[0],
    suggestedYColumns: numericColumns.slice(1),
    units,
  };
}

function stableDatasetId(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `dataset-${(hash >>> 0).toString(16)}-${Date.now().toString(36)}`;
}

export function buildImportedDataset(table: CsvTable, config: ImportedDatasetConfig): ImportedDataset {
  const name = config.name.trim();
  if (!name) throw new ImportValidationError("Dataset name cannot be empty");
  const xIndex = table.headers.indexOf(config.xColumn);
  if (xIndex < 0 || !table.numericColumns.includes(config.xColumn)) throw new ImportValidationError("Selected X column is not numeric");
  const yColumns = [...new Set(config.yColumns)];
  if (yColumns.length === 0) throw new ImportValidationError("Select at least one Y column");
  if (yColumns.includes(config.xColumn)) throw new ImportValidationError("X column cannot also be a Y column");
  const id = config.id ?? stableDatasetId(`${config.sourceFileName}:${name}`);
  const series = yColumns.map((column, seriesIndex) => {
    const columnIndex = table.headers.indexOf(column);
    if (columnIndex < 0 || !table.numericColumns.includes(column)) throw new ImportValidationError(`${column} is not a numeric column`);
    const points = table.rows.filter((row) => row[xIndex] !== "" && row[columnIndex] !== "").map((row, rowIndex) => {
      const x = Number(row[xIndex]);
      const value = Number(row[columnIndex]);
      if (!Number.isFinite(x) || !Number.isFinite(value)) throw new ImportValidationError(`Invalid numeric value in row ${rowIndex + 2}`);
      return { x, value };
    });
    if (points.length === 0) throw new ImportValidationError(`${column} has no paired numeric samples`);
    return {
      id: `${id}-series-${seriesIndex}`,
      name: column,
      column,
      units: table.units[column] ?? "unknown",
      points,
    } satisfies ImportedSeries;
  });
  return {
    id,
    name,
    sourceFileName: config.sourceFileName,
    xColumn: config.xColumn,
    xUnits: table.units[config.xColumn] ?? "unknown",
    visible: true,
    series,
  };
}
