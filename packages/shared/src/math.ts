/** Lightweight math helpers used by both client and server. */

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.sqrt(dist2(ax, ay, bx, by));

export const length2 = (x: number, y: number) => x * x + y * y;

export const normalize = (x: number, y: number): [number, number] => {
  const l = Math.sqrt(x * x + y * y);
  if (l < 1e-6) return [0, 0];
  return [x / l, y / l];
};

export const angleBetween = (ax: number, ay: number, bx: number, by: number) =>
  Math.atan2(by - ay, bx - ax);

export const angleDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** True when point (px,py) lies within FOV cone facing (dx,dy) with half-angle (rad). */
export const inCone = (
  px: number, py: number,
  ox: number, oy: number,
  dx: number, dy: number,
  range: number, halfFovRad: number
): boolean => {
  const vx = px - ox, vy = py - oy;
  const d2 = vx * vx + vy * vy;
  if (d2 > range * range) return false;
  if (d2 < 1e-6) return true;
  const len = Math.sqrt(d2);
  const dot = (vx * dx + vy * dy) / len;
  return dot >= Math.cos(halfFovRad);
};

/** Segment vs segment intersection test. */
export const segmentsIntersect = (
  a1x: number, a1y: number, a2x: number, a2y: number,
  b1x: number, b1y: number, b2x: number, b2y: number
): boolean => {
  const d1x = a2x - a1x, d1y = a2y - a1y;
  const d2x = b2x - b1x, d2y = b2y - b1y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false;
  const s = ((a1x - b1x) * d2y - (a1y - b1y) * d2x) / -denom;
  const t = ((a1x - b1x) * d1y - (a1y - b1y) * d1x) / -denom;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
};

/** Mulberry32 PRNG for deterministic procedural generation. */
export class PRNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  int(lo: number, hi: number): number { return Math.floor(this.range(lo, hi + 1)); }
  pick<T>(arr: T[]): T { return arr[this.int(0, arr.length - 1)]; }
}
