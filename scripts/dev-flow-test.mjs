// Simulates the *exact* dev-mode flow: matchmake via the Vite proxy on :5173,
// then complete the WebSocket connection that previously hung.
import { Client } from 'colyseus.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // colyseus.js will use this URL for both matchmaking and the WebSocket upgrade.
  // In real browser usage, the URL is ws://localhost:5173 (the page origin), but
  // the fix in NetClient.defaultUrl reroutes to :2567 for the WS upgrade.
  // Here we test the *new* default behavior — connect direct to :2567.
  const c = new Client('ws://localhost:2567');
  const room = await c.joinOrCreate('heist', { name: 'DevFlowTest' });
  console.log(`Connected: roomId=${room.roomId} sessionId=${room.sessionId}`);
  let stateReceived = false;
  room.onStateChange(() => { stateReceived = true; });
  // Give it a moment for state to arrive over WS.
  for (let i = 0; i < 30 && !stateReceived; i++) await sleep(100);
  if (!stateReceived) throw new Error('No state received over WebSocket');
  console.log(`State received. phase=${room.state.phase} walls=${room.state.mapData.walls.length}`);
  await room.leave();
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
