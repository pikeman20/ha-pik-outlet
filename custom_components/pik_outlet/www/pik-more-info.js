/**
 * PIK Outlet — More-Info Dialog Override v2.0.0
 *
 * Intercepts HA's more-info dialog for PIK outlet entities and injects
 * a rich custom UI with circular 24h clock, profile tabs, socket mode,
 * timer toggle, and energy sensors.
 *
 * Only affects PIK outlet socket switch entities — all other
 * entities keep their default more-info dialog.
 *
 * Loaded automatically by the pik_outlet integration.
 */
(function () {
'use strict';

const VERSION      = '2.0.0';
const DOMAIN       = 'pik_outlet';
const POLL_MS      = 60;
const POLL_TIMEOUT = 3000;
const SOCKETS      = 6;
const PROFILES     = 6;
const SVG_NS       = 'http://www.w3.org/2000/svg';

/* ═══════════════════════════════════════════════════════════════════════════
   Geometry — circular clock (matches pik-schedule-card)
   ═══════════════════════════════════════════════════════════════════════════ */
const CX = 150, CY = 150, R = 120;
const LBL_R = 86, TICK_IN = 99;

function polar(deg, r) {
  r = r || R;
  const rad = (deg - 90) * Math.PI / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}
function min2deg(m) { return (m / 1440) * 360; }
function arcD(startDeg, endDeg) {
  const span = endDeg - startDeg;
  if (span <= 0.1) return '';
  if (span >= 359.5) {
    const mid = startDeg + 179.9;
    const [sx,sy] = polar(startDeg), [mx,my] = polar(mid), [ex,ey] = polar(endDeg);
    return `M${sx} ${sy}A${R} ${R} 0 0 1 ${mx} ${my}A${R} ${R} 0 0 1 ${ex} ${ey}`;
  }
  const [sx,sy] = polar(startDeg), [ex,ey] = polar(endDeg);
  const lg = span > 180 ? 1 : 0;
  return `M${sx} ${sy}A${R} ${R} 0 ${lg} 1 ${ex} ${ey}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */
function pad(n) { return String(n).padStart(2, '0'); }
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function daysStr(bm) {
  if (!bm) return '—';
  if (bm === 127) return 'Every day';
  if (bm === 62)  return 'Mon – Fri';
  if (bm === 126) return 'Mon – Sat';
  if (bm === 65)  return 'Weekends';
  const r = [];
  for (let i = 0; i < 7; i++) if (bm & (1 << i)) r.push(DAY_NAMES[i]);
  return r.join(', ');
}
function getHA() { return document.querySelector('home-assistant'); }
function getHass() { return getHA()?.hass; }

function isPikEntity(entityId) {
  const hass = getHass();
  if (!hass?.entities) return false;
  const entry = hass.entities[entityId];
  return entry && entry.platform === DOMAIN;
}

function isPikSocketSwitch(entityId) {
  if (!entityId.startsWith('switch.')) return false;
  if (!isPikEntity(entityId)) return false;
  const hass = getHass();
  const entry = hass.entities[entityId];
  if (entry?.translation_key && /^socket_\d+$/.test(entry.translation_key)) return true;
  if (/_socket_\d+$/.test(entityId) && !/_timer/.test(entityId)) return true;
  const st = hass.states[entityId];
  if (st?.attributes?.device_class === 'outlet' && isPikEntity(entityId)) return true;
  return false;
}

function getSocketNum(entityId) {
  const hass = getHass();
  const entry = hass?.entities?.[entityId];
  if (entry?.translation_key) {
    const m = entry.translation_key.match(/socket_(\d+)/);
    if (m) return parseInt(m[1]);
  }
  const m2 = entityId.match(/_socket_(\d+)/);
  return m2 ? parseInt(m2[1]) : 1;
}

/**
 * Build a map of sibling entity IDs from the same device.
 * Returns { sockets, timers, sensors, modes }
 */
function buildDeviceMap(entityId) {
  const hass = getHass();
  if (!hass?.entities) return null;
  const entry = hass.entities[entityId];
  if (!entry?.device_id) return null;

  const map = { sockets: {}, timers: {}, sensors: {}, modes: {} };
  const SENSOR_KEYS = ['voltage', 'current', 'power', 'frequency'];

  for (const [eid, ent] of Object.entries(hass.entities)) {
    if (ent.device_id !== entry.device_id || ent.platform !== DOMAIN) continue;
    const tk = ent.translation_key || '';

    // Socket switch: translation_key = "socket_N"
    if (eid.startsWith('switch.') && /^socket_\d+$/.test(tk)) {
      map.sockets[parseInt(tk.replace('socket_', ''))] = eid;
    }
    // Timer enable: translation_key = "socket_N_timer_enable"
    else if (eid.startsWith('switch.') && /^socket_\d+_timer_enable$/.test(tk)) {
      map.timers[parseInt(tk.match(/socket_(\d+)/)[1])] = eid;
    }
    // Mode select: translation_key = "socket_N_mode"
    else if (eid.startsWith('select.') && /^socket_\d+_mode$/.test(tk)) {
      map.modes[parseInt(tk.match(/socket_(\d+)/)[1])] = eid;
    }
    // Sensors
    else if (eid.startsWith('sensor.')) {
      for (const sk of SENSOR_KEYS) {
        if (tk === sk || eid.endsWith('_' + sk)) { map.sensors[sk] = eid; break; }
      }
    }
  }

  // Fallback for sockets/timers if translation_key unavailable
  if (Object.keys(map.sockets).length === 0) {
    for (const [eid, ent] of Object.entries(hass.entities)) {
      if (ent.device_id !== entry.device_id || ent.platform !== DOMAIN) continue;
      if (!eid.startsWith('switch.')) continue;
      const sm = eid.match(/_socket_(\d+)$/);
      if (sm) map.sockets[parseInt(sm[1])] = eid;
      const tm = eid.match(/_socket_(\d+)_timer/);
      if (tm && !map.timers[parseInt(tm[1])]) map.timers[parseInt(tm[1])] = eid;
    }
  }
  // Fallback for modes
  if (Object.keys(map.modes).length === 0) {
    for (const [eid, ent] of Object.entries(hass.entities)) {
      if (ent.device_id !== entry.device_id || ent.platform !== DOMAIN) continue;
      if (!eid.startsWith('select.')) continue;
      const mm = eid.match(/_socket_(\d+)_mode/);
      if (mm) map.modes[parseInt(mm[1])] = eid;
    }
  }

  return map;
}


/* ═══════════════════════════════════════════════════════════════════════════
   CSS — Redesigned with circular clock
   ═══════════════════════════════════════════════════════════════════════════ */
const MI_CSS = `
:host {
  display: block;
  --pik-green: #4CAF50;
  --pik-green-dim: rgba(76,175,80,0.30);
  --pik-red: #EF5350;
  --pik-red-dim: rgba(239,83,80,0.25);
  --pik-blue: var(--primary-color, #42A5F5);
  --pik-blue-dim: rgba(66,165,245,0.20);
  --pik-surface: var(--secondary-background-color, var(--primary-background-color, #252830));
  --pik-txt1: var(--primary-text-color, #e1e3e6);
  --pik-txt2: var(--secondary-text-color, #8b8f96);
  --pik-txt3: var(--disabled-text-color, #555a63);
  --pik-border: var(--divider-color, #2a2e38);
  --pik-track: var(--divider-color, #2a2e38);
}

/* ── Main toggle row ── */
.mi-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 0 12px;
}
.mi-state {
  font-size: 26px; font-weight: 700; color: var(--pik-txt1);
  text-transform: capitalize;
}
.mi-state.on { color: var(--pik-green); }

/* ── Socket chips ── */
.mi-chips { display: flex; gap: 4px; flex-wrap: wrap; padding-bottom: 10px; }
.mi-chip {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 16px;
  font-size: 11px; font-weight: 600; cursor: pointer;
  border: 1.5px solid var(--pik-border); background: transparent;
  color: var(--pik-txt2); transition: all .15s;
}
.mi-chip:hover { background: var(--pik-surface); }
.mi-chip.sel { background: var(--pik-blue); color: #fff; border-color: var(--pik-blue); }
.mi-cdot { width: 6px; height: 6px; border-radius: 50%; }
.mi-cdot.on  { background: var(--pik-green); }
.mi-cdot.off { background: var(--pik-red); opacity: .5; }
.mi-chip.sel .mi-cdot.on  { background: #b9f6ca; }
.mi-chip.sel .mi-cdot.off { background: #ffcdd2; }

/* ── Mode row ── */
.mi-mode-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0 8px;
}
.mi-mode-lbl {
  font-size: 11px; font-weight: 600; color: var(--pik-txt2);
  text-transform: uppercase; letter-spacing: .5px; flex-shrink: 0;
}
.mi-mode-btns { display: flex; gap: 3px; }
.mi-mode-btn {
  padding: 4px 12px; border-radius: 14px; border: 1.5px solid var(--pik-border);
  background: transparent; color: var(--pik-txt2);
  font-size: 11px; font-weight: 600; cursor: pointer; transition: all .15s;
}
.mi-mode-btn:hover { background: var(--pik-surface); }
.mi-mode-btn.sel { background: var(--pik-blue); color: #fff; border-color: var(--pik-blue); }
.mi-mode-btn.sel-off { background: var(--pik-red-dim); color: var(--pik-red); border-color: var(--pik-red); }

/* ── Divider ── */
.mi-div { height: 1px; background: var(--pik-border); margin: 4px 0; }

/* ── Timer enable row (above clock) ── */
.mi-timer-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0 2px;
}
.mi-timer-left {
  display: flex; align-items: center; gap: 6px;
}
.mi-sec-title {
  font-size: 12px; font-weight: 700; color: var(--pik-txt1);
  text-transform: uppercase; letter-spacing: .5px;
}
.mi-badge {
  font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 8px;
  text-transform: none; letter-spacing: 0;
}
.mi-badge.on  { background: var(--pik-green-dim); color: var(--pik-green); }
.mi-badge.off { background: rgba(255,255,255,.06); color: var(--pik-txt3); }
.mi-tog {
  width: 40px; height: 22px; border-radius: 11px; border: none;
  background: var(--pik-border); cursor: pointer; position: relative;
  transition: background .2s; flex-shrink: 0;
}
.mi-tog.on { background: var(--pik-green); }
.mi-tog::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%; background: #fff;
  transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.25);
}
.mi-tog.on::after { transform: translateX(18px); }

/* ── Profile tabs ── */
.mi-prof-row { display: flex; align-items: center; gap: 3px; padding: 4px 0; }
.mi-prof-lbl {
  font-size: 10px; font-weight: 600; color: var(--pik-txt3);
  text-transform: uppercase; letter-spacing: .5px; margin-right: 4px;
}
.mi-prof-btn {
  min-width: 30px; height: 26px; border-radius: 7px;
  border: 1px solid var(--pik-border); background: transparent;
  color: var(--pik-txt2); font-size: 11px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0 5px; transition: all .2s; position: relative;
}
.mi-prof-btn:hover { background: var(--pik-surface); }
.mi-prof-btn.sel { background: var(--pik-blue); color: #fff; border-color: var(--pik-blue); }
.mi-prof-dot {
  position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);
  width: 4px; height: 4px; border-radius: 50%;
}
.mi-prof-dot.on  { background: var(--pik-green); }
.mi-prof-dot.off { background: var(--pik-txt3); }
.mi-prof-btn.sel .mi-prof-dot.on { background: #b9f6ca; }

/* ── Circular clock ── */
.mi-clock-wrap {
  display: flex; justify-content: center; padding: 4px 0;
}
.mi-clock-wrap svg {
  width: 100%; max-width: 260px; height: auto;
}
.mi-inner-disc { fill: var(--pik-surface); }
.mi-inner-dim  { fill: transparent; }
.mi-track-ring {
  fill: none; stroke: var(--pik-track); stroke-width: 26; opacity: .45;
}
.mi-arc {
  fill: none; stroke-width: 26; stroke-linecap: butt;
  transition: d .25s ease, opacity .25s;
}
.mi-arc.green  { stroke: var(--pik-green); opacity: .65; }
.mi-arc.red    { stroke: var(--pik-red); opacity: .3; }
.mi-arc.dim    { stroke: var(--pik-txt3); opacity: .2; }
.mi-arc.empty  { stroke: none; }
.mi-tick { stroke: var(--pik-txt3); opacity: .45; }
.mi-h-lbl {
  fill: var(--pik-txt3); font-size: 11px; font-weight: 500;
  text-anchor: middle; dominant-baseline: central;
}
.mi-h-lbl.major { font-size: 13px; font-weight: 700; fill: var(--pik-txt2); }
.mi-now-hand { stroke: var(--pik-blue); stroke-width: 2; opacity: .8; }
.mi-now-dot { fill: var(--pik-blue); }
.mi-dur-txt {
  fill: var(--pik-txt1); font-size: 22px; font-weight: 700;
  text-anchor: middle; dominant-baseline: central;
}
.mi-dur-sub {
  fill: var(--pik-txt2); font-size: 11px; font-weight: 500;
  text-anchor: middle; dominant-baseline: central;
}
.mi-empty-txt {
  fill: var(--pik-txt3); font-size: 14px; font-style: italic;
  text-anchor: middle; dominant-baseline: central;
}
.mi-on-dot { fill: var(--pik-green); }
.mi-off-dot { fill: var(--pik-red); }

/* ── Schedule info below clock ── */
.mi-sched-info {
  text-align: center; padding: 0 0 6px;
}
.mi-sched-time {
  font-size: 16px; font-weight: 700; color: var(--pik-txt1);
  font-family: 'SF Mono','Menlo','Cascadia Code','Consolas',monospace;
  letter-spacing: .5px;
}
.mi-sched-arrow { color: var(--pik-txt3); margin: 0 6px; font-size: 14px; }
.mi-sched-days {
  font-size: 11px; color: var(--pik-txt2); margin-top: 2px;
}
.mi-sched-empty {
  font-size: 12px; color: var(--pik-txt3); font-style: italic; padding: 4px 0;
}

/* ── Energy row ── */
.mi-energy { display: flex; gap: 5px; flex-wrap: wrap; padding: 4px 0 0; }
.mi-en {
  flex: 1; min-width: 58px; text-align: center;
  padding: 6px 4px; border-radius: 8px; background: var(--pik-surface);
  cursor: pointer; transition: filter .15s;
}
.mi-en:hover { filter: brightness(1.15); }
.mi-en-val { font-size: 15px; font-weight: 700; color: var(--pik-txt1); }
.mi-en-unit { font-size: 10px; color: var(--pik-txt3); margin-left: 1px; }
.mi-en-lbl { font-size: 9px; color: var(--pik-txt2); margin-top: 2px; }

/* ── Edit button ── */
.mi-edit {
  display: block; width: 100%; margin: 10px 0 4px; padding: 8px;
  border-radius: 8px; border: 1.5px solid var(--pik-blue);
  background: transparent; color: var(--pik-blue);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all .15s; text-align: center;
}
.mi-edit:hover { background: rgba(66,165,245,.1); }

/* ── Section header (small) ── */
.mi-sec {
  font-size: 11px; font-weight: 600; color: var(--pik-txt2);
  text-transform: uppercase; letter-spacing: .5px;
  padding: 6px 0 2px;
}
`;


/* ═══════════════════════════════════════════════════════════════════════════
   <pik-outlet-more-info> Custom Element — Redesigned
   ═══════════════════════════════════════════════════════════════════════════ */
class PikOutletMoreInfo extends HTMLElement {

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass     = null;
    this._entityId = '';
    this._socket   = 1;
    this._profile  = 1;
    this._devMap   = null;
    this._built    = false;
  }

  set entityId(v) {
    if (v === this._entityId) return;
    this._entityId = v;
    this._socket = getSocketNum(v);
    this._profile = 1;
    this._devMap = buildDeviceMap(v);
    this._refresh();
  }
  get entityId() { return this._entityId; }

  set hass(v) {
    this._hass = v;
    this._refresh();
  }

  _refresh() {
    if (!this._hass || !this._entityId) return;
    if (!this._built) { this._build(); this._built = true; }
    this._update();
  }

  _$(id) { return this.shadowRoot.getElementById(id); }

  _swId(s)   { return this._devMap?.sockets?.[s || this._socket] || ''; }
  _teId(s)   { return this._devMap?.timers?.[s || this._socket] || ''; }
  _modeId(s) { return this._devMap?.modes?.[s || this._socket] || ''; }
  _senId(k)  { return this._devMap?.sensors?.[k] || ''; }

  /* ══════════════════════════════════════════════════════════════════════
     Build DOM
     ══════════════════════════════════════════════════════════════════════ */
  _build() {
    this.shadowRoot.innerHTML = `<style>${MI_CSS}</style>
<div>
  <!-- Switch state + toggle -->
  <div class="mi-toggle-row">
    <span class="mi-state" id="miState">Off</span>
    <span id="miTog"></span>
  </div>

  <!-- Socket chips -->
  <div class="mi-chips" id="miChips"></div>

  <!-- Socket mode -->
  <div class="mi-mode-row" id="miModeRow">
    <span class="mi-mode-lbl">Mode</span>
    <div class="mi-mode-btns" id="miModeBtns"></div>
  </div>

  <div class="mi-div"></div>

  <!-- Timer enable toggle (above clock) -->
  <div class="mi-timer-row">
    <div class="mi-timer-left">
      <span class="mi-sec-title">Schedule</span>
      <span class="mi-badge" id="miBadge">Off</span>
    </div>
    <button class="mi-tog" id="miTmrTog"></button>
  </div>

  <!-- Profile tabs -->
  <div class="mi-prof-row" id="miProfRow"></div>

  <!-- Circular clock -->
  <div class="mi-clock-wrap">
    <svg id="miClock" viewBox="0 0 300 300">
      <circle class="mi-inner-disc" cx="${CX}" cy="${CY}" r="${R - 14}"/>
      <circle class="mi-inner-dim"  cx="${CX}" cy="${CY}" r="${R + 14}"/>
      <circle class="mi-track-ring" cx="${CX}" cy="${CY}" r="${R}"/>
      <path   class="mi-arc red"    id="miArcR" d=""/>
      <path   class="mi-arc green"  id="miArcG" d=""/>
      <g id="miMarkers"></g>
      <!-- Now indicator -->
      <line id="miNowHand" class="mi-now-hand" x1="${CX}" y1="${CY}" x2="${CX}" y2="${CY - R + 13}"/>
      <circle id="miNowDot" class="mi-now-dot" cx="${CX}" cy="${CY}" r="3"/>
      <!-- ON/OFF dots -->
      <circle id="miOnDot"  class="mi-on-dot"  r="6" cx="0" cy="0" style="display:none"/>
      <circle id="miOffDot" class="mi-off-dot" r="6" cx="0" cy="0" style="display:none"/>
      <!-- Centre text -->
      <text class="mi-dur-txt" id="miDurTxt" x="${CX}" y="${CY - 6}"></text>
      <text class="mi-dur-sub" id="miDurSub" x="${CX}" y="${CY + 14}"></text>
      <text class="mi-empty-txt" id="miEmptyTxt" x="${CX}" y="${CY}" style="display:none">Not configured</text>
    </svg>
  </div>

  <!-- Schedule info text -->
  <div class="mi-sched-info" id="miSchedInfo"></div>

  <div class="mi-div"></div>
  <div class="mi-sec">Energy</div>
  <div class="mi-energy" id="miEnergy"></div>

  <button class="mi-edit" id="miEdit">Edit Schedule</button>
</div>`;

    this._buildChips();
    this._buildToggle();
    this._buildModeButtons();
    this._buildProfileTabs();
    this._buildMarkers();
    this._buildEnergy();
    this._bindEvents();
  }

  _buildChips() {
    const c = this._$('miChips');
    for (let i = 1; i <= SOCKETS; i++) {
      const chip = document.createElement('button');
      chip.className = 'mi-chip'; chip.dataset.idx = i;
      chip.innerHTML = `<span class="mi-cdot"></span>Socket ${i}`;
      chip.addEventListener('click', () => {
        this._socket = i;
        this._profile = 1;
        this._entityId = this._swId(i) || this._entityId;
        this._update();
      });
      c.appendChild(chip);
    }
  }

  _buildToggle() {
    const tog = document.createElement('ha-entity-toggle');
    tog.id = 'miMainTog';
    this._$('miTog').appendChild(tog);
  }

  _buildModeButtons() {
    const c = this._$('miModeBtns');
    ['Off', 'Manual', 'Cloud'].forEach(mode => {
      const btn = document.createElement('button');
      btn.className = 'mi-mode-btn'; btn.textContent = mode;
      btn.dataset.mode = mode;
      btn.addEventListener('click', () => this._setMode(mode));
      c.appendChild(btn);
    });
  }

  _buildProfileTabs() {
    const c = this._$('miProfRow');
    const lbl = document.createElement('span');
    lbl.className = 'mi-prof-lbl'; lbl.textContent = 'Profile';
    c.appendChild(lbl);
    for (let i = 1; i <= PROFILES; i++) {
      const btn = document.createElement('button');
      btn.className = 'mi-prof-btn'; btn.textContent = i; btn.dataset.idx = i;
      btn.addEventListener('click', () => {
        this._profile = i;
        this._update();
      });
      c.appendChild(btn);
    }
  }

  _buildMarkers() {
    const g = this._$('miMarkers');
    for (let h = 0; h < 24; h++) {
      const a = (h / 24) * 360;
      const rad = (a - 90) * Math.PI / 180;
      const isLbl = h % 3 === 0;
      const isMaj = h % 6 === 0;
      // Tick
      const len = isLbl ? 9 : 4;
      const r1  = isLbl ? TICK_IN - 2 : TICK_IN + 1;
      const ln = document.createElementNS(SVG_NS, 'line');
      ln.setAttribute('x1', CX + r1 * Math.cos(rad));
      ln.setAttribute('y1', CY + r1 * Math.sin(rad));
      ln.setAttribute('x2', CX + (r1 + len) * Math.cos(rad));
      ln.setAttribute('y2', CY + (r1 + len) * Math.sin(rad));
      ln.setAttribute('class', 'mi-tick');
      ln.style.strokeWidth = isLbl ? '1.5' : '0.7';
      g.appendChild(ln);
      // Label every 3h
      if (isLbl) {
        const [lx, ly] = polar(a, LBL_R);
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', lx); t.setAttribute('y', ly);
        t.setAttribute('class', isMaj ? 'mi-h-lbl major' : 'mi-h-lbl');
        t.textContent = String(h);
        g.appendChild(t);
      }
    }
  }

  _buildEnergy() {
    const row = this._$('miEnergy');
    [
      { key: 'voltage',   lbl: 'Voltage',   unit: 'V'  },
      { key: 'current',   lbl: 'Current',   unit: 'A'  },
      { key: 'power',     lbl: 'Power',     unit: 'W'  },
      { key: 'frequency', lbl: 'Frequency', unit: 'Hz' },
    ].forEach(s => {
      const el = document.createElement('div');
      el.className = 'mi-en';
      el.innerHTML = `<div><span class="mi-en-val" id="mie_${s.key}">—</span>`
        + `<span class="mi-en-unit">${s.unit}</span></div>`
        + `<div class="mi-en-lbl">${s.lbl}</div>`;
      el.addEventListener('click', () => {
        const senEid = this._senId(s.key);
        if (!senEid) return;
        const ha = getHA();
        if (ha) ha.dispatchEvent(new CustomEvent('hass-more-info', {
          bubbles: true, composed: true, detail: { entityId: senEid },
        }));
      });
      row.appendChild(el);
    });
  }

  _bindEvents() {
    this._$('miTmrTog').addEventListener('click', () => this._toggleTimer());
    this._$('miEdit').addEventListener('click', () => {
      const ha = getHA();
      if (ha) {
        const dlg = ha.shadowRoot?.querySelector('ha-more-info-dialog');
        if (dlg) {
          try { dlg.closeDialog?.(); } catch(e) {}
          try { dlg.close?.(); } catch(e) {}
        }
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     Update UI — mutate existing DOM (no re-render)
     ══════════════════════════════════════════════════════════════════════ */
  _update() {
    if (!this._hass || !this._built) return;

    const swEid = this._swId();
    const teEid = this._teId();
    const modeEid = this._modeId();
    const swSt = swEid ? this._hass.states[swEid] : null;
    const teSt = teEid ? this._hass.states[teEid] : null;
    const modeSt = modeEid ? this._hass.states[modeEid] : null;
    const isOn = swSt && swSt.state === 'on';

    // State label
    const stEl = this._$('miState');
    stEl.textContent = swSt ? (isOn ? 'On' : 'Off') : 'Unavailable';
    stEl.className = 'mi-state' + (isOn ? ' on' : '');

    // Main toggle
    const tog = this._$('miMainTog');
    if (tog && swSt) { tog.hass = this._hass; tog.stateObj = swSt; }

    // Socket chips
    this._$('miChips').querySelectorAll('.mi-chip').forEach(c => {
      const idx = +c.dataset.idx;
      c.classList.toggle('sel', idx === this._socket);
      const dot = c.querySelector('.mi-cdot');
      const st = this._hass.states[this._swId(idx)];
      dot.className = 'mi-cdot ' + (st && st.state === 'on' ? 'on' : 'off');
    });

    // Mode buttons
    const curMode = modeSt ? modeSt.state : '';
    this._$('miModeBtns').querySelectorAll('.mi-mode-btn').forEach(b => {
      const m = b.dataset.mode;
      const isSel = curMode.toLowerCase() === m.toLowerCase();
      b.classList.remove('sel', 'sel-off');
      if (isSel) b.classList.add(m === 'Off' ? 'sel-off' : 'sel');
    });
    // Hide mode row if no mode entity
    this._$('miModeRow').style.display = modeEid ? '' : 'none';

    // Timer badge + toggle
    const tmrOn = teSt && teSt.state === 'on';
    const badge = this._$('miBadge');
    badge.textContent = tmrOn ? 'Active' : 'Off';
    badge.className = 'mi-badge ' + (tmrOn ? 'on' : 'off');
    this._$('miTmrTog').classList.toggle('on', !!tmrOn);

    // Profile tabs with dots
    const profiles = (teSt?.attributes?.profiles) || [];
    this._$('miProfRow').querySelectorAll('.mi-prof-btn').forEach(b => {
      const idx = +b.dataset.idx;
      b.classList.toggle('sel', idx === this._profile);
      // Dot indicator
      let dot = b.querySelector('.mi-prof-dot');
      const p = profiles[idx - 1];
      const configured = p && (p.days > 0 || p.hour_on > 0 || p.hour_off > 0
                              || p.minute_on > 0 || p.minute_off > 0);
      if (configured) {
        if (!dot) { dot = document.createElement('span'); b.appendChild(dot); }
        dot.className = 'mi-prof-dot ' + (p.enabled ? 'on' : 'off');
      } else if (dot) { dot.remove(); }
    });

    // Circular clock
    this._updateClock(profiles);

    // Energy sensors
    ['voltage', 'current', 'power', 'frequency'].forEach(k => {
      const el = this._$('mie_' + k);
      if (!el) return;
      const st = this._hass.states[this._senId(k)];
      el.textContent = (st && st.state !== 'unknown' && st.state !== 'unavailable')
        ? st.state : '—';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     Circular clock update
     ══════════════════════════════════════════════════════════════════════ */
  _updateClock(profiles) {
    const p = profiles[this._profile - 1];
    const configured = p && (p.days > 0 || p.hour_on > 0 || p.hour_off > 0
                            || p.minute_on > 0 || p.minute_off > 0);

    const arcG = this._$('miArcG');
    const arcR = this._$('miArcR');
    const durTxt = this._$('miDurTxt');
    const durSub = this._$('miDurSub');
    const emptyTxt = this._$('miEmptyTxt');
    const onDot = this._$('miOnDot');
    const offDot = this._$('miOffDot');
    const infoDiv = this._$('miSchedInfo');

    if (!configured) {
      // Empty profile — show empty state
      arcG.setAttribute('d', '');
      arcR.setAttribute('d', '');
      arcG.className.baseVal = 'mi-arc empty';
      arcR.className.baseVal = 'mi-arc empty';
      durTxt.style.display = 'none';
      durSub.style.display = 'none';
      emptyTxt.style.display = '';
      onDot.style.display = 'none';
      offDot.style.display = 'none';
      infoDiv.innerHTML = `<div class="mi-sched-empty">Profile ${this._profile} is not configured</div>`;
    } else {
      emptyTxt.style.display = 'none';
      durTxt.style.display = '';
      durSub.style.display = '';

      const onMin  = (p.hour_on || 0) * 60 + (p.minute_on || 0);
      const offMin = (p.hour_off || 0) * 60 + (p.minute_off || 0);
      const oa = min2deg(onMin);
      const fa = min2deg(offMin);

      const arcClass = p.enabled ? '' : ' dim';

      // Green arc = ON period
      if (offMin > onMin) {
        arcG.setAttribute('d', arcD(oa, fa));
        arcG.className.baseVal = 'mi-arc green' + arcClass;
      } else {
        arcG.setAttribute('d', '');
        arcG.className.baseVal = 'mi-arc empty';
      }

      // Red arcs = OFF period (before ON, after OFF)
      const redParts = [];
      if (onMin > 0)     redParts.push(arcD(0, oa));
      if (offMin < 1440) redParts.push(arcD(fa, 359.9));
      if (redParts.length && p.enabled) {
        arcR.setAttribute('d', redParts.join(' '));
        arcR.className.baseVal = 'mi-arc red';
      } else {
        arcR.setAttribute('d', redParts.join(' '));
        arcR.className.baseVal = 'mi-arc' + (redParts.length ? ' dim' : ' empty');
      }

      // ON/OFF dots on the ring
      const [onX, onY] = polar(oa);
      const [offX, offY] = polar(fa);
      onDot.setAttribute('cx', onX); onDot.setAttribute('cy', onY);
      offDot.setAttribute('cx', offX); offDot.setAttribute('cy', offY);
      onDot.style.display = '';
      offDot.style.display = '';

      // Duration text
      const dm = offMin > onMin ? offMin - onMin : 0;
      if (dm > 0) {
        const dh = Math.floor(dm / 60), dmin = dm % 60;
        durTxt.textContent = dh + 'h' + (dmin ? ' ' + dmin + 'm' : '');
        durSub.textContent = p.enabled ? 'ON duration' : 'Disabled';
      } else {
        durTxt.textContent = '--';
        durSub.textContent = '';
      }

      // Info text below clock
      infoDiv.innerHTML =
        `<div class="mi-sched-time">`
        + `${pad(p.hour_on)}:${pad(p.minute_on)}`
        + `<span class="mi-sched-arrow">\u2192</span>`
        + `${pad(p.hour_off)}:${pad(p.minute_off)}`
        + `</div>`
        + `<div class="mi-sched-days">${daysStr(p.days)}</div>`;
    }

    // Now indicator
    this._updateNowHand();
  }

  _updateNowHand() {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowDeg = min2deg(nowMin);
    const rad = (nowDeg - 90) * Math.PI / 180;
    const handLen = R - 13;
    const hand = this._$('miNowHand');
    hand.setAttribute('x2', CX + handLen * Math.cos(rad));
    hand.setAttribute('y2', CY + handLen * Math.sin(rad));
  }

  /* ══════════════════════════════════════════════════════════════════════
     Actions
     ══════════════════════════════════════════════════════════════════════ */
  async _toggleTimer() {
    const teId = this._teId();
    const st = this._hass?.states[teId];
    if (!st) return;
    try {
      await this._hass.callService('switch', st.state === 'on' ? 'turn_off' : 'turn_on',
        { entity_id: teId });
    } catch (e) { console.error('PIK more-info: timer toggle failed', e); }
  }

  async _setMode(mode) {
    const modeEid = this._modeId();
    if (!modeEid) return;
    try {
      await this._hass.callService('select', 'select_option', {
        entity_id: modeEid, option: mode,
      });
    } catch (e) { console.error('PIK more-info: set mode failed', e); }
  }
}

customElements.define('pik-outlet-more-info', PikOutletMoreInfo);


/* ═══════════════════════════════════════════════════════════════════════════
   More-Info Dialog Interceptor
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Wait for the dialog DOM to be ready, then inject our custom content.
 */
function waitAndReplace(entityId) {
  const ha = getHA();
  if (!ha?.shadowRoot) return;

  const start = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - start > POLL_TIMEOUT) { clearInterval(timer); return; }

    const dialog = ha.shadowRoot.querySelector('ha-more-info-dialog');
    if (!dialog?.shadowRoot) return;

    // Find the content area — HA 2024+ uses tabbed more-info
    const moreInfoInfo = dialog.shadowRoot.querySelector('ha-more-info-info');
    const haDialog = dialog.shadowRoot.querySelector('ha-dialog');
    if (!haDialog && !moreInfoInfo) return;

    // Check dialog is open
    const isOpen = haDialog?.open || haDialog?.hasAttribute('open')
                || dialog.hasAttribute('opened') || dialog.open;
    if (!isOpen && !moreInfoInfo) return;

    clearInterval(timer);

    // Check if we already injected for this entity
    const existing = dialog.shadowRoot.querySelector('pik-outlet-more-info');
    if (existing && existing.entityId === entityId) {
      existing.hass = getHass();
      return;
    }

    // Create our element
    const pikEl = document.createElement('pik-outlet-more-info');
    pikEl.hass = getHass();
    pikEl.entityId = entityId;

    // Hide default more-info content
    if (moreInfoInfo) moreInfoInfo.style.display = 'none';

    // Also hide ha-more-info-history-and-logbook if present
    const history = dialog.shadowRoot.querySelector('ha-more-info-history-and-logbook');
    if (history) history.style.display = 'none';

    // Remove any previous PIK element
    if (existing) existing.remove();

    // Insert our element
    const insertParent = moreInfoInfo?.parentNode || haDialog?.querySelector('.content') || dialog.shadowRoot;
    if (insertParent === dialog.shadowRoot) {
      dialog.shadowRoot.appendChild(pikEl);
    } else {
      if (moreInfoInfo) {
        moreInfoInfo.parentNode.insertBefore(pikEl, moreInfoInfo);
      } else {
        insertParent.appendChild(pikEl);
      }
    }

    // Subscribe to hass updates so our element stays current
    _trackHassUpdates(dialog, pikEl, entityId);

  }, POLL_MS);
}

/**
 * Keep pushing hass updates to our element while the dialog is open.
 */
function _trackHassUpdates(dialog, pikEl, entityId) {
  const interval = setInterval(() => {
    // Check if dialog is still in DOM and open
    if (!dialog.isConnected || !pikEl.isConnected) {
      clearInterval(interval);
      return;
    }
    const hass = getHass();
    if (hass) pikEl.hass = hass;
  }, 1000);

  // Also observe dialog closing → remove our element and restore defaults
  const obs = new MutationObserver(() => {
    const haDialog = dialog.shadowRoot?.querySelector('ha-dialog');
    const isOpen = haDialog?.open || haDialog?.hasAttribute('open')
                || dialog.hasAttribute('opened');
    if (!isOpen) {
      clearInterval(interval);
      obs.disconnect();

      // Clean up — restore defaults for next non-PIK entity
      const existing = dialog.shadowRoot?.querySelector('pik-outlet-more-info');
      if (existing) existing.remove();
      const moreInfoInfo = dialog.shadowRoot?.querySelector('ha-more-info-info');
      if (moreInfoInfo) moreInfoInfo.style.display = '';
      const history = dialog.shadowRoot?.querySelector('ha-more-info-history-and-logbook');
      if (history) history.style.display = '';
    }
  });
  if (dialog.shadowRoot) {
    obs.observe(dialog.shadowRoot, { childList: true, subtree: true, attributes: true });
  }
}

/**
 * Restore default dialog content when opening a NON-PIK entity.
 */
function restoreDefaults() {
  const ha = getHA();
  if (!ha?.shadowRoot) return;
  const dialog = ha.shadowRoot.querySelector('ha-more-info-dialog');
  if (!dialog?.shadowRoot) return;

  const existing = dialog.shadowRoot.querySelector('pik-outlet-more-info');
  if (existing) existing.remove();

  const moreInfoInfo = dialog.shadowRoot.querySelector('ha-more-info-info');
  if (moreInfoInfo) moreInfoInfo.style.display = '';
  const history = dialog.shadowRoot.querySelector('ha-more-info-history-and-logbook');
  if (history) history.style.display = '';
}


/* ── Main event hooks ──────────────────────────────────────────────────── */

// Listen in CAPTURE phase on document to see the event early
document.addEventListener('hass-more-info', (ev) => {
  const entityId = ev.detail?.entityId;
  if (!entityId) return;

  if (isPikSocketSwitch(entityId)) {
    // PIK socket switch → intercept after HA opens the dialog
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        waitAndReplace(entityId);
      });
    });
  } else {
    // Non-PIK → make sure we clean up any leftover custom content
    requestAnimationFrame(() => restoreDefaults());
  }
}, true);

// Fallback: observe dialog singleton for entity changes (handles edge cases)
function setupObserver() {
  const ha = getHA();
  if (!ha?.shadowRoot) {
    setTimeout(setupObserver, 500);
    return;
  }

  const check = () => {
    const dialog = ha.shadowRoot.querySelector('ha-more-info-dialog');
    if (!dialog) return;

    // HA reuses the dialog — watch its entityId property
    let lastEntityId = '';
    const poll = setInterval(() => {
      if (!dialog.isConnected) { clearInterval(poll); return; }

      const eid = dialog.entityId
               || dialog._params?.entityId
               || dialog.getAttribute('entity-id')
               || '';

      if (eid && eid !== lastEntityId) {
        lastEntityId = eid;
        if (isPikSocketSwitch(eid)) {
          waitAndReplace(eid);
        } else {
          restoreDefaults();
        }
      }
    }, 200);
  };

  // MutationObserver for when dialog element appears
  const obs = new MutationObserver(check);
  obs.observe(ha.shadowRoot, { childList: true });
  check(); // initial check
}

if (document.readyState === 'complete') {
  setupObserver();
} else {
  window.addEventListener('load', () => setTimeout(setupObserver, 1000));
}


/* ── Log ── */
console.info(
  '%c PIK-MORE-INFO %c v' + VERSION + ' ',
  'background:#FF9800;color:#fff;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px;',
  'background:#1c1f27;color:#FF9800;font-weight:700;padding:2px 6px;border-radius:0 4px 4px 0;',
);
})();
