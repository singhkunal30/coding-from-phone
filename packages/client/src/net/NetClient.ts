import { Client, Room } from 'colyseus.js';
import type { HeistState } from '@blackout/shared';
import { ROOM_NAME } from '@blackout/shared';

export interface ConnectOptions {
  serverUrl: string;
  name: string;
  className?: string;
  mode?: 'create' | 'join';
}

export class NetClient {
  private client: Client | null = null;
  room: Room<HeistState> | null = null;

  /** Visible to the UI for status reporting / error messages. */
  lastUrl: string | null = null;

  async connect(opts: ConnectOptions): Promise<Room<HeistState>> {
    const url = opts.serverUrl || this.defaultUrl();
    this.lastUrl = url;
    console.info(`[net] Connecting to ${url}`);

    // Probe the HTTP endpoint first so we fail fast with a clear message instead
    // of hanging on the WebSocket upgrade when the server is unreachable.
    const httpUrl = url.replace(/^ws/, 'http');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`${httpUrl}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`health check returned ${r.status}`);
      console.info(`[net] health OK at ${httpUrl}/health`);
    } catch (e: any) {
      throw new Error(`Cannot reach server at ${httpUrl} (${e?.message ?? e}). ` +
        `Make sure the game server is running and the port is reachable from this browser.`);
    }

    this.client = new Client(url);
    const joinOpts = { name: opts.name, className: opts.className };

    // joinOrCreate hangs forever if the WebSocket upgrade silently fails.
    // Race it with a manual timeout so the UI can show a real error.
    const joinPromise = opts.mode === 'create'
      ? this.client.create<HeistState>(ROOM_NAME, joinOpts)
      : this.client.joinOrCreate<HeistState>(ROOM_NAME, joinOpts);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(
        `WebSocket upgrade timed out after 8s connecting to ${url}. ` +
        `The HTTP matchmaking call succeeded but the WS handshake did not. ` +
        `If you are using a cloud/dev environment, ensure port ${url.split(':').pop()} is forwarded to your browser.`
      )), 8000);
    });

    const room = await Promise.race([joinPromise, timeoutPromise]);
    console.info(`[net] Joined room ${room.roomId} as ${room.sessionId}`);

    this.room = room;
    this.storeReconnectToken(room);
    return room;
  }

  async reconnect(serverUrl: string): Promise<Room<HeistState> | null> {
    const token = this.loadReconnectToken();
    if (!token) return null;
    try {
      this.client ??= new Client(serverUrl || this.defaultUrl());
      const room = await this.client.reconnect(token);
      this.room = room;
      return room;
    } catch (e) {
      console.warn('Reconnect failed', e);
      this.clearReconnectToken();
      return null;
    }
  }

  sendInput(input: unknown) { this.room?.send('input', input); }
  sendInteract() { this.room?.send('interact'); }
  sendChat(text: string) { this.room?.send('chat', text); }
  sendReady() { this.room?.send('ready'); }

  leave() {
    this.room?.leave();
    this.room = null;
    this.clearReconnectToken();
  }

  private defaultUrl() {
    if (typeof window === 'undefined') return 'ws://localhost:2567';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Same origin as the page.  Vite dev (and any production reverse proxy)
    // routes /matchmake (HTTP) and short room-id paths (WS upgrade) to the
    // game server.  This means everything works through whichever single
    // hostname:port the browser already has access to — no extra port
    // forwarding needed.
    return `${proto}://${window.location.host}`;
  }

  private storeReconnectToken(room: Room) {
    try {
      sessionStorage.setItem('bp_reconnect', room.reconnectionToken);
    } catch {/* noop */}
  }
  private loadReconnectToken(): string | null {
    try { return sessionStorage.getItem('bp_reconnect'); } catch { return null; }
  }
  private clearReconnectToken() {
    try { sessionStorage.removeItem('bp_reconnect'); } catch {/* noop */}
  }
}
