import type { HeistState } from '@blackout/shared';
import { MatchPhase, MATCH } from '@blackout/shared';

/**
 * Reactive HUD. Built imperatively (no framework) for size + zero overhead.
 * Refreshed each frame against the current Colyseus state.
 */
export class HUD {
  private root: HTMLDivElement;
  private cards: Record<string, HTMLDivElement> = {};
  private extractEl: HTMLDivElement;
  private extractFill: HTMLDivElement;
  private endScreen: HTMLDivElement;
  private endTitle: HTMLElement;
  private endSummary: HTMLDivElement;

  constructor() {
    this.root = document.getElementById('hud') as HTMLDivElement;
    for (const k of ['tl', 'tr', 'bl', 'br', 'tc', 'bc']) {
      const div = document.createElement('div');
      div.className = `corner ${k}`;
      this.cards[k] = div;
      this.root.appendChild(div);
    }

    this.extractEl = document.createElement('div');
    this.extractEl.className = 'extract-ring hidden';
    this.extractEl.innerHTML = '<div class="fill"></div>';
    this.root.appendChild(this.extractEl);
    this.extractFill = this.extractEl.querySelector('.fill') as HTMLDivElement;

    this.endScreen = document.getElementById('end-screen') as HTMLDivElement;
    this.endTitle = document.getElementById('end-title') as HTMLElement;
    this.endSummary = document.getElementById('end-summary') as HTMLDivElement;
  }

  showEndScreen(state: HeistState) {
    const overlay = document.getElementById('overlay') as HTMLDivElement;
    const menu = document.getElementById('menu') as HTMLDivElement;
    menu.classList.add('hidden');
    this.endScreen.classList.remove('hidden');
    overlay.classList.remove('hidden');

    const rows: string[] = [];
    state.players.forEach((p) => {
      rows.push(`<tr><td>${escapeHtml(p.name)}</td><td>${p.state}</td><td>${p.stolenValue}</td></tr>`);
    });
    let outcome = 'Mission complete';
    let any = false;
    state.players.forEach((p) => { if (p.state === 'extracted') any = true; });
    if (!any) outcome = 'Mission failed';
    this.endTitle.textContent = outcome;
    this.endSummary.innerHTML = `
      <p>Total extracted: <b>${state.extractedValue} cr</b> / ${state.totalLootValue} cr</p>
      <table>
        <thead><tr><th>Operative</th><th>Status</th><th>Loot</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  }

  hideEndScreen() {
    this.endScreen.classList.add('hidden');
  }

  update(state: HeistState, localId: string | null) {
    const me = localId ? state.players.get(localId) : null;

    // TL: status, health
    const meStatus = me
      ? `<div class="label">${escapeHtml(me.name)} &middot; ${me.className} &middot; ${me.state}</div>
         <div class="value">${Math.round(me.health)}/${me.maxHealth}</div>
         <div class="health-bar"><div class="fill" style="width:${(me.health / me.maxHealth) * 100}%"></div></div>
         <div class="label" style="margin-top:8px">Loot: ${me.stolenValue}cr ${me.isCarryingLoot ? '&middot; carrying' : ''} ${me.hasKeycard ? '&middot; keycard' : ''}</div>
         ${me.reviveProgress > 0 ? `<div class="label" style="margin-top:6px; color:#f5b042">Being revived ${Math.round(me.reviveProgress * 100)}%</div>` : ''}`
      : `<div class="label">Spectating</div>`;
    this.cards.tl.innerHTML = meStatus;

    // TR: match info
    const phaseLabel: Record<string, string> = {
      [MatchPhase.LOBBY]: 'Lobby',
      [MatchPhase.COUNTDOWN]: 'Starting',
      [MatchPhase.ACTIVE]: 'Heist active',
      [MatchPhase.EXTRACTION]: 'Extraction',
      [MatchPhase.ENDED]: 'Ended',
    };
    let timer = '';
    if (state.phase === MatchPhase.COUNTDOWN) {
      const remain = Math.max(0, state.phaseEndsAt - state.serverTime);
      timer = `${Math.ceil(remain / 1000)}s`;
    } else if (state.phase === MatchPhase.ACTIVE) {
      const remain = Math.max(0, state.matchEndsAt - state.serverTime);
      const s = Math.ceil(remain / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      timer = `${mm}:${ss}`;
      const remainingSec = remain / 1000;
      if (remainingSec < MATCH.LOCKDOWN_WARNING_MS / 1000) {
        // visual hint via class added below.
      }
    }
    const alarmHtml = state.alarmActive ? '<div style="color:#ff4d6a; margin-top:6px; letter-spacing: 0.1em;">ALARM ACTIVE</div>' : '';
    this.cards.tr.innerHTML = `
      <div class="label">Mission</div>
      <div class="value">${phaseLabel[state.phase] ?? state.phase}</div>
      <div class="label" style="margin-top:6px">Time</div>
      <div class="value">${timer || '—'}</div>
      ${alarmHtml}`;
    this.cards.tr.classList.toggle('alarm-banner', state.alarmActive);

    // TC: objective progress
    this.cards.tc.innerHTML = `
      <div class="label">Loot Extracted</div>
      <div class="value">${state.extractedValue} / ${state.totalLootValue} cr</div>`;

    // BR: team roster
    const roster: string[] = [];
    state.players.forEach((p) => {
      const color = p.state === 'extracted' ? '#36e2c2'
        : p.state === 'dead' ? '#6e7585'
        : p.state === 'down' ? '#ff4d6a' : '#d8dbe2';
      roster.push(`<div style="color:${color}">${escapeHtml(p.name)} &middot; ${p.state}${p.isCarryingLoot ? ' &middot; loot' : ''}</div>`);
    });
    this.cards.br.innerHTML = `<div class="label">Team</div>${roster.join('')}`;

    // BL: recent messages
    const msgs: string[] = [];
    state.recentMessages.forEach((m) => {
      msgs.push(`<div class="msg ${m.type}">${escapeHtml(m.text)}</div>`);
    });
    this.cards.bl.innerHTML = `<div class="label">Comms</div><div class="msg-list">${msgs.join('')}</div>`;

    // BC: controls hint + contextual prompts
    let prompt = '';
    if (me && me.state === 'alive') {
      // Find nearest downed teammate within range
      state.players.forEach((other) => {
        if (other.id === me.id || other.state !== 'down') return;
        const d = Math.hypot(other.x - me.x, other.y - me.y);
        if (d <= 1.6) prompt = `[E] Revive ${escapeHtml(other.name)}`;
      });
    }
    this.cards.bc.innerHTML = prompt
      ? `<div class="value" style="color: #36e2c2">${prompt}</div>`
      : `<div class="label">WASD move &middot; mouse aim &middot; E interact &middot; Shift sprint &middot; C crouch</div>`;

    // Extract progress
    if (me && me.extractionProgress > 0) {
      this.extractEl.classList.remove('hidden');
      this.extractFill.style.width = `${me.extractionProgress * 100}%`;
    } else {
      this.extractEl.classList.add('hidden');
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
