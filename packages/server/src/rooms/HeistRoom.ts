import { Room, Client } from '@colyseus/core';
import {
  HeistState, PlayerSchema, GuardSchema, LootSchema, DoorSchema,
  ExtractionZoneSchema, WallSchema, GameMessage,
  PLAYER, GUARD, MATCH, LOOT, ALARM, NET, REVIVE, TICK_INTERVAL_MS,
  MatchPhase, PlayerState, GuardState, GuardType, InputAction,
  PlayerClass, CLASS_TRAITS,
  clamp, dist, dist2, normalize,
  type ClientInput,
} from '@blackout/shared';
import { MapGenerator } from '../world/MapGenerator.js';
import { PhysicsWorld } from '../world/Physics.js';
import { GuardController } from '../ai/GuardController.js';
import { AIDirector } from '../ai/AIDirector.js';
import { logger } from '../lib/logger.js';

interface SessionData {
  inputBuffer: ClientInput[];
  lastInputAt: number;
  authToken: string;
  lastNonZeroInputAt: number;
  reviveTargetId: string | null;
  reviveProgressMs: number;
}

export class HeistRoom extends Room<HeistState> {
  state = new HeistState();
  maxClients = MATCH.MAX_PLAYERS;
  autoDispose = false;             // we'll dispose explicitly

  private physics!: PhysicsWorld;
  private guardCtrl!: GuardController;
  private director!: AIDirector;
  private sessions = new Map<string, SessionData>();   // sessionId -> data
  private extractionTimers = new Map<string, number>(); // playerId -> ms held
  private nextLootId = 0;
  private nextGuardId = 0;
  private mapData!: ReturnType<MapGenerator['generate']>;
  private disposeAfterEnd?: ReturnType<typeof setTimeout>;

  onCreate(options: { mode?: string; difficulty?: number; seed?: number }) {
    this.setMetadata({
      mode: options.mode ?? 'standard',
      difficulty: options.difficulty ?? 1,
    });
    this.state.difficulty = options.difficulty ?? 1;

    const seed = options.seed ?? Math.floor(Math.random() * 1e9);
    this.state.mapData.seed = seed;
    this.generateWorld(seed);

    this.setPatchRate(50);   // 20 Hz snapshot broadcasts
    this.setSimulationInterval((dt) => this.tick(dt / 1000), TICK_INTERVAL_MS);

    this.onMessage('input', (client, input: ClientInput) => this.handleInput(client, input));
    this.onMessage('interact', (client) => this.tryInteract(client));
    this.onMessage('chat', (client, text: string) => this.broadcastChat(client, text));
    this.onMessage('ready', (client) => this.markReady(client));

    logger.info(`[HeistRoom ${this.roomId}] created (seed=${seed} difficulty=${this.state.difficulty})`);
  }

