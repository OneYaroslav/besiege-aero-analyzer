import process from "node:process";
import {
  ANALYSIS_CONVENTION,
  analyzeBladeContributions,
  analyzeMachine,
  compareMachines,
  degreesToRadians,
  sweepAlpha,
  sweepBeta,
  sweepRate,
  type BladeContributionAnalysis,
  type ContributionDerivative,
  type MachineAnalysis,
  type MachineAnalysisConfig,
  type StabilityAnalysis,
  type SweepResult,
} from "./analysis.ts";
import { extractVanillaBlades, type BsgMachine } from "./bsg.ts";
import { loadBsg } from "./bsg-node.ts";
import { selectAnalysisGroup, type ComponentSuggestion } from "./groups.ts";
import { analyzeMass, type MassAnalysis, type PointMassInertia } from "./mass.ts";
import { magnitude, subtract, type Quaternion, type Vec3 } from "./math.ts";
import { solveBlades, type SolverResult } from "./physics.ts";

type CgOption = "auto" | Vec3;
type MassGroupOption = "all" | "aircraft-heuristic";

interface CliOptions {
  bsg?: string;
  compare?: readonly [string, string];
  velocity: Vec3;
  omega: Vec3;
  velocityWasSet: boolean;
  omegaWasSet: boolean;
  cg: CgOption;
  forward: Vec3;
  up: Vec3;
  massGroup: MassGroupOption;
  includeGuids: Set<string>;
  excludeGuids: Set<string>;
  componentThreshold: number;
  diagnoseComponents: boolean;
  analysisRequested: boolean;
  speed: number;
  alphaDegrees: number;
  betaDegrees: number;
  p: number;
  q: number;
  r: number;
  alphaStepDegrees: number;
  betaStepDegrees: number;
  rateStep: number;
  sweepAlpha: boolean;
  sweepBeta: boolean;
  sweepRollRate: boolean;
  sweepPitchRate: boolean;
  sweepYawRate: boolean;
  bladeContributions: Set<ContributionDerivative>;
  contributionLimit?: number;
  summaryOnly: boolean;
  json: boolean;
  help: boolean;
}

const USAGE = `Usage:
  node src/cli.ts --bsg <machine.bsg> [options]
  node src/cli.ts --compare <first.bsg> <second.bsg> [analysis options]

Options:
  --v x,y,z                 Linear velocity in machine-local units/s (default 0,0,0)
  --omega x,y,z             Angular velocity in machine-local rad/s (default 0,0,0)
  --cg auto|x,y,z           Static mass-model CG or a manual CG (default auto)
  --mass-group all|aircraft-heuristic
                            Blocks used by mass model and blade solver (default all)
  --include-guid GUID[,..]  Analyze only these GUIDs; option may be repeated
  --exclude-guid GUID[,..]  Exclude these GUIDs; option may be repeated
  --component-threshold N   Root-proximity heuristic radius (default 1.5)
  --diagnose-components     Print heuristic components and every non-aircraft block
  --analyze-stability       Evaluate baseline plus static/damping derivatives
  --compare A.bsg B.bsg     Analyze two machines at the identical operating point
  --speed N                 AnalysisState speed (default 100)
  --alpha DEG               AnalysisState alpha (default 0)
  --beta DEG                AnalysisState beta (default 0)
  --p N                     Roll rate about +Z, rad/s (default 0)
  --q N                     Pitch rate about +X, rad/s (default 0)
  --r N                     Yaw rate about +Y, rad/s (default 0)
  --alpha-step DEG          Central-difference alpha step (default 1)
  --beta-step DEG           Central-difference beta step (default 1)
  --rate-step N             Central-difference rate step, rad/s (default 0.01)
  --sweep-alpha             Sweep -15..+15 degrees
  --sweep-beta              Sweep -15..+15 degrees
  --sweep-roll-rate         Sweep p over -0.50..+0.50 rad/s
  --sweep-pitch-rate        Sweep q over -0.50..+0.50 rad/s
  --sweep-yaw-rate          Sweep r over -0.50..+0.50 rad/s
  --blade-contributions NAME[,..]
                            pitch-damping, yaw-damping, roll-damping,
                            pitch-alpha, or yaw-beta
  --contribution-limit N    Limit sorted contribution rows (default all)
  --forward x,y,z           Manual machine-forward axis (default 0,0,1)
  --up x,y,z                Manual machine-up axis (default 0,1,0)
  --summary-only            Omit the per-blade debug rows
  --json                    Emit machine-readable JSON
  --help                    Show this help

The default group is explicitly ALL blocks; the aircraft heuristic is never
selected silently. Fixed analysis axes: forward=+Z, up=+Y, right=+X;
omega=(q,r,p), moments=(pitch Mx, yaw My, roll Mz).`;

