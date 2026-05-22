// Connects via the Vite dev port (5173), so the entire flow — matchmake +
// WebSocket upgrade — goes through Vite's proxy.  This is the *exact* path
// the browser takes.
import { Client } from 'colyseus.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const url = process.env.URL || 'ws://localhost:5173';
  console.log(`Connecting to ${url} (via Vite proxy)...`);
  const c = new Client(url);
  const room = await c.joinOrCreate('heist', { name: 'ProxyTest' });
  console.log(`Joined ${room.roomId} as ${room.sessionId}`);
  let stateReady = false;
  room.onStateChange(() => { stateReady = true; });
  for (let i = 0; i < 30 && !stateReady; i++) await sleep(100);
  if (!stateReady) throw new Error('No state from WS via Vite proxy');
  console.log(`State arrived. phase=${room.state.phase} walls=${room.state.mapData.walls.length}`);
  await room.leave();
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
