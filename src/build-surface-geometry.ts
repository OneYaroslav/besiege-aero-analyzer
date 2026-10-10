import type { BsgBlock } from "./bsg.ts";
import {
  add,
  cross,
  dot,
  magnitude,
  normalize,
  normalizeQuaternion,
  rotateVector,
  scale,
  subtract,
  type Quaternion,
  type Vec3,
} from "./math.ts";

export const BUILD_SURFACE_ID = 73;
export const BUILD_EDGE_ID = 72;
export const BUILD_NODE_ID = 71;

export const BUILD_SURFACE_WOOD_DRAG_MULTIPLIER = 0.0002500000118743628;
export const BUILD_SURFACE_DRAG_VELOCITY_CAP_SQUARED = 90000;

export type BuildSurfaceMaterial = "wood" | "glass";

export interface BuildSurfaceVertex {
  readonly localPosition: Vec3;
  readonly machinePosition: Vec3;
  readonly localNormal: Vec3;
  readonly u: number;
  readonly v: number;
}

export interface BuildSurfaceCorner {
  readonly index: number;
  readonly localPosition: Vec3;
  readonly machinePosition: Vec3;
  readonly localNormal: Vec3;
}

export interface BuildSurfaceGeometry {
  readonly block: BsgBlock;
  readonly material: BuildSurfaceMaterial;
  readonly aerodynamicToggle: boolean;
  readonly materialHasAerodynamics: boolean;
  readonly aerodynamicActive: boolean;
  readonly dragMultiplier: number;
  readonly dragVelocityCapSquared: number;
  readonly isQuad: boolean;
  readonly width: number;
  readonly height: number;
  /** Generated game-space area before the block TransformVector scale. */
  readonly surfaceArea: number;
  readonly vertices: readonly BuildSurfaceVertex[];
  readonly triangleIndices: readonly number[];
  readonly boundaryMachinePositions: readonly Vec3[];
  readonly corners: readonly BuildSurfaceCorner[];
}

export interface BuildSurfaceGeometryCollection {
  readonly surfaces: readonly BuildSurfaceGeometry[];
  readonly warnings: readonly string[];
}

