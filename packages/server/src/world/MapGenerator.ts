import { PRNG, WORLD } from '@blackout/shared';

export interface GeneratedRoom {
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
}

export interface GeneratedDoor {
  x: number; y: number;
  angle: number;          // 0 horizontal, PI/2 vertical
  requiresKeycard: boolean;
}

export interface GeneratedMap {
  seed: number;
  width: number;
  height: number;
  walls: { x1: number; y1: number; x2: number; y2: number }[];
  rooms: GeneratedRoom[];
  doors: GeneratedDoor[];
  lootSpawns: { x: number; y: number; weight: number }[];
  guardPatrolPaths: { x: number; y: number }[][];
  playerSpawns: { x: number; y: number }[];
  extractionZones: { x: number; y: number; radius: number }[];
  keycardSpawn: { x: number; y: number } | null;
}

/**
 * Binary Space Partitioning (BSP) generator. Subdivides the world rectangle
 * recursively into rooms, connects them with doors at shared walls.
 * Fast, deterministic from seed, produces visually clean facility layouts.
 */
export class MapGenerator {
  private rng: PRNG;

  constructor(private seed: number) {
    this.rng = new PRNG(seed);
  }

  generate(): GeneratedMap {
    const width = WORLD.WIDTH;
    const height = WORLD.HEIGHT;
    const rooms = this.bsp(2, 2, width - 4, height - 4, 4);
    const walls: GeneratedMap['walls'] = [];
    const doors: GeneratedDoor[] = [];

    // Outer walls
    walls.push({ x1: 0, y1: 0, x2: width, y2: 0 });
    walls.push({ x1: width, y1: 0, x2: width, y2: height });
    walls.push({ x1: width, y1: height, x2: 0, y2: height });
    walls.push({ x1: 0, y1: height, x2: 0, y2: 0 });

    // Build walls from rooms, but punch door openings at midpoints of shared walls.
    // For simplicity here, we generate full room rectangles then cut a 2-unit door per wall segment shared by two rooms.
    const segments = this.buildSegments(rooms);
    for (const seg of segments) {
      if (seg.shared) {
        // Cut a door opening in the middle, ~2 units wide.
        const midX = (seg.x1 + seg.x2) / 2;
        const midY = (seg.y1 + seg.y2) / 2;
        const isHorizontal = Math.abs(seg.y2 - seg.y1) < 0.001;
        const doorWidth = 2.0;
        if (isHorizontal) {
          walls.push({ x1: seg.x1, y1: seg.y1, x2: midX - doorWidth / 2, y2: seg.y1 });
          walls.push({ x1: midX + doorWidth / 2, y1: seg.y1, x2: seg.x2, y2: seg.y1 });
          doors.push({
            x: midX, y: seg.y1, angle: 0,
            requiresKeycard: this.rng.next() < 0.18,
          });
        } else {
          walls.push({ x1: seg.x1, y1: seg.y1, x2: seg.x1, y2: midY - doorWidth / 2 });
          walls.push({ x1: seg.x1, y1: midY + doorWidth / 2, x2: seg.x1, y2: seg.y2 });
          doors.push({
            x: seg.x1, y: midY, angle: Math.PI / 2,
            requiresKeycard: this.rng.next() < 0.18,
          });
        }
      } else {
        walls.push({ x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
      }
    }

    // Player spawn cluster in the smallest corner room (entry).
    const sortedByArea = [...rooms].sort((a, b) => a.w * a.h - b.w * b.h);
    const spawnRoom = sortedByArea[0];
    const playerSpawns = this.scatter(spawnRoom, 6, 0.5);

    // Extraction zone in farthest room from spawn.
    let extractionRoom = rooms[0];
    let maxD = -Infinity;
    for (const r of rooms) {
      const d = (r.cx - spawnRoom.cx) ** 2 + (r.cy - spawnRoom.cy) ** 2;
      if (d > maxD) { maxD = d; extractionRoom = r; }
    }
    const extractionZones = [
      { x: extractionRoom.cx, y: extractionRoom.cy, radius: 3.0 },
    ];

    // Loot spawns: pick from non-spawn, non-extraction rooms; weight toward larger rooms.
    const lootRooms = rooms.filter(r => r !== spawnRoom && r !== extractionRoom);
    const lootSpawns: GeneratedMap['lootSpawns'] = [];
    for (const r of lootRooms) {
      // 1 loot per ~200 sqr units; clamps to 1..3 per room → ~10–20 total.
      const count = Math.max(1, Math.min(3, Math.floor((r.w * r.h) / 200)));
      for (let i = 0; i < count; i++) {
        const points = this.scatter(r, 1, 1.5);
        lootSpawns.push({ x: points[0].x, y: points[0].y, weight: 1 });
      }
    }

    // Guard patrol paths: one path per medium+ room visiting interior waypoints.
    const guardPatrolPaths: GeneratedMap['guardPatrolPaths'] = [];
    for (const r of rooms) {
      if (r === spawnRoom) continue;
      if (r.w * r.h < 30) continue;
      const wp = this.scatter(r, 3, 1.5);
      // Convex circuit
      guardPatrolPaths.push(wp);
    }

    // Keycard spawn: in a random non-extraction room.
    const keycardRoom = this.rng.pick(rooms.filter(r => r !== extractionRoom));
    const keycardSpawn = keycardRoom
      ? this.scatter(keycardRoom, 1, 1.5)[0]
      : null;

    return {
      seed: this.seed,
      width,
      height,
      walls,
      rooms,
      doors,
      lootSpawns,
      guardPatrolPaths,
      playerSpawns,
      extractionZones,
      keycardSpawn,
    };
  }

  private bsp(x: number, y: number, w: number, h: number, depth: number): GeneratedRoom[] {
    if (depth <= 0 || (w < 12 && h < 12)) {
      return [{ x, y, w, h, cx: x + w / 2, cy: y + h / 2 }];
    }
    const splitHoriz = w > h ? this.rng.next() < 0.7 : this.rng.next() < 0.3;
    if (splitHoriz && w >= 12) {
      const split = this.rng.range(0.4, 0.6) * w;
      return [
        ...this.bsp(x, y, split, h, depth - 1),
        ...this.bsp(x + split, y, w - split, h, depth - 1),
      ];
    } else if (h >= 12) {
      const split = this.rng.range(0.4, 0.6) * h;
      return [
        ...this.bsp(x, y, w, split, depth - 1),
        ...this.bsp(x, y + split, w, h - split, depth - 1),
      ];
    }
    return [{ x, y, w, h, cx: x + w / 2, cy: y + h / 2 }];
  }

  /**
   * Builds the set of unique wall segments around all rooms,
   * marking those shared with another room (these become doors).
   */
  private buildSegments(rooms: GeneratedRoom[]) {
    const segMap = new Map<string, { x1: number; y1: number; x2: number; y2: number; shared: boolean }>();
    const addSeg = (x1: number, y1: number, x2: number, y2: number) => {
      // canonicalize
      const key = x1 < x2 || (x1 === x2 && y1 < y2)
        ? `${x1.toFixed(3)},${y1.toFixed(3)},${x2.toFixed(3)},${y2.toFixed(3)}`
        : `${x2.toFixed(3)},${y2.toFixed(3)},${x1.toFixed(3)},${y1.toFixed(3)}`;
      const existing = segMap.get(key);
      if (existing) {
        existing.shared = true;
      } else {
        segMap.set(key, { x1, y1, x2, y2, shared: false });
      }
    };
    for (const r of rooms) {
      addSeg(r.x, r.y, r.x + r.w, r.y);
      addSeg(r.x + r.w, r.y, r.x + r.w, r.y + r.h);
      addSeg(r.x + r.w, r.y + r.h, r.x, r.y + r.h);
      addSeg(r.x, r.y + r.h, r.x, r.y);
    }
    // Also need to subdivide overlapping collinear segments to detect partial sharing.
    // For prototype simplicity, accept slight over-walls; BSP keeps room edges aligned anyway.
    return [...segMap.values()];
  }

  private scatter(room: GeneratedRoom, count: number, margin: number) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      pts.push({
        x: this.rng.range(room.x + margin, room.x + room.w - margin),
        y: this.rng.range(room.y + margin, room.y + room.h - margin),
      });
    }
    return pts;
  }
}