function parseVector(text: string, option: string): Vec3 {
  const parts = text.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${option} expects three finite comma-separated numbers`);
  }
  return [parts[0], parts[1], parts[2]];
}

function addGuids(target: Set<string>, text: string, option: string): void {
  const guids = text.split(",").map((guid) => guid.trim()).filter(Boolean);
  if (guids.length === 0) throw new Error(`${option} expects at least one GUID`);
  for (const guid of guids) target.add(guid);
}

function finiteOption(text: string, option: string): number {
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`${option} expects a finite number`);
  return number;
}

const CONTRIBUTION_NAMES = new Set<ContributionDerivative>([
  "pitch-damping",
  "yaw-damping",
  "roll-damping",
  "pitch-alpha",
  "yaw-beta",
]);

function addContributionNames(target: Set<ContributionDerivative>, text: string): void {
  const names = text.split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("--blade-contributions expects at least one name");
  for (const name of names) {
    if (!CONTRIBUTION_NAMES.has(name as ContributionDerivative)) {
      throw new Error(`--blade-contributions: unsupported derivative ${JSON.stringify(name)}`);
    }
    target.add(name as ContributionDerivative);
  }
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    velocity: [0, 0, 0],
    omega: [0, 0, 0],
    velocityWasSet: false,
    omegaWasSet: false,
    cg: "auto",
    forward: [0, 0, 1],
    up: [0, 1, 0],
    massGroup: "all",
    includeGuids: new Set(),
    excludeGuids: new Set(),
    componentThreshold: 1.5,
    diagnoseComponents: false,
    analysisRequested: false,
    speed: 100,
    alphaDegrees: 0,
    betaDegrees: 0,
    p: 0,
    q: 0,
    r: 0,
    alphaStepDegrees: 1,
    betaStepDegrees: 1,
    rateStep: 0.01,
    sweepAlpha: false,
    sweepBeta: false,
    sweepRollRate: false,
    sweepPitchRate: false,
    sweepYawRate: false,
    bladeContributions: new Set(),
    summaryOnly: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${option} requires a value`);
      index += 1;
      return next;
    };
    if (option === "--bsg") options.bsg = value();
    else if (option === "--compare") {
      options.compare = [value(), value()];
      options.analysisRequested = true;
    } else if (option === "--v") {
      options.velocity = parseVector(value(), option);
      options.velocityWasSet = true;
    } else if (option === "--omega") {
      options.omega = parseVector(value(), option);
      options.omegaWasSet = true;
    }
    else if (option === "--cg") {
      const raw = value();
      options.cg = raw.toLowerCase() === "auto" ? "auto" : parseVector(raw, option);
    } else if (option === "--mass-group") {
      const group = value();
      if (group !== "all" && group !== "aircraft-heuristic") {
        throw new Error("--mass-group expects all or aircraft-heuristic");
      }
      options.massGroup = group;
    } else if (option === "--include-guid") addGuids(options.includeGuids, value(), option);
    else if (option === "--exclude-guid") addGuids(options.excludeGuids, value(), option);
    else if (option === "--component-threshold") {
      options.componentThreshold = Number(value());
      if (!(options.componentThreshold > 0) || !Number.isFinite(options.componentThreshold)) {
        throw new Error("--component-threshold expects a positive finite number");
      }
    } else if (option === "--diagnose-components") options.diagnoseComponents = true;
    else if (option === "--analyze-stability") options.analysisRequested = true;
    else if (option === "--speed") {
      options.speed = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--alpha") {
      options.alphaDegrees = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--beta") {
      options.betaDegrees = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--p") {
      options.p = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--q") {
      options.q = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--r") {
      options.r = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--alpha-step") {
      options.alphaStepDegrees = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--beta-step") {
      options.betaStepDegrees = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--rate-step") {
      options.rateStep = finiteOption(value(), option);
      options.analysisRequested = true;
    } else if (option === "--sweep-alpha") {
      options.sweepAlpha = true;
      options.analysisRequested = true;
    } else if (option === "--sweep-beta") {
      options.sweepBeta = true;
      options.analysisRequested = true;
    } else if (option === "--sweep-roll-rate") {
      options.sweepRollRate = true;
      options.analysisRequested = true;
    } else if (option === "--sweep-pitch-rate") {
      options.sweepPitchRate = true;
      options.analysisRequested = true;
    } else if (option === "--sweep-yaw-rate") {
      options.sweepYawRate = true;
      options.analysisRequested = true;
    } else if (option === "--blade-contributions") {
      addContributionNames(options.bladeContributions, value());
      options.analysisRequested = true;
    } else if (option === "--contribution-limit") {
      options.contributionLimit = finiteOption(value(), option);
      if (!Number.isInteger(options.contributionLimit) || options.contributionLimit <= 0) {
        throw new Error("--contribution-limit expects a positive integer");
      }
      options.analysisRequested = true;
    }
    else if (option === "--forward") options.forward = parseVector(value(), option);
    else if (option === "--up") options.up = parseVector(value(), option);
    else if (option === "--summary-only") options.summaryOnly = true;
    else if (option === "--json") options.json = true;
    else if (option === "--help" || option === "-h") options.help = true;
    else if (!option.startsWith("-") && options.bsg === undefined) options.bsg = option;
    else throw new Error(`Unknown option ${JSON.stringify(option)}`);
  }
  return options;
}