interface EdgeGeometry {
  readonly block: BsgBlock;
  readonly startGuid: string;
  readonly endGuid: string;
  readonly startMachine: Vec3;
  readonly endMachine: Vec3;
  readonly controlMachine: Vec3;
  readonly straight: boolean;
  readonly length: number;
  readonly angleDegrees: number;
  readonly pointPath: readonly Vec3[];
  readonly inverted: boolean;
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, scale(subtract(b, a), t));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function inverseQuaternion(input: Quaternion): Quaternion {
  const q = normalizeQuaternion(input);
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function buildSurfaceLocalPointToMachine(block: BsgBlock, localPoint: Vec3): Vec3 {
  const scaled: Vec3 = [
    localPoint[0] * block.scale[0],
    localPoint[1] * block.scale[1],
    localPoint[2] * block.scale[2],
  ];
  return add(block.position, rotateVector(block.rotation, scaled));
}

export function buildSurfaceMachinePointToLocal(block: BsgBlock, machinePoint: Vec3): Vec3 {
  const unrotated = rotateVector(inverseQuaternion(block.rotation), subtract(machinePoint, block.position));
  if (block.scale.some((component) => Math.abs(component) < 1e-12)) {
    throw new Error(`BuildSurface ${block.guid}: transform scale contains zero`);
  }
  return [unrotated[0] / block.scale[0], unrotated[1] / block.scale[1], unrotated[2] / block.scale[2]];
}

/** Unity Transform.InverseTransformDirection: rotation only, no scale. */
export function buildSurfaceMachineDirectionToLocal(block: BsgBlock, direction: Vec3): Vec3 {
  return rotateVector(inverseQuaternion(block.rotation), direction);
}

/** Unity Transform.TransformVector: scale followed by rotation. */
export function buildSurfaceLocalVectorToMachine(block: BsgBlock, vector: Vec3): Vec3 {
  return rotateVector(block.rotation, [
    vector[0] * block.scale[0],
    vector[1] * block.scale[1],
    vector[2] * block.scale[2],
  ]);
}

function catmullRom(path: readonly Vec3[], t: number): Vec3 {
  const segments = path.length - 3;
  const segment = Math.min(Math.floor(t * segments), segments - 1);
  const u = t * segments - segment;
  const u2 = u * u;
  const u3 = u2 * u;
  const a = path[segment];
  const b = path[segment + 1];
  const c = path[segment + 2];
  const d = path[segment + 3];
  return [0, 1, 2].map((axis) => 0.5 * (
    (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * u3
    + (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * u2
    + (-a[axis] + c[axis]) * u
    + 2 * b[axis]
  )) as unknown as Vec3;
}

function makeEdge(
  edge: BsgBlock,
  nodeAtIndex: BsgBlock,
  nextNode: BsgBlock,
  byGuid: ReadonlyMap<string, BsgBlock>,
): EdgeGeometry | null {
  const startGuid = edge.strings.get("start");
  const endGuid = edge.strings.get("end");
  if (!startGuid || !endGuid) return null;
  const start = byGuid.get(startGuid);
  const end = byGuid.get(endGuid);
  if (!start || !end || start.id !== BUILD_NODE_ID || end.id !== BUILD_NODE_ID) return null;
  const startMachine = start.position;
  const endMachine = end.position;
  const controlMachine = edge.position;
  const delta = subtract(endMachine, startMachine);
  const midpoint = add(startMachine, scale(delta, 0.5));
  const straight = dot(subtract(controlMachine, midpoint), subtract(controlMachine, midpoint)) < 0.0001;
  let length = magnitude(delta);
  let angleDegrees = 0;
  let pointPath: readonly Vec3[] = [startMachine, endMachine];
  if (!straight) {
    const fromControlToStart = subtract(startMachine, controlMachine);
    const fromControlToEnd = subtract(endMachine, controlMachine);
    const firstLength = magnitude(fromControlToStart);
    const secondLength = magnitude(fromControlToEnd);
    if (firstLength < 1e-12 || secondLength < 1e-12) return null;
    length = firstLength + secondLength;
    const rhs = scale(fromControlToStart, 1 / firstLength);
    const towardEnd = scale(fromControlToEnd, 1 / secondLength);
    let cosine = dot(scale(towardEnd, -1), rhs);
    // The game clamps the result of Acos (radians), not its input.
    const angleRadians = clamp(Math.acos(clamp(cosine, -1, 1)), -1, 1);
    angleDegrees = angleRadians * 180 / Math.PI;
    if (Math.abs(angleDegrees) > 45) cosine = Math.cos(45 * Math.PI / 180);
    const axis = cross(scale(towardEnd, -1), rhs);
    const quaternion = normalizeQuaternion({ x: axis[0], y: axis[1], z: axis[2], w: 1 + cosine });
    const inverse = inverseQuaternion(quaternion);
    const firstTangent = rotateVector(quaternion, fromControlToStart);
    const secondTangent = rotateVector(inverse, fromControlToEnd);
    pointPath = [
      add(startMachine, firstTangent),
      startMachine,
      controlMachine,
      endMachine,
      add(endMachine, secondTangent),
    ];
  }
  return {
    block: edge,
    startGuid,
    endGuid,
    startMachine,
    endMachine,
    controlMachine,
    straight,
    length,
    angleDegrees,
    pointPath,
    inverted: startGuid === nextNode.guid && endGuid === nodeAtIndex.guid,
  };
}

function interpolateEdge(edge: EdgeGeometry, tInput: number): Vec3 {
  const t = edge.inverted ? 1 - tInput : tInput;
  return edge.straight ? lerp(edge.startMachine, edge.endMachine, t) : catmullRom(edge.pointPath, t);
}

function orderedTopology(
  surface: BsgBlock,
  byGuid: ReadonlyMap<string, BsgBlock>,
): { nodes: readonly BsgBlock[]; rawEdges: readonly BsgBlock[] } | null {
  const edgeGuids = surface.strings.get("edges")?.split("|").filter(Boolean) ?? [];
  if (edgeGuids.length !== 3 && edgeGuids.length !== 4) return null;
  const rawEdges = edgeGuids.map((guid) => byGuid.get(guid));
  if (rawEdges.some((edge) => !edge || edge.id !== BUILD_EDGE_ID)) return null;
  const edges = rawEdges as BsgBlock[];
  const nodeGuids = edges.map((edge, index) => {
    const start = edge.strings.get("start");
    const end = edge.strings.get("end");
    const nextStart = edges[(index + 1) % edges.length].strings.get("start");
    const nextEnd = edges[(index + 1) % edges.length].strings.get("end");
    if (!start || !end || !nextStart || !nextEnd) return undefined;
    // Exact BuildSurface.UpdateNodes ordering from Besiege.
    return end !== nextStart && end !== nextEnd ? end : start;
  });
  if (nodeGuids.some((guid) => !guid)) return null;
  const nodes = nodeGuids.map((guid) => byGuid.get(guid!));
  if (nodes.some((node) => !node || node.id !== BUILD_NODE_ID)) return null;
  return { nodes: nodes as BsgBlock[], rawEdges: edges };
}

function rightAngleAt(a: Vec3, center: Vec3, b: Vec3): boolean {
  const first = normalize(subtract(a, center), "BuildSurface corner edge");
  const second = normalize(subtract(b, center), "BuildSurface corner edge");
  const degrees = Math.acos(clamp(dot(first, second), -1, 1)) * 180 / Math.PI;
  return Math.abs(degrees - 90) < 10;
}

function sameCurveDirection(first: EdgeGeometry, second: EdgeGeometry): boolean {
  const firstMid = lerp(first.startMachine, first.endMachine, 0.5);
  const secondMid = lerp(second.startMachine, second.endMachine, 0.5);
  return dot(subtract(first.controlMachine, firstMid), subtract(second.controlMachine, secondMid)) > 0;
}

function surfaceMaterial(block: BsgBlock): BuildSurfaceMaterial {
  return (block.integers.get("bmt-surfMat") ?? block.integers.get("materialIndex") ?? 0) > 0 ? "glass" : "wood";
}

export function reconstructBuildSurfaceGeometry(
  surface: BsgBlock,
  blocksByGuid: ReadonlyMap<string, BsgBlock>,
): BuildSurfaceGeometry | null {
  if (surface.id !== BUILD_SURFACE_ID) return null;
  const topology = orderedTopology(surface, blocksByGuid);
  if (!topology) return null;
  const { nodes, rawEdges } = topology;
  const edges = rawEdges.map((edge, index) => makeEdge(
    edge,
    nodes[index],
    nodes[(index + 1) % nodes.length],
    blocksByGuid,
  ));
  if (edges.some((edge) => !edge)) return null;
  const resolvedEdges = edges as EdgeGeometry[];
  const localNodes = nodes.map((node) => buildSurfaceMachinePointToLocal(surface, node.position));
  const allStraight = resolvedEdges.every((edge) => edge.straight);
  const isQuad = nodes.length === 4;
  const maxWidth = Math.max(resolvedEdges[0].length, resolvedEdges[2].length);
  const maxHeight = isQuad
    ? Math.max(resolvedEdges[1].length, resolvedEdges[3].length)
    : resolvedEdges[1].length;
  let width = clamp(Math.ceil(maxWidth * 1.5), 5, 11);
  let height = clamp(Math.ceil(maxHeight * 1.5), 5, 11);
  if (isQuad && rightAngleAt(nodes[1].position, nodes[0].position, nodes[3].position)
      && rightAngleAt(nodes[1].position, nodes[2].position, nodes[3].position)) {
    if (allStraight) {
      width = 1;
      height = 1;
    } else {
      const oppositeHorizontalStraight = resolvedEdges[0].straight && resolvedEdges[2].straight;
      const oppositeVerticalStraight = resolvedEdges[1].straight && resolvedEdges[3].straight;
      if (oppositeHorizontalStraight
          && Math.abs(resolvedEdges[3].angleDegrees - resolvedEdges[1].angleDegrees) < 50
          && sameCurveDirection(resolvedEdges[3], resolvedEdges[1])) width = 1;
      else if (oppositeVerticalStraight
          && Math.abs(resolvedEdges[2].angleDegrees - resolvedEdges[0].angleDegrees) < 50
          && sameCurveDirection(resolvedEdges[2], resolvedEdges[0])) height = 1;
    }
  } else if (!isQuad && allStraight && Math.min(resolvedEdges[0].length, resolvedEdges[2].length) < 1.04) {
    width = 1;
    height = 1;
  }

  const edgePointLocal = (index: number, t: number): Vec3 => buildSurfaceMachinePointToLocal(
    surface,
    interpolateEdge(resolvedEdges[index], t),
  );
  const pointOnSurface = (u: number, v: number): Vec3 => {
    const a = localNodes[0];
    const b = localNodes[1];
    const c = localNodes[2];
    if (!isQuad) {
      const baseline = lerp(a, lerp(b, c, u), v);
      if (allStraight) return baseline;
      return subtract(
        add(lerp(a, edgePointLocal(1, u), v), lerp(edgePointLocal(0, v), edgePointLocal(2, 1 - v), u)),
        baseline,
      );
    }
    const d = localNodes[3];
    const baseline = lerp(lerp(a, b, u), lerp(d, c, u), v);
    if (allStraight) return baseline;
    return subtract(
      add(lerp(edgePointLocal(0, u), edgePointLocal(2, 1 - u), v), lerp(edgePointLocal(3, 1 - v), edgePointLocal(1, v), u)),
      baseline,
    );
  };
  const normalAt = (u: number, v: number): Vec3 => {
    const point = pointOnSurface(u, v);
    return normalize(cross(
      subtract(pointOnSurface(u, v + 0.05), point),
      subtract(pointOnSurface(u + 0.05, v), point),
    ), `BuildSurface ${surface.guid} normal`);
  };
  const vertices: BuildSurfaceVertex[] = [];
  for (let y = 0; y <= height; y += 1) {
    const v = y / height;
    for (let x = 0; x <= width; x += 1) {
      const u = x / width;
      let normalU = u;
      let normalV = v;
      if (!isQuad && y === 0) {
        normalU = x === width ? u - 0.06 : u;
        normalV = 0.06;
      } else if (y === 0 && x === 0) {
        normalU = 0.06;
        normalV = 0.06;
      } else if (x === width || y === height) {
        if (isQuad && y === 0 && x === width) {
          normalU = 1 - 0.06;
          normalV = 0.06;
        } else if (isQuad && y === height && x === 0) {
          normalU = 0.06;
          normalV = 1 - 0.06;
        } else if (isQuad && y === height && x === width) {
          normalU = 1 - 0.06;
          normalV = 1 - 0.06;
        } else {
          normalU = x === width ? u - 0.06 : u;
          normalV = y === height ? v - 0.06 : v;
        }
      }
      const localPosition = pointOnSurface(u, v);
      vertices.push({
        localPosition,
        machinePosition: buildSurfaceLocalPointToMachine(surface, localPosition),
        localNormal: normalAt(normalU, normalV),
        u,
        v,
      });
    }
  }

  const triangleIndices: number[] = [];
  let surfaceArea = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const topLeft = y * (width + 1) + x;
      const topRight = topLeft + 1;
      const bottomLeft = (y + 1) * (width + 1) + x;
      const bottomRight = bottomLeft + 1;
      triangleIndices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      const tl = vertices[topLeft].localPosition;
      const tr = vertices[topRight].localPosition;
      const bl = vertices[bottomLeft].localPosition;
      const br = vertices[bottomRight].localPosition;
      surfaceArea += 0.5 * magnitude(cross(subtract(tr, bl), subtract(tl, br)));
    }
  }
  const cornerIndices = [0, (width + 1) * height, (width + 1) * (height + 1) - 1, width].slice(0, nodes.length);
  const corners = cornerIndices.map((index) => ({
    index,
    localPosition: vertices[index].localPosition,
    machinePosition: vertices[index].machinePosition,
    localNormal: vertices[index].localNormal,
  }));
  const boundaryMachinePositions = [
    ...Array.from({ length: width + 1 }, (_, x) => vertices[x].machinePosition),
    ...Array.from({ length: height }, (_, y) => vertices[(y + 1) * (width + 1) + width].machinePosition),
    ...Array.from({ length: width }, (_, offset) => vertices[(height + 1) * (width + 1) - 2 - offset].machinePosition),
    ...Array.from({ length: Math.max(0, height - 1) }, (_, offset) => vertices[(height - 1 - offset) * (width + 1)].machinePosition),
  ];
  const material = surfaceMaterial(surface);
  const materialHasAerodynamics = material === "wood";
  const aerodynamicToggle = surface.booleans.get("bmt-aero") === true;
  return {
    block: surface,
    material,
    aerodynamicToggle,
    materialHasAerodynamics,
    aerodynamicActive: aerodynamicToggle && materialHasAerodynamics,
    dragMultiplier: materialHasAerodynamics ? BUILD_SURFACE_WOOD_DRAG_MULTIPLIER : 0,
    dragVelocityCapSquared: BUILD_SURFACE_DRAG_VELOCITY_CAP_SQUARED,
    isQuad,
    width,
    height,
    surfaceArea,
    vertices,
    triangleIndices,
    boundaryMachinePositions,
    corners,
  };
}

export function collectBuildSurfaceGeometries(
  selectedBlocks: readonly BsgBlock[],
  geometryBlocks: readonly BsgBlock[] = selectedBlocks,
): BuildSurfaceGeometryCollection {
  const blocksByGuid = new Map(geometryBlocks.map((block) => [block.guid, block]));
  const surfaces: BuildSurfaceGeometry[] = [];
  const warnings: string[] = [];
  for (const block of selectedBlocks) {
    if (block.id !== BUILD_SURFACE_ID) continue;
    try {
      const geometry = reconstructBuildSurfaceGeometry(block, blocksByGuid);
      if (geometry) surfaces.push(geometry);
      else warnings.push(`BuildSurface ${block.guid}: serialized edge/node geometry could not be reconstructed`);
    } catch (error) {
      warnings.push(`BuildSurface ${block.guid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { surfaces, warnings };
}
