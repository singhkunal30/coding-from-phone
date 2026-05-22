import { ALARM, MatchPhase, PRNG } from '@blackout/shared';
import type { HeistState } from '@blackout/shared';
import { logger } from '../lib/logger.js';

/**
 * Lightweight AI Director. Observes match intensity and triggers events:
 *   - Reinforcements when alarm raised.
 *   - Idle pulses (no contact for a while → spawn a roaming guard).
 *   - Mid-match pressure if extraction never reached.
 *
 * Designed to react in seconds without making state thrash.
 */
export class AIDirector {
  private rng: PRNG;
  private lastContactAt = 0;
  private lastEventAt = 0;
  private reinforcementsDispatched = 0;

  constructor(seed: number) {
    this.rng = new PRNG(seed ^ 0x9e3779b9);
  }

  noteContact() { this.lastContactAt = Date.now(); }

  /** Returns an event descriptor that the room should apply, or null. */
  tick(state: HeistState): DirectorEvent | null {
    if (state.phase !== MatchPhase.ACTIVE) return null;
    const now = Date.now();
    if (now - this.lastEventAt < 8_000) return null;

    // Alarm just raised → dispatch reinforcements once per alarm.
    if (state.alarmActive && this.reinforcementsDispatched === 0) {
      this.reinforcementsDispatched = ALARM.GUARD_REINFORCEMENT_COUNT;
      this.lastEventAt = now;
      logger.info(`[Director] Alarm reinforcements: ${this.reinforcementsDispatched}`);
      return { type: 'spawn_reinforcements', count: ALARM.GUARD_REINFORCEMENT_COUNT };
    }
    if (!state.alarmActive) this.reinforcementsDispatched = 0;

    // Lull: no contact, no extraction progress, push pressure.
    const matchElapsed = now - state.matchStartedAt;
    const timeSinceContact = now - this.lastContactAt;
    if (matchElapsed > 90_000 && timeSinceContact > 25_000 && this.rng.next() < 0.4) {
      this.lastEventAt = now;
      logger.info('[Director] Lull pressure → roaming sweep');
      return { type: 'roaming_sweep' };
    }

    return null;
  }
}

export type DirectorEvent =
  | { type: 'spawn_reinforcements'; count: number }
  | { type: 'roaming_sweep' };