function f(value: number): string {
  return value.toFixed(6);
}

function vec(v: Vec3): string {
  return `(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
}

function quat(q: Quaternion): string {
  return `(${f(q.x)}, ${f(q.y)}, ${f(q.z)}, ${f(q.w)})`;
}

function inertiaText(value: PointMassInertia): string {
  return `xx=${f(value.xx)} yy=${f(value.yy)} zz=${f(value.zz)}` +
    ` xy=${f(value.xy)} xz=${f(value.xz)} yz=${f(value.yz)}`;
}

function printMass(mass: MassAnalysis, cgMode: CgOption, usedCg: Vec3): void {
  console.log(
    `AnalysisGroup: ${mass.group.label} | selected=${mass.group.blocks.length}` +
    ` excluded=${mass.group.excludedGuids.length} | mode=${mass.group.mode}`,
  );
  console.log(
    `Mass DB: Besiege ${mass.database.gameVersion} | Unity ${mass.database.unityVersion}` +
    ` | Assembly-CSharp SHA-256=${mass.database.assemblyCSharpSha256}`,
  );
  console.log(`Static mass model: total=${f(mass.totalMass)} CG=${vec(mass.centerOfMass)}`);
  console.log(`Point-mass approximate inertia about CG: ${inertiaText(mass.pointMassInertia)}`);
  console.log(
    `Mass provenance: prefab-verified=${mass.provenanceCounts["prefab-verified"]}` +
    ` block-specific-override=${mass.provenanceCounts["block-specific-override"]}` +
    ` runtime-required=${mass.provenanceCounts["runtime-required"]}` +
    ` unknown=${mass.provenanceCounts.unknown}`,
  );
  console.log(`Solver CG: ${cgMode === "auto" ? "AUTO static mass model" : "MANUAL"} ${vec(usedCg)}`);
}

function printComponentDiagnosis(
  machine: BsgMachine,
  suggestion: ComponentSuggestion,
  allMass: MassAnalysis,
): void {
  const byGuid = new Map(allMass.contributions.map((entry) => [entry.block.guid, entry]));
  console.log("\nPhysical-component diagnostic:");
  console.log(`  ${suggestion.warning}`);
  console.log(
    `  method=${suggestion.method} threshold=${suggestion.threshold}` +
    ` blade centroid=${vec(suggestion.bladeCentroid)}`,
  );
  for (const component of suggestion.components) {
    const componentMass = analyzeMass({
      label: `heuristic component #${component.index}`,
      mode: "include",
      blocks: component.blocks,
      excludedGuids: machine.blocks
        .filter((block) => !component.blocks.includes(block))
        .map((block) => block.guid),
      warnings: [suggestion.warning],
    });
    const marker = component === suggestion.suggestedAircraft ? "SUGGESTED AIRCRAFT" : "NOT AUTO-EXCLUDED";
    console.log(
      `  component #${component.index}: ${marker} blocks=${component.blocks.length}` +
      ` blades=${component.bladeCount} mass=${f(componentMass.totalMass)}` +
      ` CG=${vec(componentMass.centerOfMass)} distance=${f(component.distanceToBladeCentroid)}`,
    );
  }

  console.log("\nBlocks outside suggested aircraft component (heuristic only):");
  for (const component of suggestion.components.filter((entry) => entry !== suggestion.suggestedAircraft)) {
    console.log(`  -- component #${component.index} --`);
    for (const block of component.blocks) {
      const mass = byGuid.get(block.guid)!;
      const distance = magnitude(subtract(block.position, suggestion.bladeCentroid));
      const flag = (key: string): string => String(block.booleans.get(key) ?? "not-serialized");
      console.log(
        `  guid=${block.guid} id=${block.id} type=${mass.type} pos=${vec(block.position)}` +
        ` mass=${mass.mass === null ? "unknown" : f(mass.mass)}` +
        ` massSource=${mass.massProvenance} Rigidbody=${mass.hasRigidbody}` +
        ` bmt-NoCollider=${flag("bmt-NoCollider")} bmt-Passive=${flag("bmt-Passive")}` +
        ` bmt-Enhancement=${flag("bmt-Enhancement")} bmt-SimpleSet=${flag("bmt-SimpleSet")}` +
        ` bmt-Forcemass=${flag("bmt-Forcemass")} bladeDistance=${f(distance)}`,
      );
    }
  }
}

