/**
 * Single source of truth for gameplay tuning values.
 * Shared between authoritative server and client (for prediction / UI).
 */

export const TICK_RATE = 20;                  // server simulation ticks per second
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 20;              // state broadcasts per second
export const CLIENT_INPUT_RATE = 30;          // client input send rate

export const WORLD = {
  WIDTH: 80,
  HEIGHT: 80,
  CELL_SIZE: 2,
} as const;

export const PLAYER = {
  SPEED: 6.0 as number,                        // units/sec
  SPEED_CROUCH: 2.5 as number,
  RADIUS: 0.4 as number,
  MAX_HEALTH: 100 as number,
  INTERACT_RANGE: 2.0 as number,
  RESPAWN_TIME_MS: 6000 as number,
  INVENTORY_SLOTS: 4 as number,
} as const;

export const GUARD = {
  PATROL_SPEED: 2.2 as number,
  INVESTIGATE_SPEED: 3.5 as number,
  CHASE_SPEED: 5.0 as number,
  VISION_RANGE: 10 as number,
  VISION_FOV_DEG: 90 as number,
  HEARING_RANGE: 7 as number,
  ATTACK_RANGE: 1.2 as number,
  ATTACK_DAMAGE: 25 as number,
  ATTACK_COOLDOWN_MS: 800 as number,
  MAX_HEALTH: 75 as number,
  ALERT_DECAY_PER_SEC: 8 as number,
  ALERT_GAIN_VISIBLE_PER_SEC: 60 as number,
  ALERT_THRESHOLD_INVESTIGATE: 30 as number,
  ALERT_THRESHOLD_CHASE: 80 as number,
  LOST_SIGHT_TIMEOUT_MS: 4000 as number,
} as const;

export enum GuardType {
  PATROL = 'patrol',     // standard, default
  SENTRY = 'sentry',     // stationary; wider FOV; faster alert
  HUNTER = 'hunter',     // faster chase, narrower FOV, more health
}

export const GUARD_VARIANTS: Record<GuardType, {
  speedMul: number;
  fovDegMul: number;
  rangeMul: number;
  healthMul: number;
  alertGainMul: number;
  stationary: boolean;
}> = {
  [GuardType.PATROL]: { speedMul: 1.0,  fovDegMul: 1.0, rangeMul: 1.0,  healthMul: 1.0,  alertGainMul: 1.0, stationary: false },
  [GuardType.SENTRY]: { speedMul: 0.0,  fovDegMul: 1.5, rangeMul: 1.25, healthMul: 0.8,  alertGainMul: 1.4, stationary: true  },
  [GuardType.HUNTER]: { speedMul: 1.25, fovDegMul: 0.75, rangeMul: 1.1, healthMul: 1.5,  alertGainMul: 0.9, stationary: false },
};

export enum PlayerClass {
  INFILTRATOR = 'infiltrator',
  HACKER = 'hacker',
  MEDIC = 'medic',
  HEAVY = 'heavy',
}

export const CLASS_TRAITS: Record<PlayerClass, {
  speedMul: number;
  healthMul: number;
  visionRadiusMul: number;     // how easily guards see them
  interactSpeedMul: number;
  reviveSpeedMul: number;
  description: string;
}> = {
  [PlayerClass.INFILTRATOR]: { speedMul: 1.1, healthMul: 0.9, visionRadiusMul: 0.7, interactSpeedMul: 1.0, reviveSpeedMul: 1.0, description: 'Smaller silhouette, faster on foot.' },
  [PlayerClass.HACKER]:      { speedMul: 1.0, healthMul: 0.9, visionRadiusMul: 1.0, interactSpeedMul: 1.5, reviveSpeedMul: 0.8, description: 'Bypasses doors faster.' },
  [PlayerClass.MEDIC]:       { speedMul: 1.0, healthMul: 1.0, visionRadiusMul: 1.0, interactSpeedMul: 1.0, reviveSpeedMul: 1.8, description: 'Revives downed teammates quickly.' },
  [PlayerClass.HEAVY]:       { speedMul: 0.85, healthMul: 1.5, visionRadiusMul: 1.2, interactSpeedMul: 0.9, reviveSpeedMul: 0.9, description: 'More health, soaks damage.' },
};

export const REVIVE = {
  HOLD_MS: 4000 as number,
  RANGE: 1.6 as number,
  HEALTH_RESTORE: 60 as number,
} as const;

export const MATCH = {
  LOBBY_COUNTDOWN_MS: 5000,
  MAX_DURATION_MS: 8 * 60 * 1000,             // 8 minute heist
  LOCKDOWN_WARNING_MS: 60 * 1000,             // last minute lockdown warning
  MIN_PLAYERS_TO_START: 1,
  MAX_PLAYERS: 5,
  EXTRACTION_HOLD_MS: 4000,                   // must stand in zone N ms
} as const;

export const LOOT = {
  PICKUP_TIME_MS: 1500,
  DATA_VALUE_MIN: 100,
  DATA_VALUE_MAX: 800,
  SPAWN_COUNT_MIN: 6,
  SPAWN_COUNT_MAX: 14,
} as const;

export const ALARM = {
  DURATION_MS: 30_000,
  GUARD_REINFORCEMENT_COUNT: 2,
} as const;

export const NET = {
  RECONNECT_GRACE_MS: 30_000,
  HEARTBEAT_INTERVAL_MS: 5_000,
  MAX_INPUT_BUFFER: 64,
} as const;

export enum MatchPhase {
  LOBBY = 'lobby',
  COUNTDOWN = 'countdown',
  ACTIVE = 'active',
  EXTRACTION = 'extraction',
  ENDED = 'ended',
}

export enum PlayerState {
  ALIVE = 'alive',
  DOWN = 'down',
  DEAD = 'dead',
  EXTRACTED = 'extracted',
}

export enum GuardState {
  PATROL = 'patrol',
  INVESTIGATE = 'investigate',
  CHASE = 'chase',
  ATTACK = 'attack',
  RETURN = 'return',
  DEAD = 'dead',
}

export enum InteractableType {
  DOOR = 'door',
  LOOT = 'loot',
  TERMINAL = 'terminal',
  EXTRACTION = 'extraction',
  KEYCARD = 'keycard',
}

export enum InputAction {
  INTERACT = 1 << 0,
  CROUCH = 1 << 1,
  SPRINT = 1 << 2,
  USE_ITEM = 1 << 3,
  DROP_ITEM = 1 << 4,
}

export interface ClientInput {
  seq: number;
  moveX: number;       // -1..1
  moveY: number;       // -1..1
  aimX: number;        // world coord
  aimY: number;        // world coord
  actions: number;     // bitfield of InputAction
}

export const ROOM_NAME = 'heist';
