/**
 * Touch-screen input layer.  Renders a thumb joystick in the bottom-left
 * for movement and an interact button in the bottom-right.  Coexists with
 * keyboard/mouse — values are merged in InputManager.
 *
 * Detection is feature-based (any touchstart on the canvas activates touch
 * mode), so it works on phones, tablets, and laptop touchscreens without
 * UA sniffing.
 */
export class TouchControls {
  /** Movement vector, range [-1..1] for each axis. (0,0) when idle. */
  moveX = 0;
  moveY = 0;
  /** Aim direction normalised; (0,0) when no aim touch is active. */
  aimX = 0;
  aimY = 0;
  /** Interact was tapped this frame. Cleared by `consumeInteract`. */
  private interactQueued = false;
  /** True once we've seen a touch — used to flip the HUD into touch mode. */
  active = false;

  private leftStick: HTMLDivElement;
  private leftKnob: HTMLDivElement;
  private rightStick: HTMLDivElement;
  private rightKnob: HTMLDivElement;
  private interactBtn: HTMLButtonElement;

  private leftTouchId: number | null = null;
  private rightTouchId: number | null = null;
  private leftCenter = { x: 0, y: 0 };
  private rightCenter = { x: 0, y: 0 };
  private readonly stickRadius = 64;     // px from center to edge of pad

  constructor(host: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.id = 'touch-controls';
    wrap.className = 'hidden';
    wrap.innerHTML = `
      <div id="touch-left" class="touch-stick"><div class="touch-knob"></div></div>
      <div id="touch-right" class="touch-stick"><div class="touch-knob"></div></div>
      <button id="touch-interact">E</button>
    `;
    host.appendChild(wrap);

    this.leftStick    = wrap.querySelector('#touch-left')!  as HTMLDivElement;
    this.leftKnob     = this.leftStick.querySelector('.touch-knob')! as HTMLDivElement;
    this.rightStick   = wrap.querySelector('#touch-right')! as HTMLDivElement;
    this.rightKnob    = this.rightStick.querySelector('.touch-knob')! as HTMLDivElement;
    this.interactBtn  = wrap.querySelector('#touch-interact')! as HTMLButtonElement;

    // Use pointer events — these unify mouse + touch + pen and let us track
    // multiple simultaneous contacts cleanly via pointerId.
    document.addEventListener('pointerdown',   (e) => this.onPointerDown(e),   { passive: false });
    document.addEventListener('pointermove',   (e) => this.onPointerMove(e),   { passive: false });
    document.addEventListener('pointerup',     (e) => this.onPointerUp(e),     { passive: false });
    document.addEventListener('pointercancel', (e) => this.onPointerUp(e),     { passive: false });

    this.interactBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.activate();
      this.interactQueued = true;
    });

    // Suppress iOS double-tap zoom / context menu while playing.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('#touch-controls') || el.tagName === 'CANVAS')) e.preventDefault();
    });
  }

  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  private activate() {
    if (this.active) return;
    this.active = true;
    document.getElementById('touch-controls')?.classList.remove('hidden');
  }

  private onPointerDown(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    // Ignore touches inside the menu/HUD panels so users can scroll/tap UI.
    const t = e.target as HTMLElement;
    if (t.closest('#overlay') || t.closest('.corner')) return;
    this.activate();
    e.preventDefault();
    const screenMid = window.innerWidth / 2;
    if (e.clientX < screenMid && this.leftTouchId === null) {
      this.leftTouchId = e.pointerId;
      this.leftCenter = { x: e.clientX, y: e.clientY };
      this.leftStick.style.left = `${e.clientX - this.stickRadius}px`;
      this.leftStick.style.top  = `${e.clientY - this.stickRadius}px`;
      this.leftStick.style.opacity = '1';
      this.updateKnob(this.leftKnob, 0, 0);
    } else if (e.clientX >= screenMid && this.rightTouchId === null) {
      this.rightTouchId = e.pointerId;
      this.rightCenter = { x: e.clientX, y: e.clientY };
      this.rightStick.style.left = `${e.clientX - this.stickRadius}px`;
      this.rightStick.style.top  = `${e.clientY - this.stickRadius}px`;
      this.rightStick.style.opacity = '1';
      this.updateKnob(this.rightKnob, 0, 0);
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.leftTouchId) {
      const dx = e.clientX - this.leftCenter.x;
      const dy = e.clientY - this.leftCenter.y;
      const [nx, ny, kx, ky] = this.clampToStick(dx, dy);
      this.moveX = nx;
      this.moveY = ny;
      this.updateKnob(this.leftKnob, kx, ky);
      e.preventDefault();
    } else if (e.pointerId === this.rightTouchId) {
      const dx = e.clientX - this.rightCenter.x;
      const dy = e.clientY - this.rightCenter.y;
      const len = Math.hypot(dx, dy);
      const [, , kx, ky] = this.clampToStick(dx, dy);
      this.updateKnob(this.rightKnob, kx, ky);
      if (len > 8) {
        this.aimX = dx / len;
        this.aimY = dy / len;
      } else {
        this.aimX = 0; this.aimY = 0;
      }
      e.preventDefault();
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.leftTouchId) {
      this.leftTouchId = null;
      this.moveX = 0; this.moveY = 0;
      this.leftStick.style.opacity = '0';
      this.updateKnob(this.leftKnob, 0, 0);
    } else if (e.pointerId === this.rightTouchId) {
      this.rightTouchId = null;
      this.aimX = 0; this.aimY = 0;
      this.rightStick.style.opacity = '0';
      this.updateKnob(this.rightKnob, 0, 0);
    }
  }

  private clampToStick(dx: number, dy: number): [number, number, number, number] {
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return [0, 0, 0, 0];
    const cl = Math.min(len, this.stickRadius);
    const kx = (dx / len) * cl;
    const ky = (dy / len) * cl;
    return [dx / Math.max(len, this.stickRadius), dy / Math.max(len, this.stickRadius), kx, ky];
  }

  private updateKnob(knob: HTMLDivElement, kx: number, ky: number) {
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }
}