function printResult(
  machine: BsgMachine,
  result: SolverResult,
  mass: MassAnalysis,
  cgMode: CgOption,
  suggestion: ComponentSuggestion,
  allMass: MassAnalysis,
  options: Pick<CliOptions, "summaryOnly" | "diagnoseComponents">,
): void {
  const large = result.blades.filter(({ blade }) => blade.id === 26).length;
  const small = result.blades.length - large;
  console.log(`Machine: ${machine.name} | BSG ${machine.bsgVersion} | ${machine.source}`);
  console.log(`Frame: machine-local (Global position=${vec(machine.globalPosition)}, rotation=${quat(machine.globalRotation)} is not applied)`);
  console.log(`Machine blocks: ${machine.blocks.length} | analyzed blades: ${result.blades.length} (Propeller=${large}, SmallPropeller=${small})`);
  printMass(mass, cgMode, result.input.centerOfGravity);
  console.log(
    `Aircraft suggestion: component #${suggestion.suggestedAircraft.index}` +
    ` blocks=${suggestion.suggestedAircraft.blocks.length}` +
    ` blades=${suggestion.suggestedAircraft.bladeCount}; ${suggestion.warning}`,
  );
  console.log(`Input: V=${vec(result.input.linearVelocity)} omega=${vec(result.input.angularVelocity)} rad/s`);
  console.log(`Axes: forward=${vec(result.axes.forward)} up=${vec(result.axes.up)} right=${vec(result.axes.right)}`);
  for (const warning of [...machine.warnings, ...mass.warnings]) console.log(`WARNING: ${warning}`);
  for (const { blade } of result.blades) {
    if (!blade.flippedWasSerialized) console.log(`WARNING: blade ${blade.guid} has no serialized flipped value; using vanilla default false`);
  }

  if (options.diagnoseComponents) printComponentDiagnosis(machine, suggestion, allMass);

  if (!options.summaryOnly) {
    console.log("\nPer-blade debug output:");
    result.blades.forEach((entry, index) => {
      const b = entry.blade;
      console.log(
        `[${String(index + 1).padStart(2, "0")}] ${b.kind} id=${b.id} guid=${b.guid} flipped=${b.flipped}` +
        ` pos=${vec(b.position)} q=${quat(b.rotation)} scale=${vec(b.scale)}`,
      );
      console.log(
        `     r=${vec(entry.radiusFromCg)} v=${vec(entry.localVelocity)}` +
        ` forceAxis=${vec(entry.forceAxis)} senseAxis=${vec(entry.senseAxis)}`,
      );
      console.log(`     force=${vec(entry.force)} moment(CG)=${vec(entry.momentAboutCg)} F.v=${f(entry.power)}`);
    });
  }

  console.log("\nTotals:");
  console.log(`  force=${vec(result.totalForce)}`);
  console.log(`  moment(CG)=${vec(result.totalMoment)}`);
  console.log(`  pitch=${f(result.moments.pitch)} roll=${f(result.moments.roll)} yaw=${f(result.moments.yaw)}`);
  console.log(`  blade power sum(F.v)=${f(result.totalBladePower)}`);
}

