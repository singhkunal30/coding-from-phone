# Blackout Protocol

> Multiplayer co-op heist / extraction prototype. Authoritative server, browser client, low-poly 3D.

3–5 operatives drop into a procedurally generated facility, slip past patrol guards, steal data drives, and extract before the lockdown timer hits zero. Trip an alarm and the AI Director sends reinforcements your way. Pick a class — Infiltrator (small profile), Hacker (faster doors), Medic (fast revives), Heavy (more health). Down a teammate? Stand over them and hold E to revive.

```
┌──────────────────┐                ┌────────────────────────────┐
│  Browser client  │  WebSocket /   │  Authoritative game server │
│  (Three.js TS)   │ <───────────>  │  (Colyseus / Node TS)      │
│  rendering +     │  Colyseus      │  simulation @ 20 Hz        │
│  input only      │  delta sync    │  Guard AI + AI Director    │
└──────────────────┘                └────────────────────────────┘
```

## Quick start

Requirements: **Node 20+** and npm 10+.

```bash
npm install
npm run build:shared    # build the shared schema package once

# Terminal 1 — server
npm run dev:server

# Terminal 2 — client
npm run dev:client
```

Open <http://localhost:5173>. Enter a callsign, click **Quick Match**. Open a second tab and join too — instant multiplayer.

### Production build

```bash
npm run build
npm run start:server       # serves the game server on :2567
# serve the built client (packages/client/dist) behind any static host
```

### Docker

```bash
docker compose up --build  # game server on :2567, static client on :8080
```

## Controls

| Action | Input |
|---|---|
| Move | WASD / arrows |
| Aim | Mouse |
| Interact (open door, pick up loot) | E (or F) |
| Sprint | Shift |
| Crouch | Ctrl / C |

## Project layout

```
packages/
├── shared/        # Game constants, Colyseus schemas, math (single source of truth)
├── server/        # Authoritative server: rooms, AI, world simulation
└── client/        # Three.js renderer, input, HUD, networking
docs/              # Architecture deep dives
docker/            # Container images
scripts/           # smoke-test.mjs and friends
```

## Architecture (TL;DR)

- **Authoritative server**: Colyseus rooms own simulation. Clients send inputs (movement, aim, interact). Server runs at 20 Hz, broadcasts delta-compressed state at 20 Hz.
- **No P2P**: there's a single trusted server per room.
- **Reconnection**: Colyseus stores a reconnection token; players have a 30s grace window to drop and rejoin.
- **AI**: each guard is a small FSM (`patrol → investigate → chase → attack → return`) driven by vision cones + hearing + global alarm. An AI Director monitors match intensity and dispatches reinforcements / sweeps.
- **Procedural maps**: deterministic BSP subdivision per seed → rooms → doors at shared walls → guard patrol paths + loot spawns + extraction zone.

For the full breakdown see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Testing locally

```bash
# Boot the server, then in another shell:
node scripts/smoke-test.mjs
```

The smoke test joins two simulated clients, drives inputs, and verifies players actually move and guards spawn.

## Multiplayer testing

1. Start the server (`npm run dev:server`).
2. Start the client (`npm run dev:client`).
3. Open two or three browser tabs at <http://localhost:5173>.
4. The first tab clicks **Create Heist** — countdown starts as soon as MIN_PLAYERS is reached.
5. Subsequent tabs click **Quick Match** to join the same room (Colyseus `joinOrCreate`).
6. For LAN play, point the **Server** field at `ws://<host-ip>:2567`.

## Deployment notes

- **Server**: a single Node process per region today; horizontal scaling uses Colyseus' built-in `RedisPresence` + `RedisDriver` (drop-in). See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).
- **Client**: static SPA. Drop the built `dist/` on any CDN (CloudFront / Cloudflare / Netlify).
- **WebSocket transport**: behind a TLS-terminating load balancer (NGINX / Caddy / ALB) with sticky sessions to the room's owning process.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 — Playable foundation | ✅ | Lobby, room join/create, sync, movement, names, procedural map |
| 2 — Core gameplay | ✅ | Guards, vision cones, alert states, alarm raised on chase, doors+keycards, loot, extraction, timer, health, interaction |
| 3 — Advanced multiplayer | ✅ | Reconnection (30s grace), reconnect token persistence, input rate limiting + clamping, latency-tolerant simulation, snapshot rate tuned, schema-based delta sync, downed-and-revive teamplay |
| 4 — Replayability | ✅ | Procedural BSP maps, randomized loot, difficulty scaling, AI Director, **3 guard variants** (patrol / sentry / hunter), **4 player classes** (infiltrator / hacker / medic / heavy) |
| 5 — Polish | 🟡 | UI + HUD, Web-Audio cue system (alarm / pickup / door / extracted / down / revive), mute toggle persisted to localStorage. Pending: settings menu, persistent progression, cosmetics, telemetry |

## Known limitations

- No client-side rollback / input prediction yet (the server is fully authoritative and clients lerp incoming snapshots — perfectly playable at <100 ms RTT, would want prediction at >150 ms).
- Doors are toggled by interaction only — they don't auto-close.
- Pathfinding is straight-line seek with wall-sliding. Good enough for rooms; needs A* for tight corridors.
- No persistent progression yet (DB / inventory / cosmetics framework documented in `docs/FUTURE.md`).

## Roadmap

See [docs/FUTURE.md](./docs/FUTURE.md). Highlights:

- Client-side prediction + server reconciliation (per-input, latency-resilient).
- Lag compensation for guard line-of-sight (rewind player position by RTT/2).
- A* navmesh for guard pathing.
- Class/role system (Hacker, Medic, Heavy, Infiltrator).
- Multiple objective types: rescue, sabotage, heist+timer.
- Persistent progression: account, unlocks, daily contracts.
- Voice channels / proximity chat.
- Dedicated server orchestration on Colyseus Cloud / Agones.
