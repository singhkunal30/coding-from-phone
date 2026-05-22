import { segmentsIntersect } from '@blackout/shared';
import type { HeistState, WallSchema } from '@blackout/shared';

/**
 * Simple grid spatial index of wall segments for fast point/segment queries.
 * Segments are stored once but referenced by every cell their AABB overlaps.
 */
export class PhysicsWorld {
  private cellSize = 4;
  private grid = new Map<string, WallSchema[]>();
  private allWalls: WallSchema[] = [];

  constructor(walls: WallSchema[]) {
    for (const w of walls) this.addWall(w);
  }

  addWall(w: WallSchema) {
    this.allWalls.push(w);
    const minX = Math.min(w.x1, w.x2), maxX = Math.max(w.x1, w.x2);
    const minY = Math.min(w.y1, w.y2), maxY = Math.max(w.y1, w.y2);
    const cs = this.cellSize;
    for (let gx = Math.floor(minX / cs); gx <= Math.floor(maxX / cs); gx++) {
      for (let gy = Math.floor(minY / cs); gy <= Math.floor(maxY / cs); gy++) {
        const key = `${gx},${gy}`;
        let cell = this.grid.get(key);
        if (!cell) { cell = []; this.grid.set(key, cell); }
        cell.push(w);
      }
    }
  }

  /** Find walls potentially intersecting a movement segment. */
  private candidateWalls(x1: number, y1: number, x2: number, y2: number): WallSchema[] {
    const cs = this.cellSize;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const seen = new Set<WallSchema>();
    for (let gx = Math.floor(minX / cs); gx <= Math.floor(maxX / cs); gx++) {
      for (let gy = Math.floor(minY / cs); gy <= Math.floor(maxY / cs); gy++) {
        const cell = this.grid.get(`${gx},${gy}`);
        if (cell) for (const w of cell) seen.add(w);
      }
    }
    return [...seen];
  }

  /** True if line-of-sight from (a) to (b) is blocked by a wall. Doors handled by caller. */
  lineBlocked(ax: number, ay: number, bx: number, by: number, ignore?: WallSchema[]): boolean {
    const candidates = this.candidateWalls(ax, ay, bx, by);
    const ignoreSet = ignore ? new Set(ignore) : null;
    for (const w of candidates) {
      if (ignoreSet?.has(w)) continue;
      if (segmentsIntersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2)) return true;
    }
    return false;
  }

  /**
   * Slide-against-walls movement. Returns new position after attempting to move
   * an entity of given radius from current position by (dx,dy).
   */
  moveWithSliding(cx: number, cy: number, dx: number, dy: number, radius: number, state: HeistState): { x: number; y: number } {
    // Two-pass axis-aligned slide. Cheap; good enough for top-down at this scale.
    const tryStep = (nx: number, ny: number) => !this.entityIntersectsWalls(nx, ny, radius, state);
    let x = cx, y = cy;
    if (tryStep(x + dx, y)) x += dx;
    if (tryStep(x, y + dy)) y += dy;
    return { x, y };
  }

  private entityIntersectsWalls(x: number, y: number, radius: number, state: HeistState): boolean {
    // World bounds
    if (x < radius || y < radius || x > state.mapData.width - radius || y > state.mapData.height - radius) return true;
    const candidates = this.candidateWalls(x - radius, y - radius, x + radius, y + radius);
    for (const w of candidates) {
      if (this.circleSegment(x, y, radius, w.x1, w.y1, w.x2, w.y2)) return true;
    }
    // Closed doors also block
    state.doors.forEach((d) => {
      // Skip — handled below
      if (d) {/* no-op */}
    });
    return this.circleHitsClosedDoor(x, y, radius, state);
  }

  private circleHitsClosedDoor(x: number, y: number, radius: number, state: HeistState): boolean {
    let hit = false;
    state.doors.forEach((d) => {
      if (hit || d.open) return;
      const halfW = 1.0;
      let x1: number, y1: number, x2: number, y2: number;
      if (d.angle < Math.PI / 4) {
        x1 = d.x - halfW; y1 = d.y; x2 = d.x + halfW; y2 = d.y;
      } else {
        x1 = d.x; y1 = d.y - halfW; x2 = d.x; y2 = d.y + halfW;
      }
      if (this.circleSegment(x, y, radius, x1, y1, x2, y2)) hit = true;
    });
    return hit;
  }

  private circleSegment(cx: number, cy: number, r: number, ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-9 ? ((cx - ax) * dx + (cy - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const ddx = cx - px, ddy = cy - py;
    return ddx * ddx + ddy * ddy <= r * r;
  }
}
