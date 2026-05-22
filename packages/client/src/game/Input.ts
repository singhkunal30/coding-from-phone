import { InputAction } from '@blackout/shared';

export interface InputSnapshot {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  actions: number;
  interactPressed: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private interactQueued = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF') this.interactQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('mousemove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  poll(worldFromScreen: (x: number, y: number) => { x: number; y: number }): InputSnapshot {
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    let mx = (right ? 1 : 0) - (left ? 1 : 0);
    let my = (down ? 1 : 0) - (up ? 1 : 0);
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    let actions = 0;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) actions |= InputAction.SPRINT;
    if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) actions |= InputAction.CROUCH;

    const aim = worldFromScreen(this.mouseX, this.mouseY);

    return {
      moveX: mx,
      moveY: my,
      aimX: aim.x,
      aimY: aim.y,
      actions,
      interactPressed: false,
    };
  }
}
