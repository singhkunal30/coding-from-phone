import { NetClient } from './net/NetClient.js';
import { Renderer } from './game/Renderer.js';
import { InputManager } from './game/Input.js';
import { HUD } from './game/HUD.js';
import { CLIENT_INPUT_RATE, MatchPhase } from '@blackout/shared';
import type { HeistState } from '@blackout/shared';

declare const __APP_VERSION__: string;

const versionEl = document.getElementById('version');
if (versionEl) versionEl.textContent = __APP_VERSION__;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const nameInput = $('player-name') as HTMLInputElement;
const serverInput = $('server-url') as HTMLInputElement;
const statusEl = $('menu-status') as HTMLDivElement;
const overlay = $('overlay') as HTMLDivElement;
const menu = $('menu') as HTMLDivElement;
const endScreen = $('end-screen') as HTMLDivElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;

nameInput.value = localStorage.getItem('bp_name') || `Operative-${Math.floor(Math.random() * 9999)}`;
serverInput.value = localStorage.getItem('bp_server') || '';

const net = new NetClient();
const renderer = new Renderer(canvas);
const input = new InputManager(canvas);
const hud = new HUD();

let inputSeq = 0;
let inputTimer = 0;
let lastTickTime = performance.now();
let didBuildStatic = false;
let lastEndShown = false;

const setStatus = (msg: string, isError = false) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
};

const startConnect = async (mode: 'create' | 'join') => {
  const name = (nameInput.value || 'Operative').trim();
  localStorage.setItem('bp_name', name);
  localStorage.setItem('bp_server', serverInput.value);
  setStatus('Connecting...');
  try {
    const room = await net.connect({ serverUrl: serverInput.value, name, mode });
    setStatus(`Connected to ${room.roomId}`);
    renderer.setLocalPlayerId(room.sessionId);
    attachRoomListeners(room);
    overlay.classList.add('hidden');
  } catch (e: any) {
    console.error(e);
    setStatus(e?.message || 'Connection failed', true);
  }
};

document.getElementById('btn-create')!.addEventListener('click', () => startConnect('create'));
document.getElementById('btn-join')!.addEventListener('click', () => startConnect('join'));
document.getElementById('btn-rematch')!.addEventListener('click', () => {
  endScreen.classList.add('hidden');
  menu.classList.remove('hidden');
  overlay.classList.remove('hidden');
  lastEndShown = false;
  didBuildStatic = false;
  net.leave();
});

const attachRoomListeners = (room: { state: HeistState; onStateChange: any; onLeave: any; onError: any; sessionId: string }) => {
  room.onStateChange((state: HeistState) => {
    if (!didBuildStatic && state.mapData.walls.length > 0) {
      renderer.buildStatic(state);
      didBuildStatic = true;
    }
  });
  room.onError((code: number, message?: string) => {
    setStatus(`Server error ${code}: ${message ?? ''}`, true);
  });
  room.onLeave((code: number) => {
    if (code !== 1000) setStatus(`Disconnected (${code})`, true);
  });
};

// Main loop
const loop = (now: number) => {
  const dt = (now - lastTickTime) / 1000;
  lastTickTime = now;

  const room = net.room;
  if (room) {
    const state = room.state;

    // Build static once schemas are populated.
    if (!didBuildStatic && state.mapData.walls.length > 0) {
      renderer.buildStatic(state);
      didBuildStatic = true;
    }

    renderer.update(state);
    hud.update(state, room.sessionId);

    // Send input at fixed rate.
    inputTimer += dt;
    const interval = 1 / CLIENT_INPUT_RATE;
    if (inputTimer >= interval) {
      inputTimer = 0;
      const snap = input.poll((x, y) => renderer.screenToWorld(x, y));
      inputSeq++;
      net.sendInput({
        seq: inputSeq,
        moveX: snap.moveX,
        moveY: snap.moveY,
        aimX: snap.aimX,
        aimY: snap.aimY,
        actions: snap.actions,
      });
    }

    if (input.consumeInteract()) net.sendInteract();

    if (state.phase === MatchPhase.ENDED && !lastEndShown) {
      lastEndShown = true;
      hud.showEndScreen(state);
    }
  }

  renderer.render();
  requestAnimationFrame(loop);
};

requestAnimationFrame((t) => {
  lastTickTime = t;
  loop(t);
});
