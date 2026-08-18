import assert from "node:assert/strict";
import test from "node:test";

import type { AnalysisState } from "../src/analysis.ts";
import type { VanillaBlade } from "../src/bsg.ts";
import {
  ImportValidationError,
  buildImportedDataset,
  parseAnalysisImport,
  parseCsv,
} from "../src/file-workflow.ts";
import { evaluatePlot1D, formatPlot1DCsv } from "../src/plot-lab.ts";
import { UI_ANALYSIS_VERSION } from "../src/ui-model.ts";
import { CSV_FILE_FILTER, createBrowserFileIo } from "../ui/file-io.ts";

const VALID_GUID = "12345678-1234-1234-1234-123456789abc";

function analysisJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "besiege-aero-analyzer-analysis",
    analysisVersion: UI_ANALYSIS_VERSION,
    mode: "single",
    machines: [{
      metadata: { name: "Test Machine" },
      selectedAnalysisGroup: { uiSelection: { kind: "component", index: 2 } },
      blades: { disabledGuids: [VALID_GUID] },
      operatingPoint: { speed: 125, alphaDegrees: 3, betaDegrees: -2, p: 0.1, q: -0.2, r: 0.3 },
    }],
    ui: {
      precision: "6",
      plotLab: {
        mode: "2d",
        display: "delta",
        xVariable: "q",
        quantities: ["pitchMoment", "bladePower"],
        range: { minimum: -0.2, maximum: 0.2, points: 9 },
        x2Variable: "alpha",
        y2Variable: "q",
        x2Range: { minimum: -10, maximum: 10, points: 11 },
        y2Range: { minimum: -0.5, maximum: 0.5, points: 13 },
        heatQuantity: "pitchMoment",
      },
    },
    ...overrides,
  });
}

test("analysis JSON import validates and restores serialized analysis/UI state", () => {
  const imported = parseAnalysisImport(analysisJson());
  assert.equal(imported.mode, "single");
  assert.deepEqual(imported.operatingPoint, { speed: 125, alphaDegrees: 3, betaDegrees: -2, p: 0.1, q: -0.2, r: 0.3 });
  assert.equal(imported.precision, "6");
  assert.equal(imported.plotLab.mode, "2d");
  assert.deepEqual(imported.plotLab.quantities, ["pitchMoment", "bladePower"]);
  assert.deepEqual(imported.machines[0].groupSelection, { kind: "component", index: 2 });
  assert.deepEqual(imported.machines[0].disabledBladeGuids, [VALID_GUID]);
});

test("analysis JSON import reports malformed, unsupported, and future schemas", () => {
  assert.throws(() => parseAnalysisImport("{"), /Malformed JSON/);
  assert.throws(() => parseAnalysisImport(JSON.stringify({ format: "something-else" })), /Unsupported JSON format/);
  assert.throws(() => parseAnalysisImport(analysisJson({ analysisVersion: "99.0.0" })), /newer than supported/);
  assert.throws(() => parseAnalysisImport(analysisJson({ machines: [{ metadata: { name: "X" }, selectedAnalysisGroup: { uiSelection: { kind: "all" } }, blades: { disabledGuids: ["not-a-guid"] }, operatingPoint: { speed: 1, alphaDegrees: 0, betaDegrees: 0, p: 0, q: 0, r: 0 } }] })), ImportValidationError);
});

test("CSV parser handles quotes, empty lines, units, and numeric column detection", () => {
  const table = parseCsv('q (rad/s),"Pitch, moment (game moment units)",note\r\n-0.5,"1,200",start\r\n\r\n0,0,"center, sample"\r\n0.5,1200,end');
  assert.deepEqual(table.headers, ["q (rad/s)", "Pitch, moment (game moment units)", "note"]);
  assert.deepEqual(table.numericColumns, ["q (rad/s)"]);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[1][2], "center, sample");
  assert.equal(table.units["q (rad/s)"], "rad/s");
});

test("CSV dataset construction preserves selected numeric samples and unknown units", () => {
  const table = parseCsv("x,value,other\n0,10,a\n1,20,b\n2,15,c\n");
  assert.deepEqual(table.numericColumns, ["x", "value"]);
  const dataset = buildImportedDataset(table, { id: "external", name: "Flight test", sourceFileName: "test.csv", xColumn: "x", yColumns: ["value"] });
  assert.equal(dataset.xUnits, "unknown");
  assert.equal(dataset.series[0].units, "unknown");
  assert.deepEqual(dataset.series[0].points, [{ x: 0, value: 10 }, { x: 1, value: 20 }, { x: 2, value: 15 }]);
});

const blade: VanillaBlade = {
  id: 26,
  guid: "plot-blade",
  kind: "Propeller",
  position: [1, 0, 2],
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: [1, 1, 1],
  booleans: new Map(),
  singles: new Map(),
  integers: new Map(),
  strings: new Map(),
  vectors: new Map(),
  flipped: false,
  flippedWasSerialized: true,
};
const state: AnalysisState = {
  speed: 100,
  alpha: 0,
  beta: 0,
  p: 0,
  q: 0,
  r: 0,
  centerOfGravity: [0, 0, 0],
  analysisGroup: { label: "test", mode: "all", blocks: [blade], excludedGuids: [], warnings: [] },
};

test("existing 1D Plot Lab CSV round-trips into an equivalent imported numerical dataset", () => {
  const result = evaluatePlot1D([blade], state, { variable: "q", minimum: -0.1, maximum: 0.1, points: 3, quantities: ["pitchMoment"] });
  const table = parseCsv(formatPlot1DCsv(result, "Test Machine"));
  const dataset = buildImportedDataset(table, {
    id: "round-trip",
    name: "Round trip",
    sourceFileName: "round-trip.csv",
    xColumn: table.suggestedXColumn!,
    yColumns: [table.suggestedYColumns[0]],
  });
  assert.deepEqual(dataset.series[0].points, result.points.map((point) => ({ x: point.x, value: point.values.pitchMoment })));
  assert.equal(dataset.xUnits, "rad/s");
  assert.equal(dataset.series[0].units, "game moment units");
});

test("browser file IO uses download fallback and treats picker cancel as a no-op", async () => {
  const downloads: Array<{ content: string; name: string; type: string }> = [];
  let accept = "";
  const io = createBrowserFileIo({
    download: (content, name, type) => downloads.push({ content, name, type }),
    pick: async (value) => { accept = value; return null; },
  });
  const saved = await io.saveTextFile({ suggestedName: "bad:name.csv", content: "x,y\n0,1", filter: CSV_FILE_FILTER });
  assert.equal(saved?.name, "bad_name.csv");
  assert.equal(downloads[0].content, "x,y\n0,1");
  assert.equal(await io.openTextFile({ filter: CSV_FILE_FILTER }), null);
  assert.equal(accept, ".csv");
});
