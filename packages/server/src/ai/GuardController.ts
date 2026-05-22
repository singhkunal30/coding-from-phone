import {
  GUARD, GUARD_VARIANTS, GuardType, GuardState, MatchPhase,
  inCone, dist, dist2, normalize, clamp,
  CLASS_TRAITS, PlayerClass,
} from '@blackout/shared';
import type { HeistState, GuardSchema, PlayerSchema } from '@blackout/shared';
import { PhysicsWorld } from '../world/Physics.js';

interface PatrolData {
  waypoints: { x: number; y: number }[];
  index: number;
  lastSeenX: number;
  lastSeenY: number;
  lastSeenAt: number;
  lastAttackAt: number;
  spawnX: number;
  spawnY: number;
}

/**
 * Authoritative guard AI. Behaviour pipeline each tick:
 *   1) Perceive: vision cone + hearing budget.
 *   2) Update alert level (decay or gain).
 *   3) State transitions (patrol→investigate→chase→attack→return).
 *   4) Steering: pathless seek with wall-sliding (good enough at this scale).
 */
export class GuardController {
  private state: Map<string, PatrolData> = new Map();

  constructor(private physics: PhysicsWorld) {}

  register(id: string, waypoints: { x: number; y: number }[], spawnX: number, spawnY: number) {
    this.state.set(id, {
      waypoints, index: 0,
      lastSeenX: 0, lastSeenY: 0, lastSeenAt: 0, lastAttackAt: 0,
      spawnX, spawnY,
    });
  }

  unregister(id: string) {
    this.state.delete(id);
  }

  /** Notify guards within hearing range of an event location. Used by gunshots, alarm, broken doors. */
  notifyNoise(state: HeistState, x: number, y: number, radius: number, intensity = 25) {
    state.guards.forEach((g) => {
      if (g.state === GuardState.DEAD) return;
      if (dist(g.x, g.y, x, y) > radius) return;
      g.alertLevel = clamp(g.alertLevel + intensity, 0, 100);
      const data = this.state.get(g.id);
      if (data) {
        data.lastSeenX = x;
        data.lastSeenY = y;
        data.lastSeenAt = Date.now();
      }
    });
  }

  /** External callback invoked when a guard's alert level crosses the chase threshold. */
  onChaseTriggered?: (g: GuardSchema) => void;

  tick(state: HeistState, dt: number) {
    if (state.phase !== MatchPhase.ACTIVE && state.phase !== MatchPhase.EXTRACTION) return;
    const now = Date.now();

    state.guards.forEach((g) => {
      if (g.state === GuardState.DEAD) return;
      const data = this.state.get(g.id);
      if (!data) return;
      const variant = GUARD_VARIANTS[(g.variant as GuardType)] ?? GUARD_VARIANTS[GuardType.PATROL];

      const target = this.findVisibleTarget(state, g, variant);
      const prevAlert = g.alertLevel;
      if (target) {
        g.alertLevel = clamp(g.alertLevel + GUARD.ALERT_GAIN_VISIBLE_PER_SEC * variant.alertGainMul * dt, 0, 100);
        data.lastSeenX = target.x;
        data.lastSeenY = target.y;
        data.lastSeenAt = now;
        g.targetPlayerId = target.id;
      } else {
        g.alertLevel = clamp(g.alertLevel - GUARD.ALERT_DECAY_PER_SEC * dt, 0, 100);
        if (now - data.lastSeenAt > GUARD.LOST_SIGHT_TIMEOUT_MS) {
          g.targetPlayerId = '';
        }
      }
      // Crossed chase threshold this tick → notify (used to raise alarm).
      if (prevAlert < GUARD.ALERT_THRESHOLD_CHASE && g.alertLevel >= GUARD.ALERT_THRESHOLD_CHASE) {
        this.onChaseTriggered?.(g);
      }

      // Alarm pulls all guards toward chase regardless of personal vision.
      if (state.alarmActive && g.alertLevel < 60) g.alertLevel = 60;

      const chaseSpeed = GUARD.CHASE_SPEED * (variant.stationary ? 0 : variant.speedMul);
      const invSpeed = GUARD.INVESTIGATE_SPEED * (variant.stationary ? 0 : variant.speedMul);
      const patSpeed = GUARD.PATROL_SPEED * (variant.stationary ? 0 : variant.speedMul);

      if (g.alertLevel >= GUARD.ALERT_THRESHOLD_CHASE && target) {
        if (dist(g.x, g.y, target.x, target.y) < GUARD.ATTACK_RANGE) {
          g.state = GuardState.ATTACK;
          this.attack(state, g, target, now, data);
        } else {
          g.state = GuardState.CHASE;
          this.seekTo(state, g, target.x, target.y, dt, chaseSpeed);
        }
      } else if (g.alertLevel >= GUARD.ALERT_THRESHOLD_INVESTIGATE) {
        g.state = GuardState.INVESTIGATE;
        const tx = data.lastSeenX, ty = data.lastSeenY;
        if (dist(g.x, g.y, tx, ty) < 0.8) {
          g.alertLevel = clamp(g.alertLevel - 12 * dt, 0, 100);
        } else {
          this.seekTo(state, g, tx, ty, dt, invSpeed);
        }
      } else if (!variant.stationary && dist(g.x, g.y, data.spawnX, data.spawnY) > 2 && data.waypoints.length === 0) {
        g.state = GuardState.RETURN;
        this.seekTo(state, g, data.spawnX, data.spawnY, dt, patSpeed);
      } else {
        g.state = GuardState.PATROL;
        if (variant.stationary) {
          // Sentries scan slowly back and forth.
          const t = (now / 1000) * 0.7;
          const a = Math.sin(t) * 0.9;
          g.dirX = Math.cos(a);
          g.dirY = Math.sin(a);
        } else {
          this.patrol(state, g, dt, data, patSpeed);
        }
      }
    });
  }

