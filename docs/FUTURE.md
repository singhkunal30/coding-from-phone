# Future Work

Ordered by ROI for "make the game more fun, soon."

## P0 — sharpen the loop (1–2 weeks)

- **Client-side prediction + reconciliation.** Wire up `PlayerSchema.lastInputSeq` on the client: replay buffered inputs that arrived after the latest server snapshot. Caps the perceived latency at <30 ms regardless of network.
- **Guard pathfinding (A*).** Generate a navmesh from the BSP rooms at world-gen time; let `GuardController.seekTo` use it instead of straight-line seek. Eliminates "guard pressed against a wall trying to walk through it."
- **Audio**. Even placeholder synth tones (alarm pulse, footstep, door slam, guard alert bark, extraction confirm). Tension lives in the audio.
- **Visible vision cones for chase state.** Sharpen the color shift; pulse when alert level is near a threshold.
- **Sub-objectives**: terminals to hack mid-heist (raise vault, disable cameras). Adds team coordination beats.

## P1 — replayability (2–4 weeks)

- **Roles / classes**. Hacker (faster terminal interaction), Medic (revives downed teammates), Heavy (more health, slower), Infiltrator (smaller vision cone profile to enemies).
- **Multiple mission archetypes**: snatch-and-grab, sabotage (plant + escape), rescue (escort NPC out).
- **Map biomes**: corporate office, vault, server room, parking garage. Each biome tweaks wall textures, loot tables, and the alarm response style.
- **Difficulty scaling that matters**: more guards, faster alert decay reversal, locked doors more common, fewer keycards.
- **AI Director "intensity" budget** (à la Left 4 Dead): track player stress (recent damage, recent close calls); spawn pressure when stress is low, ease off when high.

## P2 — production polish (1–2 months)

- **Account + progression**: persistent identity, lifetime stats, daily/weekly contracts, cosmetic unlocks (skins).
- **Settings menu**: graphics, audio, controls, accessibility (colorblind palette, reduce motion).
- **Save system**: per-player loadout/cosmetics. Server-side authoritative DB (Postgres + Redis cache).
- **Anti-cheat hardening**: signed inputs, server-side hit validation, packet timing analysis, rate-limit interactions per second, kick on schema-mismatched messages.
- **Voice & proximity chat**: WebRTC SFU (mediasoup / livekit) for in-room voice; spatial volume by distance.
- **Telemetry & analytics**: track win rate by seed/difficulty, average heist duration, time-to-first-loot, drop-off points.

## P3 — scaling & ops (when concurrent players warrant it)

- **`@colyseus/redis-presence` + `redis-driver`** to span rooms across N Node processes.
- **Colyseus Cloud or Agones** for orchestration.
- **Regional matchmaking** with latency-aware room placement.
- **Crash recovery**: persist room state to Redis snapshots so a process restart can resume mid-match.

## Tech debt / cleanup

- Replace ad-hoc logger with `pino` JSON.
- Add `vitest` test suite to `packages/shared` (math + PRNG determinism) and a Colyseus integration harness to `packages/server` (room lifecycle, AI transitions).
- Code-split client (lazy-load Three on enter, ship menu as <50KB initial JS).
- Texture atlas for walls/floors instead of solid materials (still low-poly, but more atmosphere).
- Per-platform input scheme (gamepad).
