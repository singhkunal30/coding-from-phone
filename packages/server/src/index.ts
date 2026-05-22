import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { Encoder } from '@colyseus/schema';

// Bump encoder buffer for our larger initial state (procedural map + entities).
Encoder.BUFFER_SIZE = 64 * 1024;
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ROOM_NAME } from '@blackout/shared';
import { HeistRoom } from './rooms/HeistRoom.js';
import { logger } from './lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 2567;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Colyseus monitor (room/state inspection in dev)
app.use('/monitor', monitor());

// Serve the built client.  This collapses everything to ONE port and ONE
// origin — no Vite proxy, no second forwarded port required.  HTTP, the
// game files, and the WebSocket upgrade all live behind the same URL.
const clientDist = path.resolve(__dirname, '../../client/dist');
const hasClient = fs.existsSync(path.join(clientDist, 'index.html'));
if (hasClient) {
  app.use(express.static(clientDist, { index: false }));
  app.get('/', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  logger.info(`Serving built client from ${clientDist}`);
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html><head><title>Blackout Protocol — server</title>
<style>body{font-family:system-ui;background:#07090d;color:#d8dbe2;max-width:640px;margin:60px auto;padding:0 24px;line-height:1.5}
code{background:#11141a;padding:2px 6px;border-radius:4px;color:#36e2c2}
h1{letter-spacing:.18em}</style></head>
<body><h1>BLACKOUT<span style="color:#36e2c2">PROTOCOL</span></h1>
<p>Server is running and ready to accept connections.</p>
<p>To play, build the client and then refresh:</p>
<pre><code>npm run build:client</code></pre>
<p>Or run the Vite dev server separately (HMR):</p>
<pre><code>npm run dev:client  # serves on :5173</code></pre>
<p>Endpoints: <code>/health</code>, <code>/monitor</code>, <code>/matchmake/&lt;...&gt;</code></p>
</body></html>`);
  });
  logger.info(`Client dist not built — \`npm run build:client\` to serve the game from this port.`);
}

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
    pingInterval: 5000,
    pingMaxRetries: 3,
  }),
});

gameServer.define(ROOM_NAME, HeistRoom)
  .filterBy(['mode', 'difficulty']);

gameServer.listen(PORT, HOST).then(() => {
  logger.info(`Blackout Protocol server listening on ${HOST}:${PORT}`);
  logger.info(`Monitor available at http://${HOST}:${PORT}/monitor`);
});

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  await gameServer.gracefullyShutdown();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});
