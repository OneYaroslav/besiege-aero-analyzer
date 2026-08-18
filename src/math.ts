export type Vec3 = readonly [number, number, number];

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const ZERO: Vec3 = [0, 0, 0];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: Vec3, scalar: number): Vec3 {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function magnitudeSquared(v: Vec3): number {
  return dot(v, v);
}

export function magnitude(v: Vec3): number {
  return Math.sqrt(magnitudeSquared(v));
}

export function normalize(v: Vec3, label = "vector"): Vec3 {
  const length = magnitude(v);
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new Error(`${label} must have non-zero finite length`);
  }
  return scale(v, 1 / length);
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new Error("quaternion must have non-zero finite length");
  }
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

/** Unity-compatible quaternion rotation of a direction vector. */
export function rotateVector(qInput: Quaternion, v: Vec3): Vec3 {
  const q = normalizeQuaternion(qInput);
  const u: Vec3 = [q.x, q.y, q.z];
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return add(v, add(scale(uv, 2 * q.w), scale(uuv, 2)));
}

export function rotationAroundZ(angleRadians: number): Quaternion {
  const half = angleRadians / 2;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

export function almostEqual(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}
