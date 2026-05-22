/**
 * Stand-in audio cues built from Web Audio oscillators — no asset pipeline yet.
 * Each cue is a 1–3 osc burst with a fast envelope; cheap, recognisable, swap-able.
 */

type CueName = 'alarm' | 'pickup' | 'door' | 'extracted' | 'down' | 'spotted' | 'revive';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    } catch {/* not supported */}
  }

  setMuted(m: boolean) { this.muted = m; }

  play(cue: CueName) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    switch (cue) {
      case 'alarm':
        this.tone(440, 0.6, 0.25, t);
        this.tone(660, 0.6, 0.25, t + 0.18);
        break;
      case 'pickup':
        this.tone(880, 0.08, 0.15, t);
        this.tone(1320, 0.06, 0.15, t + 0.05);
        break;
      case 'door':
        this.tone(180, 0.12, 0.18, t, 'square');
        break;
      case 'extracted':
        this.tone(523, 0.15, 0.18, t);
        this.tone(659, 0.15, 0.18, t + 0.1);
        this.tone(784, 0.4, 0.2, t + 0.2);
        break;
      case 'down':
        this.tone(150, 0.5, 0.3, t, 'sawtooth');
        break;
      case 'spotted':
        this.tone(880, 0.07, 0.2, t);
        this.tone(660, 0.07, 0.2, t + 0.06);
        this.tone(440, 0.12, 0.2, t + 0.12);
        break;
      case 'revive':
        this.tone(523, 0.1, 0.18, t);
        this.tone(784, 0.2, 0.18, t + 0.1);
        break;
    }
  }

  private tone(freq: number, dur: number, gain: number, when: number, type: OscillatorType = 'sine') {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(this.master);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
}

export const audio = new Audio();
