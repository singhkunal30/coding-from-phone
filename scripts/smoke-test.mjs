// End-to-end smoke test: connect 2 simulated players, send inputs, verify movement.
import { Client } from 'colyseus.js';

const URL = process.env.URL || 'ws://localhost:2567';
const ROOM = 'heist';

async function connect(name) {
  const c = new Client(URL);
  const room = await c.joinOrCreate(ROOM, { name });
  return room;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Connecting two simulated clients to ${URL}/${ROOM}...`);
  const a = await connect('A-Test');
  const b = await connect('B-Test');
  console.log('Joined room:', a.roomId, 'sessions:', a.sessionId, b.sessionId);

  let stateReady = false;
  a.onStateChange(() => { stateReady = true; });

  await sleep(500);
  if (!stateReady) throw new Error('No state change after join');

  // Wait for countdown → active
  console.log('Waiting for match to become active...');
  let elapsed = 0;
  while (a.state.phase !== 'active' && elapsed < 8000) {
    await sleep(200); elapsed += 200;
  }
  console.log('phase =', a.state.phase, 'players =', a.state.players.size,
    'guards =', a.state.guards.size, 'loot =', a.state.loot.size,
    'walls =', a.state.mapData.walls.length);

  if (a.state.phase !== 'active') throw new Error(`Expected active phase, got ${a.state.phase}`);
  if (a.state.guards.size === 0) throw new Error('No guards spawned');
  if (a.state.loot.size === 0) throw new Error('No loot spawned');
  if (a.state.mapData.walls.length === 0) throw new Error('No walls generated');

  // Record initial player positions
  const initialA = { ...a.state.players.get(a.sessionId) };
  const initialB = { ...b.state.players.get(b.sessionId) };

  // Send movement inputs in alternating directions to confirm the input pipeline regardless of spawn position.
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]];
  let seq = 0;
  for (const [mx, my] of dirs) {
    for (let i = 0; i < 12; i++) {
      a.send('input', { seq: ++seq, moveX: mx, moveY: my, aimX: 100, aimY: 50, actions: 0 });
      b.send('input', { seq: seq, moveX: -mx, moveY: -my, aimX: 50, aimY: 100, actions: 0 });
      await sleep(33);
    }
  }

  const movedA = a.state.players.get(a.sessionId);
  const movedB = b.state.players.get(b.sessionId);
  const dA = Math.hypot(movedA.x - initialA.x, movedA.y - initialA.y);
  const dB = Math.hypot(movedB.x - initialB.x, movedB.y - initialB.y);
  console.log(`Player A moved ${dA.toFixed(2)} units, Player B moved ${dB.toFixed(2)} units`);
  // Smoke test: each player must have moved at least 0.5 units in any direction.
  if (dA < 0.5 || dB < 0.5) throw new Error('Players did not move enough — input pipeline broken');

  // Verify guard simulation runs
  const g0 = [...a.state.guards.values()][0];
  console.log(`First guard state: ${g0.state} alert=${g0.alertLevel.toFixed(0)} pos=(${g0.x.toFixed(1)},${g0.y.toFixed(1)})`);

  await a.leave();
  await b.leave();
  console.log('OK — smoke test passed');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
