import { normalizeQuaternion, type Quaternion, type Vec3 } from "./math.ts";

/** Column-major 4x4 matrix, matching Unity Matrix4x4/Three.js multiplication order. */
export type VisualMatrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface VisualTrs {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export function visualTrsMatrix(transform: VisualTrs): VisualMatrix4 {
  const q = normalizeQuaternion(transform.rotation);
  const [sx, sy, sz] = transform.scale;
  const x2 = q.x + q.x;
  const y2 = q.y + q.y;
  const z2 = q.z + q.z;
  const xx = q.x * x2;
  const xy = q.x * y2;
  const xz = q.x * z2;
  const yy = q.y * y2;
  const yz = q.y * z2;
  const zz = q.z * z2;
  const wx = q.w * x2;
  const wy = q.w * y2;
  const wz = q.w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    transform.position[0], transform.position[1], transform.position[2], 1,
  ];
}

export function multiplyVisualMatrices(parent: VisualMatrix4, child: VisualMatrix4): VisualMatrix4 {
  const result = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] += parent[index * 4 + row] * child[column * 4 + index];
      }
    }
  }
  return result as unknown as VisualMatrix4;
}

/** Exact hierarchy order used by the Inspector: Machine * Block * prefab Vis. */
export function composeBesiegeVisualMatrix(machine: VisualTrs, block: VisualTrs, visualChild: VisualTrs): VisualMatrix4 {
  return multiplyVisualMatrices(
    multiplyVisualMatrices(visualTrsMatrix(machine), visualTrsMatrix(block)),
    visualTrsMatrix(visualChild),
  );
}

export function transformVisualPoint(matrix: VisualMatrix4, point: Vec3): Vec3 {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}
