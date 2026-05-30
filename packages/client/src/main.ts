import { NetClient } from './net/NetClient.js';
import { Renderer } from './game/Renderer.js';
import { InputManager } from './game/Input.js';
import { HUD } from './game/HUD.js';
import { audio } from './game/Audio.js';
import { TouchControls } from './game/TouchControls.js';
import { Minimap } from './game/Minimap.js';
import { CLIENT_INPUT_RATE, MatchPhase } from '@blackout/shared';
import type { HeistState } from '@blackout/shared';

declare const __APP_VERSION__: string;

const versionEl = document.getElementById('version');
if (versionEl) versionEl.textContent = __APP_VERSION__;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const nameInput = $('player-name') as HTMLInputElement;
const classSelect = $('player-class') as HTMLSelectElement;
const serverInput = $('server-url') as HTMLInputElement;
const statusEl = $('menu-status') as HTMLDivElement;
const overlay = $('overlay') as HTMLDivElement;
const menu = $('menu') as HTMLDivElement;
const endScreen = $('end-screen') as HTMLDivElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;

nameInput.value = localStorage.getItem('bp_name') || `Operative-${Math.floor(Math.random() * 9999)}`;
serverInput.value = localStorage.getItem('bp_server') || '';
classSelect.value = localStorage.getItem('bp_class') || 'infiltrator';

const muteCb = document.getElementById('mute-audio') as HTMLInputElement;
const initialMute = localStorage.getItem('bp_mute') === '1';
muteCb.checked = initialMute;
audio.setMuted(initialMute);
muteCb.addEventListener('change', () => {
  audio.setMuted(muteCb.checked);
  localStorage.setItem('bp_mute', muteCb.checked ? '1' : '0');
});

const net = new NetClient();
const renderer = new Renderer(canvas);
const input = new InputManager(canvas);
const hud = new HUD();
const touch = new TouchControls(document.body);
input.bindTouch(touch);
const minimap = new Minimap(document.getElementById('hud') as HTMLElement);

let inputSeq = 0;
let inputTimer = 0;
let lastTickTime = performance.now();
let didBuildStatic = false;
let lastEndShown = false;
let lastAlarmActive = false;
let lastCarryState = false;
let lastDoorOpens = new Map<string, boolean>();
let lastPlayerStates = new Map<string, string>();
let lastReviveProgress = new Map<string, number>();

const setStatus = (msg: string, isError = false) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
};

const startConnect = async (mode: 'create' | 'join') => {
  const name = (nameInput.value || 'Operative').trim();
  const className = classSelect.value;
  localStorage.setItem('bp_name', name);
  localStorage.setItem('bp_server', serverInput.value);
  localStorage.setItem('bp_class', className);
  // Compute and show the URL we're about to try, so failures are debuggable at a glance.
  const previewUrl = serverInput.value || (() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}`;
  })();
  setStatus(`Connecting to ${previewUrl}…`);
  try {
    const room = await net.connect({ serverUrl: serverInput.value, name, className, mode });
    setStatus(`Connected to ${room.roomId}`);
    renderer.setLocalPlayerId(room.sessionId);
    attachRoomListeners(room);
    overlay.classList.add('hidden');
    audio.ensure();
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
  lastAlarmActive = false;
  lastCarryState = false;
  lastDoorOpens = new Map();
  lastPlayerStates = new Map();
  lastReviveProgress = new Map();
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

/**
 * Compare against last frame to fire audio cues / one-shot effects on state changes.
 * Keeps the renderer + audio decoupled and the cue triggers cheap.
 */
const driveCues = (state: HeistState, localId: string | null) => {
  if (state.alarmActive !== lastAlarmActive) {
    if (state.alarmActive) audio.play('alarm');
    lastAlarmActive = state.alarmActive;
  }

  const me = localId ? state.players.get(localId) : null;
  if (me) {
    if (me.isCarryingLoot !== lastCarryState) {
      if (me.isCarryingLoot) audio.play('pickup');
      lastCarryState = me.isCarryingLoot;
    }
  }

  state.doors.forEach((d) => {
    const prev = lastDoorOpens.get(d.id);
    if (prev !== undefined && prev !== d.open) audio.play('door');
    lastDoorOpens.set(d.id, d.open);
  });

  state.players.forEach((p) => {
    const prev = lastPlayerStates.get(p.id);
    if (prev !== undefined && prev !== p.state) {
      if (p.state === 'down') audio.play('down');
      else if (p.state === 'extracted') audio.play('extracted');
    }
    lastPlayerStates.set(p.id, p.state);

    // Revive completion cue (transition reviveProgress 1→0 with state alive).
    const prevP = lastReviveProgress.get(p.id) ?? 0;
    if (prevP > 0.9 && p.reviveProgress < 0.1 && p.state === 'alive') {
      audio.play('revive');
    }
    lastReviveProgress.set(p.id, p.reviveProgress);
  });
};

// Main loop
const loop = (now: number) => {
  const dt = (now - lastTickTime) / 1000;
  lastTickTime = now;

  const room = net.room;
  if (room) {
    const state = room.state;
    if (!didBuildStatic && state.mapData.walls.length > 0) {
      renderer.buildStatic(state);
      didBuildStatic = true;
    }
    renderer.update(state);
    hud.update(state, room.sessionId);
    minimap.update(state, room.sessionId);
    driveCues(state, room.sessionId);

    inputTimer += dt;
    const interval = 1 / CLIENT_INPUT_RATE;
    if (inputTimer >= interval) {
      inputTimer = 0;
      const me = state.players.get(room.sessionId);
      const snap = input.poll((x, y) => renderer.screenToWorld(x, y), me ? { x: me.x, y: me.y } : undefined);
      inputSeq++;
      net.sendInput({
        seq: inputSeq, moveX: snap.moveX, moveY: snap.moveY,
        aimX: snap.aimX, aimY: snap.aimY, actions: snap.actions,
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

requestAnimationFrame((t) => { lastTickTime = t; loop(t); });