interface AnalysisExtras {
  readonly sweeps: readonly SweepResult[];
  readonly contributions: readonly BladeContributionAnalysis[];
}

function analysisConfig(options: CliOptions): MachineAnalysisConfig {
  return {
    speed: options.speed,
    alpha: degreesToRadians(options.alphaDegrees),
    beta: degreesToRadians(options.betaDegrees),
    p: options.p,
    q: options.q,
    r: options.r,
    centerOfGravity: options.cg,
    groupMode: options.massGroup,
    includeGuids: options.includeGuids,
    excludeGuids: options.excludeGuids,
    proximityThreshold: options.componentThreshold,
    steps: {
      alphaRadians: degreesToRadians(options.alphaStepDegrees),
      betaRadians: degreesToRadians(options.betaStepDegrees),
      rateRadPerSecond: options.rateStep,
    },
  };
}

function analysisExtras(report: MachineAnalysis, options: CliOptions): AnalysisExtras {
  const sweeps: SweepResult[] = [];
  if (options.sweepAlpha) sweeps.push(sweepAlpha(report.blades, report.state));
  if (options.sweepBeta) sweeps.push(sweepBeta(report.blades, report.state));
  if (options.sweepRollRate) sweeps.push(sweepRate(report.blades, report.state, "p"));
  if (options.sweepPitchRate) sweeps.push(sweepRate(report.blades, report.state, "q"));
  if (options.sweepYawRate) sweeps.push(sweepRate(report.blades, report.state, "r"));
  return {
    sweeps,
    contributions: [...options.bladeContributions].map((name) =>
      analyzeBladeContributions(report.blades, report.state, name, {
        alphaRadians: report.stability.steps.alphaRadians,
        betaRadians: report.stability.steps.betaRadians,
        rateRadPerSecond: report.stability.steps.rateRadPerSecond,
      })
    ),
  };
}

function printAvailableGroups(report: MachineAnalysis): void {
  console.log(`Available component suggestion: ${report.suggestion.warning}`);
  for (const component of report.suggestion.components) {
    const marker = component === report.suggestion.suggestedAircraft ? " suggested-aircraft" : "";
    console.log(
      `  component #${component.index}: blocks=${component.blocks.length}` +
      ` blades=${component.bladeCount} distance-to-blade-centroid=${f(component.distanceToBladeCentroid)}${marker}`,
    );
  }
}

function printStability(stability: StabilityAnalysis): void {
  const state = stability.operatingPoint;
  console.log(
    `Operating point: speed=${f(state.speed)} alpha=${f(state.alpha * 180 / Math.PI)} deg` +
    ` beta=${f(state.beta * 180 / Math.PI)} deg p=${f(state.p)} q=${f(state.q)} r=${f(state.r)} rad/s`,
  );
  console.log(`  V=${vec(stability.linearVelocity)} omega=${vec(stability.angularVelocity)} CG=${vec(state.centerOfGravity)}`);
  console.log(
    `  steps: alpha=${f(stability.steps.alphaDegrees)} deg beta=${f(stability.steps.betaDegrees)} deg` +
    ` rate=${f(stability.steps.rateRadPerSecond)} rad/s`,
  );
  const baseline = stability.baseline;
  console.log(
    `Baseline: force=${vec(baseline.totalForce)} moment=${vec(baseline.totalMoment)}` +
    ` pitch=${f(baseline.moments.pitch)} roll=${f(baseline.moments.roll)}` +
    ` yaw=${f(baseline.moments.yaw)} power=${f(baseline.totalBladePower)}`,
  );
  const derivatives = stability.derivatives;
  console.log("Static derivatives (moment/radian):");
  console.log(
    `  dM_pitch/dAlpha=${f(derivatives.static.pitchAlpha.derivative)}` +
    ` dM_yaw/dBeta=${f(derivatives.static.yawBeta.derivative)}` +
    ` dM_roll/dBeta=${f(derivatives.static.rollBeta.derivative)}`,
  );
  console.log(
    `  dF/dAlpha=${vec(derivatives.force.alpha.derivative)}` +
    ` dF/dBeta=${vec(derivatives.force.beta.derivative)} force/radian`,
  );
  console.log("Rotational damping derivatives (moment/(rad/s)):");
  console.log(
    `  dM_roll/dp=${f(derivatives.damping.rollP.derivative)}` +
    ` dM_pitch/dq=${f(derivatives.damping.pitchQ.derivative)}` +
    ` dM_yaw/dr=${f(derivatives.damping.yawR.derivative)}`,
  );
  console.log("Cross-rate derivatives (moment/(rad/s)):");
  console.log(
    `  dM_pitch/dr=${f(derivatives.crossDamping.pitchR.derivative)}` +
    ` dM_pitch/dp=${f(derivatives.crossDamping.pitchP.derivative)}` +
    ` dM_yaw/dq=${f(derivatives.crossDamping.yawQ.derivative)}`,
  );
  console.log(
    `  dM_yaw/dp=${f(derivatives.crossDamping.yawP.derivative)}` +
    ` dM_roll/dq=${f(derivatives.crossDamping.rollQ.derivative)}` +
    ` dM_roll/dr=${f(derivatives.crossDamping.rollR.derivative)}`,
  );
}

