import { Client, Room } from 'colyseus.js';
import type { HeistState } from '@blackout/shared';
import { ROOM_NAME } from '@blackout/shared';

export interface ConnectOptions {
  serverUrl: string;
  name: string;
  mode?: 'create' | 'join';
}

export class NetClient {
  private client: Client | null = null;
  room: Room<HeistState> | null = null;

  async connect(opts: ConnectOptions): Promise<Room<HeistState>> {
    const url = opts.serverUrl || this.defaultUrl();
    this.client = new Client(url);

    const joinOpts = { name: opts.name };
    const room = opts.mode === 'create'
      ? await this.client.create<HeistState>(ROOM_NAME, joinOpts)
      : await this.client.joinOrCreate<HeistState>(ROOM_NAME, joinOpts);

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
    // Prefer same-origin (works behind Vite proxy and in production)
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
