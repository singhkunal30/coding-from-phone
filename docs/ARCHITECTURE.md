# Architecture

This document is the engineering map of Blackout Protocol — the choices, the boundaries, and where to put new code.

## 1. High-level diagram

```
┌────────────────────────── browser tab ──────────────────────────┐
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────┐   ┌─────┐  │
│  │  Input   │──▶│   NetClient  │──▶│  HUD          │   │     │  │
│  │  WASD +  │   │ (colyseus.js)│   │  (DOM cards)  │   │ THREE  │
│  │  mouse   │   │              │   └───────────────┘   │  R  │  │
│  └──────────┘   │              │   ┌───────────────┐   │  E  │  │
│                 │   delta sync │──▶│  Renderer     │──▶│  E  │  │
│                 │              │   │  (Three.js)   │   │  R  │  │
│                 └──────┬───────┘   └───────────────┘   └─────┘  │
└────────────────────────┼─────────────────────────────────────────┘
                         │ WebSocket (binary, schema-encoded)
                         ▼
┌────────────────────── server process ────────────────────────────┐
│                                                                  │
│  ┌────────────┐    ┌─────────────────────────────────────────┐  │
│  │  HTTP /    │    │       HeistRoom (Colyseus Room)         │  │
│  │  health    │    │                                         │  │
│  └────────────┘    │  ┌───────────┐  ┌────────────────────┐  │  │
│                    │  │ MapGen    │  │ GuardController    │  │  │
│  ┌────────────┐    │  │ (BSP)     │  │ + AIDirector       │  │  │
│  │  monitor   │    │  └───────────┘  └────────────────────┘  │  │
│  └────────────┘    │  ┌───────────┐  ┌────────────────────┐  │  │
│                    │  │ Physics   │  │ Match lifecycle    │  │  │
│                    │  └───────────┘  └────────────────────┘  │  │
│                    │  ┌─────────────────────────────────────┐ │  │
│                    │  │ Authoritative HeistState (schema)   │ │  │
│                    │  └─────────────────────────────────────┘ │  │
│                    └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## 2. Monorepo

```
packages/shared    →  Game constants, Colyseus schemas, math helpers.
                      Imported by both server and client. ONE source of truth.
packages/server    →  Node 20 + Colyseus 0.16 + WebSocket transport.
packages/client    →  Vite + Three.js + colyseus.js, vanilla TS (no framework).
```

Why a monorepo? Because every wire schema, gameplay constant, and input shape lives in `shared/`. The client and server can't drift on `PLAYER.SPEED` or `ClientInput` because the type errors slap you the moment you `tsc -b`.

## 3. Server simulation

The server is the single authority. Each `HeistRoom` runs:

| Subsystem | Tick rate | Responsibility |
|---|---|---|
| `setSimulationInterval` (game loop) | **20 Hz** | apply inputs → AI → interactions → end conditions |
| `setPatchRate` (broadcast) | **20 Hz** | delta-encode `HeistState` and send to all clients |
| Colyseus heartbeat | 5 s | drop dead WebSocket connections fast |

### Authoritative input flow

1. Client polls `InputManager.poll()` at **30 Hz**, sends `{ seq, moveX, moveY, aimX, aimY, actions }`.
2. Server buffers per-client inputs in `SessionData.inputBuffer` (capped at `NET.MAX_INPUT_BUFFER`).
3. On each tick the server drains the buffer, applies sliding-collision movement, then writes the new `PlayerSchema.x/y` and `lastInputSeq` into state.
4. `setPatchRate` triggers delta encoding — Colyseus diffs the schema and sends only the changed fields.

`PlayerSchema.lastInputSeq` is the hook for **client-side reconciliation**: a client knows which input the server has acknowledged and can replay any unacknowledged inputs locally on top of the server snapshot. (We ship without active reconciliation today — see Future Work.)

### Tick budget at 20 Hz (50 ms)

- Drain inputs for all players: O(P · I) where P=players, I≈2 inputs each → trivial.
- AI: O(G · P) for each guard's visible-target test, plus one wall ray per pair. With G=10 and P=5 that's 50 line-blocked checks; each touches ~4 candidate walls via the spatial grid. <0.3 ms.
- Extraction zones: O(P · Z), Z≈1. Negligible.
- State broadcast: delta-encoded; only changed fields hit the wire.

Comfortably under 5 ms per tick on commodity hardware. Headroom for 50+ guards, 10+ players, or both.

## 4. State synchronization

All synced data lives in classes that extend Colyseus' `@colyseus/schema`. The schema definitions are in `packages/shared/src/schema.ts`. Highlights:

```ts
HeistState
├─ phase, phaseEndsAt, matchStartedAt, matchEndsAt  (match lifecycle)
├─ alarmActive, alarmEndsAt, tick, serverTime       (global flags + clock sync)
├─ players: MapSchema<PlayerSchema>
├─ guards:  MapSchema<GuardSchema>
├─ loot:    MapSchema<LootSchema>
├─ doors:   MapSchema<DoorSchema>
├─ extractionZones: MapSchema<ExtractionZoneSchema>
├─ mapData: MapSchemaState (walls + seed)           (sent once on join)
└─ recentMessages: ArraySchema<GameMessage>
```

Colyseus encodes only the fields that changed each frame. For 5 players + 10 guards + ~20 loot + 70 wall segments, the joining packet is ~6 KB and each delta is typically <500 B. We bumped `Encoder.BUFFER_SIZE` to 64 KB to safely absorb the initial state.

## 5. AI

### Guard FSM

```
┌──────────┐  alert ≥ 30          ┌──────────────┐
│  PATROL  │ ───────────────────▶ │ INVESTIGATE  │
└──────────┘                      └──────┬───────┘
     ▲                                   │ alert ≥ 80 + visible target
     │ alert ≈ 0                         ▼
     │                            ┌──────────────┐ in attack range
     │                            │    CHASE     │ ──────────────▶  ATTACK
     │                            └──────────────┘
     │                                   │ lost sight (timeout)
     └───── back to spawn ────  RETURN  ◀┘