function printSweep(result: SweepResult): void {
  console.log(`\n${result.variable} sweep (${result.points[0]?.units ?? "units"}; absolute values):`);
  for (const point of result.points) {
    console.log(
      `  ${result.variable}=${point.value}: force=${vec(point.totalForce)}` +
      ` pitch=${f(point.moments.pitch)} roll=${f(point.moments.roll)}` +
      ` yaw=${f(point.moments.yaw)} power=${f(point.totalBladePower)}`,
    );
  }
}

function printContributions(result: BladeContributionAnalysis, limit?: number): void {
  const rows = limit === undefined ? result.blades : result.blades.slice(0, limit);
  console.log(
    `\nPer-blade ${result.derivative}: total=${f(result.totalDerivative)}` +
    ` sum=${f(result.contributionSum)} ${result.units}; rows=${rows.length}/${result.blades.length}`,
  );
  for (const entry of rows) {
    const percentage = entry.percentageOfTotal === null ? "n/a" : `${f(entry.percentageOfTotal)}%`;
    console.log(
      `  guid=${entry.guid} id=${entry.id} type=${entry.type} pos=${vec(entry.position)}` +
      ` flipped=${entry.flipped} baselineMoment=${vec(entry.baselineMoment)}` +
      ` baselineProjected=${f(entry.baselineProjectedMoment)}` +
      ` derivative=${f(entry.derivativeContribution)} abs=${f(entry.absoluteContribution)}` +
      ` share=${percentage}`,
    );
  }
}

function printMachineAnalysis(report: MachineAnalysis, extras: AnalysisExtras, options: CliOptions): void {
  const large = report.blades.filter((blade) => blade.id === 26).length;
  console.log(`\n=== ${report.machine.name} ===`);
  console.log(`Source: ${report.machine.source} | BSG ${report.machine.bsgVersion}`);
  console.log(
    `Blocks: machine=${report.machine.blocks.length} selected=${report.mass.group.blocks.length}` +
    ` group=${report.mass.group.label} mode=${report.mass.group.mode}`,
  );
  if (report.mass.group.mode === "aircraft-heuristic") console.log(`WARNING: ${report.suggestion.warning}`);
  printAvailableGroups(report);
  if (options.diagnoseComponents) {
    const allMass = report.mass.group.mode === "all" && report.mass.group.excludedGuids.length === 0
      ? report.mass
      : analyzeMass({
        label: "all machine blocks",
        mode: "all",
        blocks: report.machine.blocks,
        excludedGuids: [],
        warnings: [],
      });
    printComponentDiagnosis(report.machine, report.suggestion, allMass);
  }
  console.log(
    `Mass=${f(report.mass.totalMass)} CG=${vec(report.state.centerOfGravity)}` +
    ` blades=${report.blades.length} (Propeller=${large}, SmallPropeller=${report.blades.length - large})`,
  );
  for (const warning of report.mass.warnings) console.log(`WARNING: ${warning}`);
  printStability(report.stability);
  for (const result of extras.sweeps) printSweep(result);
  for (const result of extras.contributions) printContributions(result, options.contributionLimit);
}

function solverJson(result: SolverResult): object {
  return {
    bladeCount: result.blades.length,
    totalForce: result.totalForce,
    totalMoment: result.totalMoment,
    moments: result.moments,
    totalBladePower: result.totalBladePower,
  };
}

