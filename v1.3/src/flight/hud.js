// Flight HUD: readouts, staging and resources, SAS controls, warp, messages, pause menu, map labels.
import { P } from './planet.js';
import { WARPS } from './sim.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const pad = (n) => String(Math.floor(n)).padStart(2, '0');

export const fmtDist = (m) => {
  const a = Math.abs(m);
  if (a < 10000) return `${m.toFixed(0)} m`;
  if (a < 1e7) return `${(m / 1000).toFixed(a < 1e5 ? 2 : 1)} km`;
  return `${(m / 1e6).toFixed(2)} Mm`;
};
export const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  s = Math.max(0, s);
  const d = Math.floor(s / 21600), h = Math.floor((s % 21600) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}d ` : ''}${h || d ? `${pad(h)}:` : ''}${pad(m)}:${pad(s % 60)}`;
};

const SAS_MODES = [['hold', 'HOLD', 'Hold attitude'], ['prograde', 'PRO', 'Prograde'], ['retrograde', 'RETRO', 'Retrograde'], ['radialOut', 'RAD+', 'Radial out'], ['radialIn', 'RAD−', 'Radial in'], ['normal', 'NRM+', 'Normal'], ['antinormal', 'NRM−', 'Anti-normal']];

export class HUD {
  constructor(actions) {
    this.actions = actions;
    const root = this.root = el('div', '', `
      <div class="card f-met"><b id="f-met">T+00:00</b><span id="f-name"></span><div id="f-warp"></div></div>
      <div class="f-alt"><b id="f-altv">0</b><span id="f-altl">ALTITUDE · SEA LEVEL</span><i id="f-vs"></i></div>
      <div class="f-btns"><button data-a="map" title="M">Map</button><button data-a="cam" title="V" id="f-cam">Chase</button><button data-a="menu" title="Esc">Menu</button></div>
      <div class="card f-stage"><div class="mono">Stages <kbd>Space</kbd></div><div id="f-stages"></div><div id="f-res"></div></div>
      <div class="card f-orbit"><div id="f-orb"></div></div>
      <div class="f-nav">
        <div class="f-thr" title="Throttle — Shift / Ctrl, Z full, X cut"><i id="f-thr"></i><span id="f-thrv"></span></div>
        <div class="f-ball"><div class="f-speed"><button id="f-mode">SURFACE</button><b id="f-spd">0.0 m/s</b></div><div class="f-nose"></div><div class="f-hdg" id="f-hdg"></div></div>
        <div class="f-sas"><div class="row"><button id="f-sas" title="T">SAS</button><button id="f-rcs" title="R">RCS</button></div><div class="grid" id="f-modes"></div><div class="f-g"><span>G</span><b id="f-g">1.0</b><span id="f-heat"></span></div></div>
      </div>
      <div id="f-msg"></div>
      <div id="f-hint"></div>
      <div id="f-black"></div>
      <div id="f-fade"></div>
      <div id="f-labels"></div>
      <div id="f-menu" hidden><div class="card sheet"><h2 id="f-menut">Paused</h2><p id="f-menup"></p>
        <button data-a="resume">Resume</button><button data-a="revertLaunch">Revert to launch</button><button data-a="revertHangar">Revert to hangar</button>
        <button data-a="quickload">Load quicksave <kbd>F9</kbd></button><button data-a="leave">Leave flight — keep it in the world</button></div></div>`);
    root.id = 'flight';
    document.body.append(root);
    this.$ = (s) => root.querySelector(s);
    root.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => actions[b.dataset.a](); });
    const modes = this.$('#f-modes');
    for (const [id, label, title] of SAS_MODES) { const b = el('button', '', label); b.dataset.m = id; b.title = title; b.onclick = () => actions.sasMode(id); modes.append(b); }
    this.$('#f-sas').onclick = () => actions.sas();
    this.$('#f-rcs').onclick = () => actions.rcs();
    this.$('#f-mode').onclick = () => actions.speedMode();
    const warp = this.$('#f-warp');
    WARPS.forEach((w, i) => { const b = el('button', '', w < 1000 ? `${w}×` : `${w / 1000}k`); b.dataset.i = i; b.onclick = () => actions.warp(i); warp.append(b); });
    this.labels = this.$('#f-labels');
    this.msgs = [];
    this.stageKey = '';
  }

  message(text, ms = 3800) {
    const m = el('div', '', text);
    this.$('#f-msg').prepend(m);
    setTimeout(() => m.classList.add('out'), ms);
    setTimeout(() => m.remove(), ms + 500);
    while (this.$('#f-msg').children.length > 4) this.$('#f-msg').lastChild.remove();
  }

  hint(html) { this.$('#f-hint').innerHTML = html; }
  fade(v) { this.$('#f-fade').style.opacity = v; }
  menu(open, title, text) { this.$('#f-menu').hidden = !open; if (title) this.$('#f-menut').textContent = title; this.$('#f-menup').textContent = text || ''; }
  get menuOpen() { return !this.$('#f-menu').hidden; }
  setMap(on) { this.root.classList.toggle('mapmode', on); }
  setCinematic(on) { this.root.classList.toggle('cine', on); }

  update(s) {
    const $ = this.$;
    $('#f-met').textContent = `T+${fmtTime(s.met)}`;
    $('#f-name').textContent = s.name;
    $('#f-altv').textContent = fmtDist(s.radar ? s.agl : s.alt);
    $('#f-altl').textContent = s.radar ? 'ALTITUDE · ABOVE GROUND' : 'ALTITUDE · SEA LEVEL';
    $('#f-vs').textContent = `${s.vs >= 0 ? '▲' : '▼'} ${Math.abs(s.vs).toFixed(1)} m/s`;
    $('#f-spd').textContent = `${s.speed.toFixed(1)} m/s`;
    $('#f-mode').textContent = s.orbital ? 'ORBIT' : 'SURFACE';
    $('#f-thr').style.height = `${s.throttle * 100}%`;
    $('#f-thrv').textContent = `${Math.round(s.throttle * 100)}`;
    $('#f-hdg').textContent = `HDG ${String(Math.round(s.hdg) % 360).padStart(3, '0')}°  PITCH ${s.pitch.toFixed(0)}°`;
    $('#f-g').textContent = s.g.toFixed(1);
    $('#f-g').className = s.g > 9 ? 'bad' : s.g > 5 ? 'warn' : '';
    $('#f-heat').textContent = s.heat > 0.75 ? 'OVERHEAT' : s.heat > 0.45 ? 'HEAT' : '';
    $('#f-heat').className = s.heat > 0.75 ? 'bad' : 'warn';
    $('#f-sas').classList.toggle('on', s.sas); $('#f-rcs').classList.toggle('on', s.rcs);
    this.root.querySelectorAll('#f-modes button').forEach((b) => b.classList.toggle('on', s.sas && b.dataset.m === s.sasMode));
    this.root.querySelectorAll('#f-warp button').forEach((b) => b.classList.toggle('on', +b.dataset.i === s.warpIndex));
    $('#f-cam').textContent = s.camName;
    $('#f-black').style.opacity = Math.min(1, Math.max(0, (s.blackout - 0.6) / 1.4));

    const o = s.orbit;
    $('#f-orb').innerHTML = [
      ['Apoapsis', o && o.e < 1 ? fmtDist(o.ap) : '—', o && o.ap > P.atmo ? 'ok' : ''], ['Periapsis', o ? fmtDist(o.pe) : '—', o && o.pe > P.atmo ? 'ok' : ''],
      ['Time to Ap', o && o.e < 1 ? fmtTime(o.tAp) : '—', ''], ['Time to Pe', o ? fmtTime(o.tPe) : '—', ''],
      ['Inclination', o ? `${o.inc.toFixed(1)}°` : '—', ''], ['Period', o && o.e < 1 ? fmtTime(o.period) : '—', ''],
    ].map(([l, v, c]) => `<div class="stat ${c}"><b>${v}</b><span>${l}</span></div>`).join('');

    const key = s.stages.map((st) => st.join('|')).join('/') + (s.clamped ? 'c' : '');
    if (key !== this.stageKey) {
      this.stageKey = key;
      $('#f-stages').innerHTML = s.stages.length
        ? s.stages.map((st, i) => `<div class="stage ${i === 0 ? 'first' : ''}"><b>${i}</b><div>${st.map((n) => `<div class="item"><i class="${n.split('#')[1]}"></i><em>${n.split('#')[0]}</em></div>`).join('')}</div></div>`).reverse().join('')
        : '<div class="empty">No stages left</div>';
    }
    $('#f-res').innerHTML = [['Liquid', s.res.liquid, '#f1f2f4'], ['Solid', s.res.solid, '#ffb84d'], ['Mono', s.res.mono, '#6fd3ff']].filter(([, r]) => r[1] > 0)
      .map(([n, r, col]) => `<div class="res"><span>${n}</span><div><i style="width:${(r[0] / r[1]) * 100}%;background:${col}"></i></div><b>${r[0].toFixed(r[1] < 10 ? 2 : 1)} t</b></div>`).join('');
  }

  destroy() { this.root.remove(); }
}
