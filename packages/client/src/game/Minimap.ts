import type { HeistState } from '@blackout/shared';

/**
 * Top-down 2D minimap rendered into a small canvas overlay.  Shows:
 *   - walls (static, cached after first build)
 *   - doors (open/closed colour)
 *   - extraction zone
 *   - uncollected loot
 *   - other players (colour-coded by state)
 *   - guards (colour-coded by alert state)
 *   - local player as a chevron pointing in facing direction
 *
 * Wall geometry is rasterised once into an offscreen canvas and blitted
 * each frame so per-frame cost is just the moving entities.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private staticBg: HTMLCanvasElement | null = null;
  private staticBgCtx: CanvasRenderingContext2D | null = null;
  private size = 180;
  private worldW = 80;
  private worldH = 80;

  constructor(host: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.id = 'minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    wrap.appendChild(this.canvas);
    host.appendChild(wrap);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Build the static (walls/extraction) background.  Idempotent. */
  buildStatic(state: HeistState) {
    if (this.staticBg) return;
    this.worldW = state.mapData.width;
    this.worldH = state.mapData.height;
    this.staticBg = document.createElement('canvas');
    this.staticBg.width = this.size;
    this.staticBg.height = this.size;
    const c = this.staticBg.getContext('2d')!;
    this.staticBgCtx = c;
    c.fillStyle = '#0a0d12';
    c.fillRect(0, 0, this.size, this.size);
    // walls
    c.strokeStyle = '#3a4150';
    c.lineWidth = 1.5;
    c.beginPath();
    state.mapData.walls.forEach((w) => {
      const [x1, y1] = this.toPx(w.x1, w.y1);
      const [x2, y2] = this.toPx(w.x2, w.y2);
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
    });
    c.stroke();
    // extraction zone outline
    c.strokeStyle = '#36e2c2';
    c.lineWidth = 2;
    state.extractionZones.forEach((z) => {
      const [cx, cy] = this.toPx(z.x, z.y);
      const r = (z.radius / this.worldW) * this.size;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
    });
  }

  update(state: HeistState, localId: string | null) {
    if (!this.staticBg && state.mapData.walls.length > 0) this.buildStatic(state);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    if (this.staticBg) ctx.drawImage(this.staticBg, 0, 0);

    // doors
    state.doors.forEach((d) => {
      const [x, y] = this.toPx(d.x, d.y);
      ctx.fillStyle = d.locked ? '#a55a2b' : d.open ? '#2a3a4a' : '#6e7585';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    });

    // uncollected loot
    state.loot.forEach((l) => {
      if (l.collected || l.carrierId) return;
      const [x, y] = this.toPx(l.x, l.y);
      ctx.fillStyle = l.id.startsWith('kc_') ? '#f5b042' : '#fff066';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    });

    // guards
    state.guards.forEach((g) => {
      const [x, y] = this.toPx(g.x, g.y);
      ctx.fillStyle = g.state === 'chase' || g.state === 'attack' ? '#ff4d6a'
        : g.state === 'investigate' ? '#f5b042'
        : g.state === 'dead' ? '#3a3f4a'
        : '#8a93a3';
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });

    // other players
    state.players.forEach((p) => {
      if (p.id === localId) return;
      const [x, y] = this.toPx(p.x, p.y);
      ctx.fillStyle = p.state === 'extracted' ? '#36e2c2'
        : p.state === 'down' ? '#ff4d6a'
        : p.state === 'dead' ? '#3a3f4a'
        : '#f5b042';
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });

    // local player as a chevron pointing in facing direction
    const me = localId ? state.players.get(localId) : null;
    if (me) {
      const [x, y] = this.toPx(me.x, me.y);
      const ang = Math.atan2(me.dirX, me.dirY);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-ang);
      ctx.fillStyle = '#36e2c2';
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(3, 3.5);
      ctx.lineTo(-3, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // alarm flash
    if (state.alarmActive) {
      const flash = (Math.sin(state.serverTime / 150) + 1) * 0.5;
      ctx.strokeStyle = `rgba(255, 77, 106, ${0.4 + flash * 0.6})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(0.5, 0.5, this.size - 1, this.size - 1);
    }
  }

  private toPx(x: number, y: number): [number, number] {
    return [(x / this.worldW) * this.size, (y / this.worldH) * this.size];
  }
}