  onJoin(client: Client, options: { name?: string; className?: string }) {
    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.name = (options?.name ?? `Operative-${client.sessionId.slice(0, 4)}`).slice(0, 20);
    const cls = (Object.values(PlayerClass) as string[]).includes(options?.className ?? '')
      ? (options.className as PlayerClass)
      : PlayerClass.INFILTRATOR;
    player.className = cls;
    const trait = CLASS_TRAITS[cls];
    player.maxHealth = Math.round(PLAYER.MAX_HEALTH * trait.healthMul);
    player.health = player.maxHealth;
    player.state = PlayerState.ALIVE;
    const spawn = this.mapData.playerSpawns[this.state.players.size % this.mapData.playerSpawns.length];
    player.x = spawn.x;
    player.y = spawn.y;
    this.state.players.set(client.sessionId, player);

    this.sessions.set(client.sessionId, {
      inputBuffer: [],
      lastInputAt: Date.now(),
      authToken: Math.random().toString(36).slice(2),
      lastNonZeroInputAt: Date.now(),
      reviveTargetId: null,
      reviveProgressMs: 0,
    });

    logger.info(`[HeistRoom ${this.roomId}] join ${player.name} (${client.sessionId})`);
    this.pushMessage('system', `${player.name} joined`);

    if (this.state.phase === MatchPhase.LOBBY && this.state.players.size >= MATCH.MIN_PLAYERS_TO_START) {
      this.startCountdown();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // If they were carrying loot, drop it.
    if (player.isCarryingLoot) this.dropLootCarriedBy(client.sessionId);

    if (consented || this.state.phase === MatchPhase.ENDED) {
      this.state.players.delete(client.sessionId);
      this.sessions.delete(client.sessionId);
      this.pushMessage('system', `${player.name} left`);
      logger.info(`[HeistRoom ${this.roomId}] leave ${player.name}`);
      return;
    }

    // Allow reconnection
    player.connected = false;
    this.pushMessage('system', `${player.name} disconnected — awaiting reconnect`);
    try {
      const reconnected = await this.allowReconnection(client, NET.RECONNECT_GRACE_MS / 1000);
      player.connected = true;
      this.pushMessage('system', `${player.name} reconnected`);
      logger.info(`[HeistRoom ${this.roomId}] reconnect ${player.name}`);
    } catch {
      this.state.players.delete(client.sessionId);
      this.sessions.delete(client.sessionId);
      this.pushMessage('system', `${player.name} timed out`);
      logger.info(`[HeistRoom ${this.roomId}] reconnect timed out for ${player.name}`);
    }
  }

  onDispose() {
    logger.info(`[HeistRoom ${this.roomId}] disposed`);
    if (this.disposeAfterEnd) clearTimeout(this.disposeAfterEnd);
  }

  // -----------------------------------------------------------------------
  // World generation
  // -----------------------------------------------------------------------

  private generateWorld(seed: number) {
    const gen = new MapGenerator(seed);
    this.mapData = gen.generate();
    this.state.mapData.width = this.mapData.width;
    this.state.mapData.height = this.mapData.height;
    for (const w of this.mapData.walls) {
      const ws = new WallSchema();
      ws.x1 = w.x1; ws.y1 = w.y1; ws.x2 = w.x2; ws.y2 = w.y2;
      this.state.mapData.walls.push(ws);
    }
    this.physics = new PhysicsWorld(this.state.mapData.walls as unknown as WallSchema[]);

    for (const d of this.mapData.doors) {
      const id = `door_${this.state.doors.size}`;
      const door = new DoorSchema();
      door.id = id;
      door.x = d.x; door.y = d.y; door.angle = d.angle;
      door.locked = d.requiresKeycard;
      door.requiresKeycard = d.requiresKeycard;
      this.state.doors.set(id, door);
    }

    for (const z of this.mapData.extractionZones) {
      const id = `extract_${this.state.extractionZones.size}`;
      const zone = new ExtractionZoneSchema();
      zone.id = id; zone.x = z.x; zone.y = z.y; zone.radius = z.radius;
      zone.active = false; // activated once loot collected (or always-on; we'll require loot)
      this.state.extractionZones.set(id, zone);
    }

    this.spawnLoot();
    this.guardCtrl = new GuardController(this.physics);
    this.guardCtrl.onChaseTriggered = (g) => this.raiseAlarm(`${g.id} spotted intruders`);
    this.director = new AIDirector(seed);
    this.spawnInitialGuards();

    // Keycard pickup (modeled as a special "loot" with value 0 and id prefix kc_)
    if (this.mapData.keycardSpawn) {
      const id = `kc_keycard`;
      const k = new LootSchema();
      k.id = id; k.x = this.mapData.keycardSpawn.x; k.y = this.mapData.keycardSpawn.y;
      k.value = 0;
      this.state.loot.set(id, k);
    }
  }

  private spawnLoot() {
    const spawns = this.mapData.lootSpawns;
    let totalValue = 0;
    for (const s of spawns) {
      const id = `loot_${this.nextLootId++}`;
      const l = new LootSchema();
      l.id = id; l.x = s.x; l.y = s.y;
      l.value = Math.floor(LOOT.DATA_VALUE_MIN + Math.random() * (LOOT.DATA_VALUE_MAX - LOOT.DATA_VALUE_MIN));
      this.state.loot.set(id, l);
      totalValue += l.value;
    }
    this.state.totalLootValue = totalValue;
  }

  private spawnInitialGuards() {
    const baseCount = 3 + Math.floor(this.state.difficulty * 1.5);
    let i = 0;
    const variants: GuardType[] = [GuardType.PATROL, GuardType.PATROL, GuardType.SENTRY, GuardType.PATROL, GuardType.HUNTER];
    for (const path of this.mapData.guardPatrolPaths) {
      if (i >= baseCount) break;
      const variant = variants[i % variants.length];
      this.createGuard(variant, path);
      i++;
    }
  }

  private createGuard(variant: GuardType, path: { x: number; y: number }[]): GuardSchema {
    const id = `guard_${this.nextGuardId++}`;
    const g = new GuardSchema();
    g.id = id;
    g.variant = variant;
    g.x = path[0].x; g.y = path[0].y;
    const healthMul = variant === GuardType.HUNTER ? 1.5 : variant === GuardType.SENTRY ? 0.8 : 1.0;
    g.health = Math.round(GUARD.MAX_HEALTH * healthMul);
    g.state = GuardState.PATROL;
    this.state.guards.set(id, g);
    this.guardCtrl.register(id, variant === GuardType.SENTRY ? [] : path, g.x, g.y);
    return g;
  }

  private spawnReinforcement() {
    if (this.mapData.guardPatrolPaths.length === 0) return;
    const path = this.mapData.guardPatrolPaths[Math.floor(Math.random() * this.mapData.guardPatrolPaths.length)];
    const g = this.createGuard(GuardType.HUNTER, path);
    g.state = GuardState.CHASE;
    g.alertLevel = 80;
  }

  private raiseAlarm(reason: string) {
    if (this.state.alarmActive) return;
    this.state.alarmActive = true;
    this.state.alarmEndsAt = Date.now() + ALARM.DURATION_MS;
    this.pushMessage('alert', `ALARM RAISED — ${reason}`);
    logger.info(`[HeistRoom ${this.roomId}] alarm raised: ${reason}`);
    // The alarm itself is a huge noise event.
    this.state.players.forEach((p) => {
      this.guardCtrl.notifyNoise(this.state, p.x, p.y, this.state.mapData.width, 30);
    });
  }

  // -----------------------------------------------------------------------
  // Match lifecycle
  // -----------------------------------------------------------------------

  private markReady(_client: Client) {
    if (this.state.phase === MatchPhase.LOBBY && this.state.players.size >= MATCH.MIN_PLAYERS_TO_START) {
      this.startCountdown();
    }
  }

  private startCountdown() {
    if (this.state.phase !== MatchPhase.LOBBY) return;
    this.state.phase = MatchPhase.COUNTDOWN;
    this.state.phaseEndsAt = Date.now() + MATCH.LOBBY_COUNTDOWN_MS;
    this.pushMessage('system', 'Match starting…');
  }

  private startMatch() {
    this.state.phase = MatchPhase.ACTIVE;
    this.state.matchStartedAt = Date.now();
    this.state.matchEndsAt = this.state.matchStartedAt + MATCH.MAX_DURATION_MS;
    this.pushMessage('system', 'Heist active — extract before lockdown!');
  }

  private endMatch(reason: string) {
    if (this.state.phase === MatchPhase.ENDED) return;
    this.state.phase = MatchPhase.ENDED;
    this.state.phaseEndsAt = Date.now() + 10_000;
    this.pushMessage('system', `Match ended: ${reason}`);
    // Dispose after a few seconds to let clients show end screen.
    this.disposeAfterEnd = setTimeout(() => this.disconnect(), 10_000);
  }

  // -----------------------------------------------------------------------
  // Input handling (authoritative, validated)
  // -----------------------------------------------------------------------

  private handleInput(client: Client, input: ClientInput) {
    const sess = this.sessions.get(client.sessionId);
    if (!sess) return;

    // Basic anti-cheat: clamp magnitudes; reject obviously invalid payloads.
    if (!Number.isFinite(input.moveX) || !Number.isFinite(input.moveY)) return;
    if (typeof input.seq !== 'number') return;
    input.moveX = clamp(input.moveX, -1, 1);
    input.moveY = clamp(input.moveY, -1, 1);
    input.aimX = Number.isFinite(input.aimX) ? clamp(input.aimX, -10_000, 10_000) : 0;
    input.aimY = Number.isFinite(input.aimY) ? clamp(input.aimY, -10_000, 10_000) : 0;

    sess.inputBuffer.push(input);
    if (sess.inputBuffer.length > NET.MAX_INPUT_BUFFER) sess.inputBuffer.shift();
    sess.lastInputAt = Date.now();
    if (Math.abs(input.moveX) > 0.05 || Math.abs(input.moveY) > 0.05) {
      sess.lastNonZeroInputAt = sess.lastInputAt;
    }
  }

  // -----------------------------------------------------------------------
  // Main simulation tick (20 Hz)
  // -----------------------------------------------------------------------

  private tick(dt: number) {
    const now = Date.now();
    this.state.tick++;
    this.state.serverTime = now;

    switch (this.state.phase) {
      case MatchPhase.LOBBY:
        // wait
        break;
      case MatchPhase.COUNTDOWN:
        if (now >= this.state.phaseEndsAt) this.startMatch();
        break;
      case MatchPhase.ACTIVE:
      case MatchPhase.EXTRACTION:
        this.simulate(dt, now);
        break;
      case MatchPhase.ENDED:
        break;
    }
  }

  private simulate(dt: number, now: number) {
    // Process player inputs.
    this.state.players.forEach((p, sid) => {
      const sess = this.sessions.get(sid);
      if (!sess) return;
      if (p.state === PlayerState.DEAD || p.state === PlayerState.EXTRACTED) return;
      const inputs = sess.inputBuffer.splice(0, sess.inputBuffer.length);
      for (const input of inputs) {
        this.applyInput(p, input, dt / Math.max(1, inputs.length));
        p.lastInputSeq = input.seq;
      }

      // Down state: gradually bleed out unless rescued (TODO rescue interaction)
      if (p.state === PlayerState.DOWN) {
        p.health = Math.max(0, p.health - 6 * dt);
        if (p.health <= 0) p.state = PlayerState.DEAD;
      }

      // Aim direction from latest aim
      // (handled in applyInput)
    });

    // AI
    this.guardCtrl.tick(this.state, dt);

    // Doors auto-close after inactivity? Keep open; players toggle manually.

    // Alarm timer
    if (this.state.alarmActive && now >= this.state.alarmEndsAt) {
      this.state.alarmActive = false;
      this.pushMessage('system', 'Alarm cleared');
    }

    // AI director
    const ev = this.director.tick(this.state);
    if (ev) {
      if (ev.type === 'spawn_reinforcements') {
        for (let i = 0; i < ev.count; i++) this.spawnReinforcement();
        this.pushMessage('system', 'Reinforcements inbound');
      } else if (ev.type === 'roaming_sweep') {
        this.state.guards.forEach((g) => { g.alertLevel = clamp(g.alertLevel + 20, 0, 100); });
      }
    }

    // Track director contact metric (guards seeing players → contact pulse).
    this.state.guards.forEach((g) => {
      if (g.alertLevel > 40) this.director.noteContact();
    });

    // Extraction zone progress
    this.processExtraction(dt);
    this.processRevives(dt);

    // Loot carrier vacating extraction zone deposits value? No — only on extract.

    // End conditions
    this.checkEndConditions(now);
  }

  private applyInput(p: PlayerSchema, input: ClientInput, dt: number) {
    const moveLen = Math.hypot(input.moveX, input.moveY);
    const trait = CLASS_TRAITS[p.className as PlayerClass] ?? CLASS_TRAITS[PlayerClass.INFILTRATOR];
    let speed = PLAYER.SPEED * trait.speedMul;
    if (input.actions & InputAction.CROUCH) speed = PLAYER.SPEED_CROUCH;
    if (p.isCarryingLoot) speed *= 0.75;

    let mx = 0, my = 0;
    if (moveLen > 0.05) {
      mx = (input.moveX / Math.max(moveLen, 1)) * speed * dt;
      my = (input.moveY / Math.max(moveLen, 1)) * speed * dt;
    }
    const result = this.physics.moveWithSliding(p.x, p.y, mx, my, PLAYER.RADIUS, this.state);
    p.x = result.x;
    p.y = result.y;

    // Aim: use aim target to set facing direction.
    const ax = input.aimX - p.x;
    const ay = input.aimY - p.y;
    const al = Math.hypot(ax, ay);
    if (al > 0.1) { p.dirX = ax / al; p.dirY = ay / al; }
    else if (moveLen > 0.1) { p.dirX = input.moveX / moveLen; p.dirY = input.moveY / moveLen; }

    if (input.actions & InputAction.INTERACT) {
      // Edge-trigger interactions are handled by explicit "interact" message; ignore bitfield here.
    }
  }

  // -----------------------------------------------------------------------
  // Interaction
  // -----------------------------------------------------------------------

  private tryInteract(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.state !== PlayerState.ALIVE) return;
    const sess = this.sessions.get(client.sessionId);

    // Revive teammate (highest priority — proximity to a downed teammate).
    let downedTarget: PlayerSchema | null = null;
    this.state.players.forEach((other) => {
      if (other === p) return;
      if (other.state !== PlayerState.DOWN) return;
      if (dist(p.x, p.y, other.x, other.y) <= REVIVE.RANGE) downedTarget = other;
    });
    if (downedTarget && sess) {
      const t = downedTarget as PlayerSchema;
      sess.reviveTargetId = sess.reviveTargetId === t.id ? sess.reviveTargetId : t.id;
      // Pressing interact while already reviving cancels.
      if (sess.reviveTargetId === t.id && sess.reviveProgressMs > 0 && sess.reviveProgressMs < REVIVE.HOLD_MS) {
        sess.reviveTargetId = null;
        sess.reviveProgressMs = 0;
        t.reviveProgress = 0;
        return;
      }
      sess.reviveTargetId = t.id;
      sess.reviveProgressMs = 1;
      t.reviveProgress = 0.001;
      this.pushMessage('system', `${p.name} is reviving ${t.name}`);
      return;
    }

    // Doors first (next priority).
    let bestDoor: DoorSchema | null = null;
    let bestDoorDist = Infinity;
    this.state.doors.forEach((d) => {
      const dd = dist2(p.x, p.y, d.x, d.y);
      if (dd < bestDoorDist && dd < PLAYER.INTERACT_RANGE * PLAYER.INTERACT_RANGE) {
        bestDoorDist = dd; bestDoor = d;
      }
    });
    if (bestDoor) {
      const door = bestDoor as DoorSchema;
      if (door.locked && !door.open) {
        if (p.hasKeycard) {
          door.locked = false; door.open = true;
          this.pushMessage('system', `${p.name} bypassed a lock`);
          this.guardCtrl.notifyNoise(this.state, door.x, door.y, 6, 15);
        } else {
          this.pushMessage('alert', 'Locked — keycard required');
          return;
        }
      } else {
        door.open = !door.open;
        this.guardCtrl.notifyNoise(this.state, door.x, door.y, 4, 5);
      }
      return;
    }

    // Loot pickup / drop
    if (p.isCarryingLoot) {
      // drop closest loot owned by this player
      this.state.loot.forEach((l) => {
        if (l.carrierId === p.id) {
          l.carrierId = '';
          l.x = p.x; l.y = p.y;
          p.isCarryingLoot = false;
        }
      });
      return;
    }
    let best: LootSchema | null = null;
    let bestD = Infinity;
    this.state.loot.forEach((l) => {
      if (l.collected || l.carrierId) return;
      const d = dist2(p.x, p.y, l.x, l.y);
      if (d < bestD && d < PLAYER.INTERACT_RANGE * PLAYER.INTERACT_RANGE) {
        bestD = d; best = l;
      }
    });
    if (best) {
      const lootHit = best as LootSchema;
      if (lootHit.id.startsWith('kc_')) {
        // Keycard
        p.hasKeycard = true;
        lootHit.collected = true;
        this.pushMessage('system', `${p.name} found a keycard`);
      } else {
        lootHit.carrierId = p.id;
        p.isCarryingLoot = true;
        this.pushMessage('system', `${p.name} picked up data`);
        // Pickup makes a small noise.
        this.guardCtrl.notifyNoise(this.state, p.x, p.y, 3, 5);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Extraction
  // -----------------------------------------------------------------------

  private processExtraction(dt: number) {
    this.state.players.forEach((p) => {
      if (p.state !== PlayerState.ALIVE) {
        this.extractionTimers.delete(p.id);
        p.extractionProgress = 0;
        return;
      }
      let inZone = false;
      this.state.extractionZones.forEach((z) => {
        if (dist(p.x, p.y, z.x, z.y) < z.radius) inZone = true;
      });
      if (inZone && p.isCarryingLoot) {
        const t = (this.extractionTimers.get(p.id) ?? 0) + dt * 1000;
        this.extractionTimers.set(p.id, t);
        p.extractionProgress = clamp(t / MATCH.EXTRACTION_HOLD_MS, 0, 1);
        if (t >= MATCH.EXTRACTION_HOLD_MS) {
          this.completeExtraction(p);
        }
      } else {
        this.extractionTimers.delete(p.id);
        p.extractionProgress = 0;
      }
    });
  }

  private processRevives(dt: number) {
    this.sessions.forEach((sess, sid) => {
      if (!sess.reviveTargetId) return;
      const reviver = this.state.players.get(sid);
      const target = this.state.players.get(sess.reviveTargetId);
      if (!reviver || !target || reviver.state !== PlayerState.ALIVE || target.state !== PlayerState.DOWN) {
        if (target) target.reviveProgress = 0;
        sess.reviveTargetId = null;
        sess.reviveProgressMs = 0;
        return;
      }
      if (dist(reviver.x, reviver.y, target.x, target.y) > REVIVE.RANGE * 1.1) {
        // Out of range; abort.
        target.reviveProgress = 0;
        sess.reviveTargetId = null;
        sess.reviveProgressMs = 0;
        this.pushMessage('alert', `Revive interrupted`);
        return;
      }
      const speed = CLASS_TRAITS[reviver.className as PlayerClass]?.reviveSpeedMul ?? 1;
      sess.reviveProgressMs += dt * 1000 * speed;
      target.reviveProgress = clamp(sess.reviveProgressMs / REVIVE.HOLD_MS, 0, 1);
      if (sess.reviveProgressMs >= REVIVE.HOLD_MS) {
        target.health = Math.min(target.maxHealth, REVIVE.HEALTH_RESTORE);
        target.state = PlayerState.ALIVE;
        target.reviveProgress = 0;
        sess.reviveTargetId = null;
        sess.reviveProgressMs = 0;
        this.pushMessage('system', `${reviver.name} revived ${target.name}`);
      }
    });
  }

  private completeExtraction(p: PlayerSchema) {
    let totalVal = 0;
    this.state.loot.forEach((l) => {
      if (l.carrierId === p.id) {
        totalVal += l.value;
        l.collected = true;
        l.carrierId = '';
      }
    });
    p.stolenValue += totalVal;
    p.score += totalVal;
    p.isCarryingLoot = false;
    p.state = PlayerState.EXTRACTED;
    p.extractionProgress = 0;
    this.state.extractedValue += totalVal;
    this.pushMessage('extraction', `${p.name} extracted ${totalVal} cr`);
  }

  private dropLootCarriedBy(playerId: string) {
    const p = this.state.players.get(playerId);
    this.state.loot.forEach((l) => {
      if (l.carrierId === playerId) {
        l.carrierId = '';
        if (p) { l.x = p.x; l.y = p.y; }
      }
    });
  }

  // -----------------------------------------------------------------------
  // End conditions
  // -----------------------------------------------------------------------

  private checkEndConditions(now: number) {
    if (this.state.phase === MatchPhase.ENDED) return;
    if (now >= this.state.matchEndsAt) {
      this.endMatch('Time up');
      return;
    }
    let allDone = this.state.players.size > 0;
    let anyExtracted = false;
    this.state.players.forEach((p) => {
      if (p.state !== PlayerState.DEAD && p.state !== PlayerState.EXTRACTED) allDone = false;
      if (p.state === PlayerState.EXTRACTED) anyExtracted = true;
    });
    if (allDone) {
      this.endMatch(anyExtracted ? 'Heist complete' : 'Team eliminated');
    }
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  private pushMessage(type: string, text: string) {
    const m = new GameMessage();
    m.type = type;
    m.text = text;
    m.timestamp = Date.now();
    const arr = this.state.recentMessages;
    arr.push(m);
    while (arr.length > 12) arr.shift();
  }

  private broadcastChat(client: Client, text: string) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const safe = String(text ?? '').slice(0, 140);
    this.pushMessage('chat', `${p.name}: ${safe}`);
  }
}
