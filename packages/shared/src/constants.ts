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
  PATROL_SPEED: 2.2,
  INVESTIGATE_SPEED: 3.5,
  CHASE_SPEED: 5.0,
  VISION_RANGE: 10,
  VISION_FOV_DEG: 90,
  HEARING_RANGE: 7,
  ATTACK_RANGE: 1.2,
  ATTACK_DAMAGE: 25,
  ATTACK_COOLDOWN_MS: 800,
  MAX_HEALTH: 75,
  ALERT_DECAY_PER_SEC: 8,
  ALERT_GAIN_VISIBLE_PER_SEC: 60,
  ALERT_THRESHOLD_INVESTIGATE: 30,
  ALERT_THRESHOLD_CHASE: 80,
  LOST_SIGHT_TIMEOUT_MS: 4000,
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
