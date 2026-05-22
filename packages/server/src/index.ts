import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { Encoder } from '@colyseus/schema';

// Bump encoder buffer for our larger initial state (procedural map + entities).
Encoder.BUFFER_SIZE = 64 * 1024;
import express from 'express';
import cors from 'cors';
import http from 'http';
import { ROOM_NAME } from '@blackout/shared';
import { HeistRoom } from './rooms/HeistRoom.js';
import { logger } from './lib/logger.js';

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

app.get('/', (_req, res) => {
  res.json({
    name: 'Blackout Protocol Server',
    version: '0.1.0',
    rooms: [ROOM_NAME],
  });
});

// Colyseus monitor (room/state inspection in dev)
app.use('/monitor', monitor());

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