```

Inputs to the FSM each tick:

- **Vision**: cone (FOV 90°, range 10) blocked by walls.
- **Hearing**: `notifyNoise(x, y, radius, intensity)` from gunshots, alarm, door bashing, etc.
- **Alert decay/gain**: `+60/sec` while visible, `−8/sec` otherwise. Crosses thresholds 30 / 80 to advance states.
- **Alarm**: pulls all guards' alert level to ≥60.

### AI Director

`AIDirector.tick()` returns an event the room then applies. Today: spawn reinforcements when an alarm fires; trigger a roaming sweep when there's been no contact for 25 s after the 90-second mark. Easy to extend with budgeted "intensity" tracking (Left 4 Dead-style).

## 6. Procedural generation

`MapGenerator` (`packages/server/src/world/MapGenerator.ts`) is fully deterministic from a seed:

1. **BSP subdivision** of the 80×80 world rectangle into rooms.
2. **Walls** are the union of all room edges. Shared edges become **door openings** (gap punched in the wall + a `DoorSchema`).
3. **Spawn rooms**: smallest = player entry, farthest from spawn = extraction.
4. **Loot** is scattered per room (1–3 per medium+ room).
5. **Guard patrol paths** are per-room waypoint loops.
6. **Keycard** is placed in a random non-extraction room (gates some doors).

Reseed → completely new layout. Same seed → identical layout for replay analysis.

## 7. Anti-cheat foundations

- **Input clamping**: `moveX, moveY ∈ [−1, 1]`, `aimX, aimY` clamped to sane world bounds.
- **Server is authoritative**: positions, health, loot collection, alarm state, kill credit — all computed server-side. Clients only send intent.
- **Input rate limit**: per-session input buffer is capped at `NET.MAX_INPUT_BUFFER` (64). Excess is dropped silently.
- **No client-trusted fields**: `PlayerSchema` is server-set only; the client cannot mutate state.

Future: signed inputs (HMAC), packet timing analysis, server-side line-of-sight rewind for the hit-validation we'll add when we have weapons.

## 8. Networking robustness

- **Reconnection**: `HeistRoom.onLeave` calls `this.allowReconnection(client, NET.RECONNECT_GRACE_MS / 1000)` and tags the player `connected = false` during the window. Client stores `room.reconnectionToken` in `sessionStorage` for transparent rejoin on page refresh.
- **Ping**: 5s pingInterval + 3 retries — dead clients drop in ~15s max.
- **Patch rate**: 20 Hz; clients interpolate by lerping toward the latest snapshot (Renderer.update uses 0.35-strength lerp per frame, ~6× the tick rate).

## 9. Folder convention

```
packages/server/src/
├── index.ts              ← bootstraps Express + Colyseus, registers rooms
├── lib/logger.ts         ← swap with pino when scaling
├── world/
│   ├── MapGenerator.ts   ← BSP + spawn / loot / patrol planning
│   └── Physics.ts        ← grid spatial index, sliding collision
├── ai/
│   ├── GuardController.ts ← per-guard FSM
│   └── AIDirector.ts     ← global event director
└── rooms/
    └── HeistRoom.ts      ← match lifecycle + tick orchestrator
```

```
packages/client/src/
├── main.ts               ← entry: bind UI, drive loop
├── net/NetClient.ts      ← colyseus.js wrapper, reconnect token store
├── game/
│   ├── Renderer.ts       ← three.js scene, ortho top-down cam, lerp
│   ├── Input.ts          ← keyboard/mouse → InputSnapshot
│   └── HUD.ts            ← imperative DOM HUD
└── styles.css
```

## 10. Why these stack choices?

- **Colyseus** > raw socket.io / ws / WebRTC: it solves rooms, matchmaking, state sync, schema encoding, and reconnection on day one. Replacing it would have cost weeks for no gameplay gain.
- **Three.js** > Babylon / Phaser: lighter, no scene-graph editor lock-in, trivial top-down setup, and great mobile compatibility for later.
- **TypeScript everywhere**: shared schema typing across boundaries is the single biggest productivity multiplier.
- **Vite**: zero-config HMR. Don't waste a day on bundler choices.
- **Monorepo with npm workspaces**: zero tooling. No turborepo / pnpm required at this scale.

## 11. Extending the game

| Want to… | Edit… |
|---|---|
| Change movement speed | `packages/shared/src/constants.ts → PLAYER.SPEED` |
| Add a new guard behavior | `packages/server/src/ai/GuardController.ts` (extend the FSM) |
| Add a new interactable | new `XxxSchema` in `packages/shared/src/schema.ts`; spawn it in `MapGenerator`; handle in `HeistRoom.tryInteract` |
| Add a new HUD card | `packages/client/src/game/HUD.ts` |
| Add a new render type | `packages/client/src/game/Renderer.ts → createXxxMesh` |
| Add anti-cheat rule | `packages/server/src/rooms/HeistRoom.ts → handleInput` |
