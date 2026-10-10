import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { solveAerodynamics } from "../src/aerodynamics.ts";
import { analyzeMachine, analyzeStability, sweepAlpha, type AnalysisState } from "../src/analysis.ts";
import type { BsgBlock, VanillaBlade } from "../src/bsg.ts";
import { loadBsg } from "../src/bsg-node.ts";
import {
  BUILD_SURFACE_WOOD_DRAG_MULTIPLIER,
  collectBuildSurfaceGeometries,
  reconstructBuildSurfaceGeometry,
} from "../src/build-surface-geometry.ts";
import { evaluateBuildSurface } from "../src/build-surface-physics.ts";
import { solveBlades, type SolverInput } from "../src/physics.ts";
import type { Vec3 } from "../src/math.ts";
import { evaluatePlot1D, evaluatePlot2D } from "../src/plot-lab.ts";

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 } as const;

function block(id: number, guid: string, position: Vec3, options: {
  booleans?: ReadonlyMap<string, boolean>;
  integers?: ReadonlyMap<string, number>;
  strings?: ReadonlyMap<string, string>;
} = {}): BsgBlock {
  return {
    id,
    guid,
    position,
    rotation: IDENTITY,
    scale: [1, 1, 1],
    booleans: options.booleans ?? new Map(),
    singles: new Map(),
    integers: options.integers ?? new Map(),
    strings: options.strings ?? new Map(),
    vectors: new Map(),
  };
}

function surfaceFixture(options: {
  aero?: boolean;
  glass?: boolean;
  triangle?: boolean;
  curved?: boolean;
} = {}): { blocks: readonly BsgBlock[]; surface: BsgBlock } {
  const points: readonly Vec3[] = options.triangle
    ? [[0, 0, 0], [2, 0, 0], [0, 0, 2]]
    : [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]];
  const nodes = points.map((point, index) => block(71, `n${index}`, point));
  const edges = nodes.map((node, index) => {
    const next = nodes[(index + 1) % nodes.length];
    const midpoint: Vec3 = [
      (node.position[0] + next.position[0]) / 2,
      (node.position[1] + next.position[1]) / 2,
      (node.position[2] + next.position[2]) / 2,
    ];
    const control: Vec3 = options.curved && index === 0
      ? [midpoint[0], midpoint[1] + 0.5, midpoint[2]]
      : midpoint;
    return block(72, `e${index}`, control, {
      strings: new Map([["start", node.guid], ["end", next.guid]]),
    });
  });
  const surface = block(73, "surface", [0, 0, 0], {
    booleans: new Map([["bmt-aero", options.aero ?? true]]),
    integers: new Map([["bmt-surfMat", options.glass ? 2 : 0]]),
    strings: new Map([["edges", edges.map((edge) => edge.guid).join("|")]]),
  });
  return { blocks: [...nodes, ...edges, surface], surface };
}

function input(linearVelocity: Vec3, angularVelocity: Vec3 = [0, 0, 0]): SolverInput {
  return {
    linearVelocity,
    angularVelocity,
    centerOfGravity: [0, 0, 0],
    forward: [0, 0, 1],
    up: [0, 1, 0],
  };
}

function geometry(options: Parameters<typeof surfaceFixture>[0] = {}) {
  const fixture = surfaceFixture(options);
  const result = reconstructBuildSurfaceGeometry(fixture.surface, new Map(fixture.blocks.map((entry) => [entry.guid, entry])));
  assert.ok(result);
  return result;
}