function analysisJson(report: MachineAnalysis, extras: AnalysisExtras, options: CliOptions): object {
  const large = report.blades.filter((blade) => blade.id === 26).length;
  return {
    machine: {
      name: report.machine.name,
      source: report.machine.source,
      version: report.machine.version,
      bsgVersion: report.machine.bsgVersion,
      blockCount: report.machine.blocks.length,
    },
    availableAnalysisGroups: {
      method: report.suggestion.method,
      threshold: report.suggestion.threshold,
      warning: report.suggestion.warning,
      components: report.suggestion.components.map((component) => ({
        index: component.index,
        blockCount: component.blocks.length,
        bladeCount: component.bladeCount,
        centroid: component.centroid,
        distanceToBladeCentroid: component.distanceToBladeCentroid,
        suggestedAircraft: component === report.suggestion.suggestedAircraft,
      })),
    },
    selectedAnalysisGroup: {
      label: report.mass.group.label,
      mode: report.mass.group.mode,
      blockCount: report.mass.group.blocks.length,
      excludedGuids: report.mass.group.excludedGuids,
      warnings: report.mass.group.warnings,
    },
    mass: {
      totalMass: report.mass.totalMass,
      centerOfGravity: report.state.centerOfGravity,
      autoCenterOfGravity: report.mass.centerOfMass,
      pointMassInertia: report.mass.pointMassInertia,
      provenanceCounts: report.mass.provenanceCounts,
      database: report.mass.database,
      warnings: report.mass.warnings,
    },
    blades: {
      total: report.blades.length,
      propeller: large,
      smallPropeller: report.blades.length - large,
    },
    stability: {
      operatingPoint: {
        speed: report.state.speed,
        alphaRadians: report.state.alpha,
        alphaDegrees: report.state.alpha * 180 / Math.PI,
        betaRadians: report.state.beta,
        betaDegrees: report.state.beta * 180 / Math.PI,
        pRadPerSecond: report.state.p,
        qRadPerSecond: report.state.q,
        rRadPerSecond: report.state.r,
        centerOfGravity: report.state.centerOfGravity,
        analysisGroup: {
          label: report.mass.group.label,
          mode: report.mass.group.mode,
          blockCount: report.mass.group.blocks.length,
        },
      },
      linearVelocity: report.stability.linearVelocity,
      angularVelocity: report.stability.angularVelocity,
      steps: report.stability.steps,
      baseline: solverJson(report.stability.baseline),
      derivatives: report.stability.derivatives,
      unitsAndConvention: ANALYSIS_CONVENTION,
    },
    sweeps: extras.sweeps,
    bladeContributions: extras.contributions.map((contribution) => ({
      ...contribution,
      blades: options.contributionLimit === undefined
        ? contribution.blades
        : contribution.blades.slice(0, options.contributionLimit),
    })),
  };
}

function printComparison(first: MachineAnalysis, second: MachineAnalysis): void {
  const a = first.stability;
  const b = second.stability;
  const row = (label: string, firstValue: string | number, secondValue: string | number): void => {
    console.log(`  ${label}: ${first.machine.name}=${firstValue} | ${second.machine.name}=${secondValue}`);
  };
  console.log("\n=== Raw numerical comparison (no ranking) ===");
  row("machine blocks", first.machine.blocks.length, second.machine.blocks.length);
  row("selected blocks", first.mass.group.blocks.length, second.mass.group.blocks.length);
  row("mass", f(first.mass.totalMass), f(second.mass.totalMass));
  row("CG", vec(first.state.centerOfGravity), vec(second.state.centerOfGravity));
  row("blades", first.blades.length, second.blades.length);
  row("baseline force", vec(a.baseline.totalForce), vec(b.baseline.totalForce));
  row("baseline pitch/roll/yaw", `${f(a.baseline.moments.pitch)}/${f(a.baseline.moments.roll)}/${f(a.baseline.moments.yaw)}`, `${f(b.baseline.moments.pitch)}/${f(b.baseline.moments.roll)}/${f(b.baseline.moments.yaw)}`);
  row("baseline power", f(a.baseline.totalBladePower), f(b.baseline.totalBladePower));
  row("dM_pitch/dAlpha", f(a.derivatives.static.pitchAlpha.derivative), f(b.derivatives.static.pitchAlpha.derivative));
  row("dM_yaw/dBeta", f(a.derivatives.static.yawBeta.derivative), f(b.derivatives.static.yawBeta.derivative));
  row("dM_roll/dBeta", f(a.derivatives.static.rollBeta.derivative), f(b.derivatives.static.rollBeta.derivative));
  row("dM_roll/dp", f(a.derivatives.damping.rollP.derivative), f(b.derivatives.damping.rollP.derivative));
  row("dM_pitch/dq", f(a.derivatives.damping.pitchQ.derivative), f(b.derivatives.damping.pitchQ.derivative));
  row("dM_yaw/dr", f(a.derivatives.damping.yawR.derivative), f(b.derivatives.damping.yawR.derivative));
}

