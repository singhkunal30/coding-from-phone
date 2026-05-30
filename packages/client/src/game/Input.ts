import { InputAction } from '@blackout/shared';
import type { TouchControls } from './TouchControls.js';

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
  private touch: TouchControls | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF') this.interactQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('mousemove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindTouch(t: TouchControls) { this.touch = t; }

  consumeInteract(): boolean {
    const v = this.interactQueued || (this.touch?.consumeInteract() ?? false);
    this.interactQueued = false;
    return v;
  }

  poll(worldFromScreen: (x: number, y: number) => { x: number; y: number }, playerWorld?: { x: number; y: number }): InputSnapshot {
    // Keyboard movement
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    let mx = (right ? 1 : 0) - (left ? 1 : 0);
    let my = (down ? 1 : 0) - (up ? 1 : 0);

    // Touch movement (overrides keyboard if non-zero)
    if (this.touch && (Math.abs(this.touch.moveX) > 0.05 || Math.abs(this.touch.moveY) > 0.05)) {
      mx = this.touch.moveX;
      my = this.touch.moveY;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    let actions = 0;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) actions |= InputAction.SPRINT;
    if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) actions |= InputAction.CROUCH;

    // Aim: prefer right thumbstick when held; else mouse; else inferred from movement.
    let aim: { x: number; y: number };
    if (this.touch && (Math.abs(this.touch.aimX) > 0.05 || Math.abs(this.touch.aimY) > 0.05) && playerWorld) {
      // Touch aim is a normalised screen-space direction; project into world from player.
      aim = { x: playerWorld.x + this.touch.aimX * 20, y: playerWorld.y + this.touch.aimY * 20 };
    } else if (this.touch?.active && playerWorld && (mx !== 0 || my !== 0)) {
      // No aim stick held but we're moving — face movement direction.
      aim = { x: playerWorld.x + mx * 10, y: playerWorld.y + my * 10 };
    } else {
      aim = worldFromScreen(this.mouseX, this.mouseY);
    }

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