function near(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("rectangular wood BuildSurface uses the recovered per-corner law", () => {
  const subject = geometry();
  assert.equal(subject.surfaceArea, 4);
  assert.equal(subject.corners.length, 4);
  const result = evaluateBuildSurface(subject, input([0, 10, 0]));
  const expectedY = -10 * 100 * BUILD_SURFACE_WOOD_DRAG_MULTIPLIER * 4;
  near(result.totalForce[1], expectedY);
  near(result.totalPower, expectedY * 10);
  assert.ok(result.totalPower <= 0);
});

test("BuildSurface requires both bmt-aero and an aerodynamic material", () => {
  const disabled = geometry({ aero: false });
  const glass = geometry({ aero: true, glass: true });
  assert.equal(disabled.aerodynamicActive, false);
  assert.equal(glass.aerodynamicActive, false);
  assert.deepEqual(evaluateBuildSurface(disabled, input([0, 10, 0])).totalForce, [0, 0, 0]);
  assert.deepEqual(evaluateBuildSurface(glass, input([0, 10, 0])).totalForce, [0, 0, 0]);
});

test("parallel flow is zero and front/back forces are symmetric", () => {
  const subject = geometry();
  near(evaluateBuildSurface(subject, input([10, 0, 0])).totalForce[1], 0);
  const front = evaluateBuildSurface(subject, input([0, 10, 0]));
  const back = evaluateBuildSurface(subject, input([0, -10, 0]));
  near(front.totalForce[1], -back.totalForce[1]);
  near(front.totalPower, back.totalPower);
  assert.ok(front.totalPower < 0 && back.totalPower < 0);
});

test("45-degree flow preserves the literal dot-times-speed-squared behavior", () => {
  const subject = geometry();
  const result = evaluateBuildSurface(subject, input([0, 10, 10]));
  const expectedY = -10 * 200 * BUILD_SURFACE_WOOD_DRAG_MULTIPLIER * 4;
  near(result.totalForce[1], expectedY);
});

test("BuildSurface scales cubically below speed 300 and linearly above its squared-speed cap", () => {
  const subject = geometry();
  const belowA = Math.abs(evaluateBuildSurface(subject, input([0, 50, 0])).totalForce[1]);
  const belowB = Math.abs(evaluateBuildSurface(subject, input([0, 100, 0])).totalForce[1]);
  near(belowB / belowA, 8);
  const aboveA = Math.abs(evaluateBuildSurface(subject, input([0, 400, 0])).totalForce[1]);
  const aboveB = Math.abs(evaluateBuildSurface(subject, input([0, 600, 0])).totalForce[1]);
  near(aboveB / aboveA, 1.5);
});

test("pure angular velocity produces an opposing BuildSurface damping moment", () => {
  const result = evaluateBuildSurface(geometry(), input([0, 0, 0], [1, 0, 0]));
  assert.ok(result.totalMoment[0] < 0);
  assert.ok(result.totalPower < 0);
});

test("triangle and curved-edge BuildSurface geometry are finite and generated", () => {
  const triangle = geometry({ triangle: true });
  assert.equal(triangle.isQuad, false);
  near(triangle.surfaceArea, 2, 1e-6);
  assert.equal(triangle.corners.length, 3);
  const curved = geometry({ curved: true });
  assert.equal(curved.isQuad, true);
  assert.ok(curved.vertices.length > 4);
  assert.ok(curved.surfaceArea > 4);
  assert.ok(curved.vertices.every((vertex) => [...vertex.machinePosition, ...vertex.localNormal].every(Number.isFinite)));
});

test("combined aerodynamic totals equal blades plus BuildSurfaces", () => {
  const subject = geometry();
  const blade = {
    ...block(26, "blade", [2, 0, 0]),
    kind: "Propeller",
    flipped: false,
    flippedWasSerialized: true,
  } satisfies VanillaBlade;
  const result = solveAerodynamics([blade], [subject], input([0, 10, 10]));
  for (let axis = 0; axis < 3; axis += 1) {
    near(result.totalForce[axis], result.bladeTotals.force[axis] + result.buildSurfaceTotals.force[axis]);
    near(result.totalMoment[axis], result.bladeTotals.moment[axis] + result.buildSurfaceTotals.moment[axis]);
  }
  near(result.totalPower, result.totalBladePower + result.totalBuildSurfacePower);
});

test("BuildSurface contributions flow through derivatives and 1D/2D sweeps", () => {
  const fixture = surfaceFixture();
  const subject = geometry();
  const state: AnalysisState = {
    speed: 10,
    alpha: Math.PI / 2,
    beta: 0,
    p: 0,
    q: 0,
    r: 0,
    centerOfGravity: [0, 0, 0],
    analysisGroup: { label: "surface", mode: "all", blocks: fixture.blocks, excludedGuids: [], warnings: [] },
  };
  const stability = analyzeStability([], state, undefined, [subject]);
  assert.notEqual(stability.baseline.totalForce[1], 0);
  assert.notEqual(stability.derivatives.damping.pitchQ.derivative, 0);
  const standardSweep = sweepAlpha([], state, [-90, 0, 90], [subject]);
  assert.equal(standardSweep.points[1].totalForce[1], 0);
  assert.notEqual(standardSweep.points[0].totalForce[1], 0);
  const oneDimensional = evaluatePlot1D([], state, {
    variable: "alpha",
    minimum: -90,
    maximum: 90,
    points: 3,
    quantities: ["forceY", "bladePower"],
  }, undefined, [subject]);
  assert.notEqual(oneDimensional.points[0].values.forceY, 0);
  assert.ok(oneDimensional.points[0].values.bladePower < 0);
  const twoDimensional = evaluatePlot2D([], state, {
    xVariable: "speed",
    yVariable: "alpha",
    xRange: { minimum: 10, maximum: 20, points: 2 },
    yRange: { minimum: -90, maximum: 90, points: 3 },
    quantity: "forceY",
  }, [subject]);
  assert.ok(twoDimensional.points.some((point) => point.value !== 0));
});

const ESKAPIE = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Проект Ескапе.bsg";
const GRIPEN = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Besiege\\Besiege_Data\\SavedMachines\\Инженерная лига\\Cамолетики летающие\\Поцыки\\Saab JAS 39 Gripen2.bsg";

for (const [fixture, expectedSurfaces] of [[ESKAPIE, 6], [GRIPEN, 16]] as const) {
  test(`real fixture has no active BuildSurface aero and preserves blade-only totals: ${fixture.split("\\").at(-1)}`, { skip: !existsSync(fixture) }, () => {
    const machine = loadBsg(fixture);
    const collection = collectBuildSurfaceGeometries(machine.blocks);
    assert.equal(collection.surfaces.length, expectedSurfaces);
    assert.equal(collection.surfaces.filter((surface) => surface.aerodynamicActive).length, 0);
    const report = analyzeMachine(machine, {
      speed: 100,
      alpha: 0,
      beta: 0,
      p: 0,
      q: 0,
      r: 0,
      centerOfGravity: "auto",
      groupMode: "all",
    });
    const bladeOnly = solveBlades(report.blades, report.stability.baseline.input);
    assert.deepEqual(report.stability.baseline.totalForce, bladeOnly.totalForce);
    assert.deepEqual(report.stability.baseline.totalMoment, bladeOnly.totalMoment);
    assert.equal(report.stability.baseline.totalPower, bladeOnly.totalBladePower);
  });
}
