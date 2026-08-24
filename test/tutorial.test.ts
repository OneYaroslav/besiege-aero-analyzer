import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractVanillaBlades, parseBsg } from "../src/bsg.ts";
import {
  TUTORIAL_STEPS,
  computeTutorialCardPosition,
  isTutorialStepComplete,
  type TutorialProgress,
} from "../src/tutorial.ts";
import { discoverMachine } from "../src/ui-model.ts";
import { resolveSchematicBlock } from "../src/schematic-geometry.ts";

const emptyProgress: TutorialProgress = {
  selectedBladeCount: 0,
  bladeGroupCount: 0,
  largestBladeGroupSize: 0,
  hasBaselineSnapshot: false,
  whatIfChanged: false,
  pitchDampingExample: null,
};

test("tutorial is a stable data-driven walkthrough with one step per standard sweep", () => {
  assert.equal(TUTORIAL_STEPS.length, 22);
  assert.equal(new Set(TUTORIAL_STEPS.map((step) => step.id)).size, TUTORIAL_STEPS.length);
  assert.equal(TUTORIAL_STEPS[0].id, "program-overview");
  assert.deepEqual(TUTORIAL_STEPS.slice(0, 7).map((step) => step.id), [
    "program-overview",
    "tutorial-aircraft",
    "components",
    "operating-point",
    "current-state",
    "static-response",
    "damping-response",
  ]);
  assert.equal(TUTORIAL_STEPS.at(-1)?.id, "finish");
  assert.ok(TUTORIAL_STEPS.filter((step) => step.completion).length >= 4);
  assert.deepEqual(
    TUTORIAL_STEPS.filter((step) => step.id.endsWith("sweep")).map((step) => step.id),
    ["alpha-sweep", "pitch-q-sweep", "beta-sweep", "yaw-r-sweep", "roll-p-sweep"],
  );
  const locale = JSON.parse(readFileSync(new URL("../locales/en/tutorial.json", import.meta.url), "utf8")) as {
    steps: Record<string, { title?: string; content?: string }>;
  };
  for (const step of TUTORIAL_STEPS) {
    assert.ok(locale.steps[step.id]?.title, `missing tutorial title for ${step.id}`);
    assert.ok(locale.steps[step.id]?.content, `missing tutorial content for ${step.id}`);
  }
});

test("interactive tutorial conditions unlock only after their real session action", () => {
  const byId = (id: string) => TUTORIAL_STEPS.find((step) => step.id === id)!;
  assert.equal(isTutorialStepComplete(byId("blade-selection"), emptyProgress), false);
  assert.equal(isTutorialStepComplete(byId("blade-selection"), { ...emptyProgress, selectedBladeCount: 1 }), true);
  assert.equal(isTutorialStepComplete(byId("blade-groups"), { ...emptyProgress, bladeGroupCount: 1, largestBladeGroupSize: 1 }), false);
  assert.equal(isTutorialStepComplete(byId("blade-groups"), { ...emptyProgress, bladeGroupCount: 1, largestBladeGroupSize: 2 }), true);
  assert.equal(isTutorialStepComplete(byId("snapshot"), { ...emptyProgress, hasBaselineSnapshot: true }), true);
  assert.equal(isTutorialStepComplete(byId("what-if"), { ...emptyProgress, whatIfChanged: true }), true);
});

test("tutorial card placement stays inside the viewport and flips away from edges", () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 380, height: 230 };
  const nearRight = { left: 1020, right: 1180, top: 250, bottom: 450, width: 160, height: 200 };
  const placed = computeTutorialCardPosition(nearRight, card, viewport, "right");
  assert.ok(placed.left >= 12);
  assert.ok(placed.top >= 12);
  assert.ok(placed.left + card.width <= viewport.width - 12);
  assert.ok(placed.top + card.height <= viewport.height - 12);
  assert.notEqual(placed.placement, "right");
});

test("bundled tutorial aircraft parses through the normal core and heuristic keeps every blade", () => {
  const path = new URL("../public/tutorial/tutorial-aircraft.bsg", import.meta.url);
  const machine = parseBsg(readFileSync(path, "utf8"), "tutorial-aircraft.bsg");
  const blades = extractVanillaBlades(machine);
  const discovery = discoverMachine(machine);
  assert.equal(machine.name, "Изделие-17М4Б1ОБЛ");
  assert.equal(machine.blocks.length, 216);
  assert.equal(blades.length, 18);
  assert.equal(discovery.suggestion.suggestedAircraft.bladeCount, blades.length);
  assert.equal(discovery.suggestion.suggestedAircraft.blocks.length, 206);
  const byGuid = new Map(machine.blocks.map((block) => [block.guid, block]));
  const buildEdges = machine.blocks.filter((block) => block.id === 72);
  const buildSurfaces = machine.blocks.filter((block) => block.id === 73);
  assert.ok(buildEdges.length > 0);
  assert.ok(buildSurfaces.length > 0);
  assert.ok(buildEdges.every((block) => block.strings.has("start") && block.strings.has("end")));
  assert.ok(buildSurfaces.every((block) => block.strings.has("edges")));
  assert.ok(buildSurfaces.every((block) => resolveSchematicBlock(block, byGuid).kind === "surface"));
});
