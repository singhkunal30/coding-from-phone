# Deployment

## Local development

```bash
npm install
npm run build:shared
npm run dev   # boots shared (watch), server, and client concurrently
```

## Production build

```bash
npm run build
npm run start:server               # node packages/server/dist/index.js
# packages/client/dist is a static SPA, deploy behind any CDN
```

Environment variables (server):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `2567` | WebSocket + HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

Two images:

- `blackout-server` (Node, runs Colyseus on 2567)
- `blackout-client` (nginx, serves the SPA on 8080)

## Scaling to N regions

Today: one Node process per region. Each process serves its own rooms; players in the same region share rooms via Colyseus' `joinOrCreate` matchmaking.

Going horizontal across multiple Node processes / pods:

1. Add `@colyseus/redis-presence` and `@colyseus/redis-driver`.
2. Configure the server with `presence: new RedisPresence({...})` and `driver: new RedisDriver({...})`.
3. Sticky sessions to the **owning** Colyseus process (Colyseus picks one process to own the room; matchmaking redirects on join).

That's the canonical Colyseus scaling pattern; it's deliberately deferred until concurrency demands it.

## Behind a TLS load balancer

Required headers for the WebSocket upgrade:

```
proxy_http_version 1.1;
proxy_set_header   Upgrade $http_upgrade;
proxy_set_header   Connection "upgrade";
proxy_set_header   Host $host;
proxy_set_header   X-Real-IP $remote_addr;
proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header   X-Forwarded-Proto $scheme;
proxy_read_timeout 86400;
```

`/matchmake/*` and `/colyseus/*` are the two path prefixes Colyseus uses for HTTP matchmaking and WebSocket respectively.

## Monitoring & logs

- The server exposes `/health` for liveness checks.
- The Colyseus monitor (`/monitor` in dev) lists active rooms, players, and inspect-able state. Disable or gate behind auth in production (`monitor({ ... })`).
- Logs are JSON-friendly text today; swap `lib/logger.ts` for `pino` to emit JSON to stdout, then ship via your container runtime to Loki / CloudWatch / Datadog.
- Suggested metrics to scrape (next iteration): rooms-by-phase gauge, active-players gauge, tick-time histogram, broadcast-bytes histogram, AI-director-events counter.

## Observability roadmap

- **Per-room metrics**: instrument `setSimulationInterval` body with `performance.now()`, expose via Prometheus `prom-client`.
- **Tracing**: OpenTelemetry sdk in `packages/server`, span per tick, span per AI iteration.
- **Crash safety**: bind `process.on('uncaughtException')` to flush a structured log + graceful shutdown (already wired in `index.ts`).

## CI/CD

Recommended GitHub Actions:

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: npm test --if-present
```

Deploy steps:

- Container build → push to registry (GHCR / ECR / GAR).
- For Colyseus Cloud or Agones: package server as OCI image; orchestrator picks regions and scales pods.
- Static client: rsync `packages/client/dist` to S3 + CloudFront invalidate, or push to Vercel/Netlify.