  private patrol(state: HeistState, g: GuardSchema, dt: number, data: PatrolData, speed = GUARD.PATROL_SPEED) {
    if (data.waypoints.length === 0) return;
    const wp = data.waypoints[data.index];
    if (dist(g.x, g.y, wp.x, wp.y) < 0.7) {
      data.index = (data.index + 1) % data.waypoints.length;
      return;
    }
    this.seekTo(state, g, wp.x, wp.y, dt, speed);
  }

  private seekTo(state: HeistState, g: GuardSchema, tx: number, ty: number, dt: number, speed: number) {
    const [nx, ny] = normalize(tx - g.x, ty - g.y);
    g.dirX = nx; g.dirY = ny;
    const dx = nx * speed * dt, dy = ny * speed * dt;
    const { x, y } = this.physics.moveWithSliding(g.x, g.y, dx, dy, 0.45, state);
    g.x = x; g.y = y;
  }

  private attack(state: HeistState, g: GuardSchema, target: PlayerSchema, now: number, data: PatrolData) {
    const [nx, ny] = normalize(target.x - g.x, target.y - g.y);
    g.dirX = nx; g.dirY = ny;
    if (now - data.lastAttackAt < GUARD.ATTACK_COOLDOWN_MS) return;
    data.lastAttackAt = now;
    target.health = Math.max(0, target.health - GUARD.ATTACK_DAMAGE);
    if (target.health <= 0 && target.state === 'alive') {
      target.state = 'down';
    }
  }

  /** Returns the closest player visible to the guard, or null. */
  private findVisibleTarget(state: HeistState, g: GuardSchema, variant: typeof GUARD_VARIANTS[GuardType]): PlayerSchema | null {
    const halfFov = (GUARD.VISION_FOV_DEG * variant.fovDegMul * Math.PI / 180) / 2;
    const range = GUARD.VISION_RANGE * variant.rangeMul;
    let best: PlayerSchema | null = null;
    let bestDist = Infinity;
    state.players.forEach((p) => {
      if (p.state !== 'alive' || !p.connected) return;
      // Class trait can shrink/expand the player's effective visibility radius.
      const visMul = CLASS_TRAITS[p.className as PlayerClass]?.visionRadiusMul ?? 1;
      const effRange = range * visMul;
      if (!inCone(p.x, p.y, g.x, g.y, g.dirX, g.dirY, effRange, halfFov)) {
        if (dist2(p.x, p.y, g.x, g.y) > GUARD.HEARING_RANGE * GUARD.HEARING_RANGE) return;
      }
      if (this.physics.lineBlocked(g.x, g.y, p.x, p.y)) return;
      const d = dist2(g.x, g.y, p.x, p.y);
      if (d < bestDist) { bestDist = d; best = p; }
    });
    return best;
  }
}