export function runCli(argv: readonly string[]): number {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const emitJson = (value: unknown): void => {
    console.log(JSON.stringify(value, (_key, entry) => {
      if (entry instanceof Map) return Object.fromEntries(entry);
      if (entry instanceof Set) return [...entry];
      if (typeof entry === "number" && !Number.isFinite(entry)) return String(entry);
      return entry;
    }, 2));
  };

  if (options.compare && options.bsg) throw new Error("Use either --bsg or --compare, not both");
  if (options.analysisRequested) {
    if (options.velocityWasSet || options.omegaWasSet) {
      throw new Error("AnalysisState uses --speed/--alpha/--beta/--p/--q/--r; do not combine it with --v/--omega");
    }
    if (options.forward.some((value, index) => value !== ([0, 0, 1] as Vec3)[index]) ||
        options.up.some((value, index) => value !== ([0, 1, 0] as Vec3)[index])) {
      throw new Error("Stability analysis has fixed machine-local axes forward=+Z, up=+Y, right=+X");
    }
    if (options.compare) {
      if (options.includeGuids.size > 0 || options.excludeGuids.size > 0) {
        throw new Error("--compare does not apply one GUID include/exclude set to two machines; select a shared --mass-group");
      }
      const comparison = compareMachines(
        loadBsg(options.compare[0]),
        loadBsg(options.compare[1]),
        analysisConfig(options),
      );
      const firstExtras = analysisExtras(comparison.first, options);
      const secondExtras = analysisExtras(comparison.second, options);
      if (options.json) {
        emitJson({
          mode: "compare",
          convention: comparison.convention,
          machines: [
            analysisJson(comparison.first, firstExtras, options),
            analysisJson(comparison.second, secondExtras, options),
          ],
        });
      } else {
        console.log(`Coordinate convention: ${ANALYSIS_CONVENTION.rates.omegaMapping}`);
        printMachineAnalysis(comparison.first, firstExtras, options);
        printMachineAnalysis(comparison.second, secondExtras, options);
        printComparison(comparison.first, comparison.second);
      }
      return 0;
    }

    if (!options.bsg) throw new Error(`Missing --bsg path\n\n${USAGE}`);
    const report = analyzeMachine(loadBsg(options.bsg), analysisConfig(options));
    const extras = analysisExtras(report, options);
    if (options.json) emitJson({ mode: "stability", ...analysisJson(report, extras, options) });
    else {
      console.log(`Coordinate convention: ${ANALYSIS_CONVENTION.rates.omegaMapping}`);
      printMachineAnalysis(report, extras, options);
    }
    return 0;
  }

  if (!options.bsg) throw new Error(`Missing --bsg path\n\n${USAGE}`);
  const machine = loadBsg(options.bsg);
  const allBlades = extractVanillaBlades(machine);
  const { group, suggestion } = selectAnalysisGroup(machine, allBlades, {
    mode: options.massGroup,
    includeGuids: options.includeGuids,
    excludeGuids: options.excludeGuids,
    proximityThreshold: options.componentThreshold,
  });
  const mass = analyzeMass(group);
  const groupGuids = new Set(group.blocks.map((block) => block.guid));
  const blades = allBlades.filter((blade) => groupGuids.has(blade.guid));
  const usedCg = options.cg === "auto" ? mass.centerOfMass : options.cg;
  const result = solveBlades(blades, {
    linearVelocity: options.velocity,
    angularVelocity: options.omega,
    centerOfGravity: usedCg,
    forward: options.forward,
    up: options.up,
  });
  const allMass = group.mode === "all" && group.excludedGuids.length === 0
    ? mass
    : analyzeMass({ label: "all machine blocks", mode: "all", blocks: machine.blocks, excludedGuids: [], warnings: [] });
  if (options.json) {
    emitJson({
      machine,
      analysisGroup: group,
      componentSuggestion: suggestion,
      mass,
      solver: result,
    });
  } else {
    printResult(machine, result, mass, options.cg, suggestion, allMass, options);
  }
  return 0;
}

try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
