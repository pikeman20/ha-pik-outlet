/**
 * PIK Outlet — More-Info Dialog Override v2.1.0
 *
 * Intercepts HA's more-info dialog for PIK outlet entities and injects
 * a rich custom UI with circular 24h clock, draggable ON/OFF handles,
 * time inputs, day-of-week selector, profile tabs, socket mode,
 * apply button, and energy sensors.
 *
 * Cloned interactive schedule UI from pik-schedule-card for consistency.
 *
 * Only affects PIK outlet socket switch entities — all other
 * entities keep their default more-info dialog.
 *
 * Loaded automatically by the pik_outlet integration.
 */
(function () {
'use strict';

const VERSION      = '2.2.1';
const DOMAIN       = 'pik_outlet';
const POLL_MS      = 60;
const POLL_TIMEOUT = 3000;
const SOCKETS      = 6;
const PROFILES     = 6;
const SNAP         = 5;
const SVG_NS       = 'http://www.w3.org/2000/svg';

/* ═══════════════════════════════════════════════════════════════════════════
   Geometry — circular clock (matches pik-schedule-card)
   ═══════════════════════════════════════════════════════════════════════════ */
const CX = 150, CY = 150, R = 120;
const LBL_R = 86, TICK_IN = 99;

// Day config: display Mon→Sun, firmware uses bit0=Sun … bit6=Sat
const DAYS = [
  {l:'Mon',b:1},{l:'Tue',b:2},{l:'Wed',b:3},
  {l:'Thu',b:4},{l:'Fri',b:5},{l:'Sat',b:6},{l:'Sun',b:0},
];

function polar(deg, r) {
  r = r || R;
  const rad = (deg - 90) * Math.PI / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}
function min2deg(m) { return (m / 1440) * 360; }
function deg2min(a) {
  a = ((a % 360) + 360) % 360;
  let m = Math.round(a / 360 * 1440);
  m = Math.round(m / SNAP) * SNAP;
  return m >= 1440 ? 0 : m;
}
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
 * Returns { sockets, timers, sensors, modes, deviceId, prefix }
 */
function buildDeviceMap(entityId) {
  const hass = getHass();
  if (!hass?.entities) return null;
  const entry = hass.entities[entityId];
  if (!entry?.device_id) return null;

  const map = { sockets: {}, timers: {}, sensors: {}, modes: {},
                deviceId: entry.device_id, prefix: '' };
  const SENSOR_KEYS = ['voltage', 'current', 'power', 'frequency'];

  // Derive prefix from entity_id
  const pm = entityId.match(/^switch\.(.+?)_socket_\d+/);
  map.prefix = pm ? pm[1] : 'pik_outlet';

  for (const [eid, ent] of Object.entries(hass.entities)) {
    if (ent.device_id !== entry.device_id || ent.platform !== DOMAIN) continue;
    const tk = ent.translation_key || '';

    if (eid.startsWith('switch.') && /^socket_\d+$/.test(tk)) {
      map.sockets[parseInt(tk.replace('socket_', ''))] = eid;
    }
    else if (eid.startsWith('switch.') && /^socket_\d+_timer_enable$/.test(tk)) {
      map.timers[parseInt(tk.match(/socket_(\d+)/)[1])] = eid;
    }
    else if (eid.startsWith('select.') && /^socket_\d+_mode$/.test(tk)) {
      map.modes[parseInt(tk.match(/socket_(\d+)/)[1])] = eid;
    }
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
   CSS — Merged more-info + schedule-card interactive styles
   ═══════════════════════════════════════════════════════════════════════════ */
const MI_CSS = `
:host {
  display: block;
  --pik-green: #4CAF50;
  --pik-green-dim: rgba(76,175,80,0.35);
  --pik-red: #EF5350;
  --pik-red-dim: rgba(239,83,80,0.35);
  --pik-blue: var(--primary-color, #42A5F5);
  --pik-blue-dim: rgba(66,165,245,0.25);
  --pik-surface: var(--secondary-background-color, var(--primary-background-color, #252830));
  --pik-txt1: var(--primary-text-color, #e1e3e6);
  --pik-txt2: var(--secondary-text-color, #8b8f96);
  --pik-txt3: var(--disabled-text-color, #555a63);
  --pik-border: var(--divider-color, #2a2e38);
  --pik-track: var(--divider-color, #2a2e38);
}
.mi-wrap { display: flex; flex-direction: column; gap: 14px; padding: 8px 4px; }

/* ── Main toggle row ── */
.mi-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 0 8px;
}
.mi-state {
  font-size: 26px; font-weight: 700; color: var(--pik-txt1);
  text-transform: capitalize;
}
.mi-state.on { color: var(--pik-green); }

/* ── Socket label ── */
.mi-socket-lbl {
  font-size: 12px; font-weight: 600; color: var(--pik-txt2);
  display: flex; align-items: center; gap: 6px;
}
.mi-socket-lbl .mi-sdot { width: 8px; height: 8px; border-radius: 50%; }
.mi-socket-lbl .mi-sdot.on  { background: var(--pik-green); }
.mi-socket-lbl .mi-sdot.off { background: var(--pik-red); opacity: .6; }

/* ── Mode row ── */
.mi-mode-row {
  display: flex; align-items: center; gap: 8px;
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
.mi-div { height: 1px; background: var(--pik-border); margin: 6px 0; }

/* ── Tab rows (profile) ── */
.tab-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.tab-label {
  font-size: 11px; font-weight: 600; color: var(--pik-txt2);
  text-transform: uppercase; letter-spacing: .6px; margin-right: 6px;
  flex-shrink: 0;
}
.tab-btn {
  min-width: 32px; height: 28px; border-radius: 8px;
  border: 1px solid var(--pik-border); background: transparent;
  color: var(--pik-txt2); font-size: 12px; font-weight: 500;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0 6px; transition: all .2s; position: relative;
}
.tab-btn:hover { background: var(--pik-surface); }
.tab-btn.sel { background: var(--pik-blue); color: #fff; border-color: var(--pik-blue); }
.tab-btn .dot {
  position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);
  width: 4px; height: 4px; border-radius: 50%;
}
.tab-btn .dot.on  { background: var(--pik-green); }
.tab-btn .dot.off { background: var(--pik-txt3); }
.tab-btn.sel .dot.on  { background: #fff; }
.tab-btn.sel .dot.off { background: rgba(255,255,255,.5); }

/* ── Profile row with toggle ── */
.prof-row { display: flex; align-items: center; justify-content: space-between; }
.toggle {
  width: 44px; height: 24px; border-radius: 12px; border: none;
  background: var(--pik-track); cursor: pointer; position: relative;
  transition: background .25s; flex-shrink: 0;
}
.toggle.on { background: var(--pik-blue); }
.toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; border-radius: 50%; background: #fff;
  transition: transform .25s;
}
.toggle.on::after { transform: translateX(20px); }

/* ── Timer enable row ── */
.timer-row {
  display: flex; align-items: center; justify-content: space-between;
}
.timer-lbl {
  font-size: 12px; font-weight: 600; color: var(--pik-txt2);
  text-transform: uppercase; letter-spacing: .5px;
}

/* ── Clock SVG ── */
.clock-wrap { display: flex; justify-content: center; }
.clock {
  width: 100%; max-width: 280px; aspect-ratio: 1;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.inner-disc { fill: var(--ha-card-background, var(--card-background-color, #1c1f27)); }
.inner-dim  { fill: rgba(0,0,0,.06); }
.track-ring { fill: none; stroke: var(--pik-track); stroke-width: 26; }
.arc { fill: none; stroke-width: 26; stroke-linecap: butt; transition: opacity .15s; }
.arc.green { stroke: var(--pik-green); opacity: .40; }
.arc.blue  { stroke: var(--pik-blue);  opacity: .25; }
.arc.red   { stroke: var(--pik-red);   opacity: .40; }
.arc.glow.green { opacity: .58; }
.arc.glow.blue  { opacity: .38; }
.arc.glow.red   { opacity: .58; }
.tick { stroke: var(--pik-txt3); }
.h-lbl {
  fill: var(--pik-txt2); font-size: 11px; font-weight: 500;
  text-anchor: middle; dominant-baseline: central; pointer-events: none;
}
.h-lbl.major { fill: var(--pik-txt1); font-size: 13px; font-weight: 600; }
.hit { fill: transparent; cursor: grab; pointer-events: all; }
.handle {
  stroke: #fff; stroke-width: 2.5; cursor: grab; transition: r .15s;
}
.handle:active { cursor: grabbing; }
.handle.on  {
  fill: var(--pik-green);
  filter: drop-shadow(0 0 4px rgba(76,175,80,.6));
}
.handle.off {
  fill: var(--pik-red);
  filter: drop-shadow(0 0 4px rgba(239,83,80,.6));
}
.handle.big { r: 15; }
.dur-txt {
  fill: var(--pik-txt1); font-size: 22px; font-weight: 700;
  text-anchor: middle; pointer-events: none;
}
.dur-sub {
  fill: var(--pik-txt2); font-size: 11px; text-anchor: middle;
  pointer-events: none;
}

/* ── Time inputs ── */
.time-row { display: flex; justify-content: center; gap: 14px; }
.t-grp {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 10px; border-radius: 10px;
  background: var(--pik-surface); border: 1.5px solid transparent;
}
.t-grp.on-grp  { border-color: var(--pik-green-dim); }
.t-grp.off-grp { border-color: var(--pik-red-dim); }
.t-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.t-dot.green { background: var(--pik-green); }
.t-dot.red   { background: var(--pik-red); }
.t-in {
  width: 34px; height: 34px;
  border: 1px solid var(--pik-border); border-radius: 7px;
  background: var(--ha-card-background, var(--card-background-color, #1a1d24));
  color: var(--pik-txt1);
  font-size: 16px; font-weight: 600; text-align: center; outline: none;
  font-family: 'SF Mono','Menlo','Cascadia Code','Consolas',monospace;
  -moz-appearance: textfield;
}
.t-in::-webkit-outer-spin-button,
.t-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.t-in:focus {
  border-color: var(--pik-blue);
  box-shadow: 0 0 0 2px var(--pik-blue-dim);
}
.sep { font-size: 18px; font-weight: 700; color: var(--pik-txt3); margin: 0 1px; }

/* ── Day selector ── */
.days { display: flex; justify-content: center; gap: 5px; }
.d-btn {
  width: 38px; height: 36px; border-radius: 9px;
  border: 1px solid var(--pik-border); background: transparent;
  color: var(--pik-txt2); font-size: 10px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  text-transform: uppercase; letter-spacing: .4px; transition: all .2s;
}
.d-btn:hover { background: var(--pik-surface); }
.d-btn.sel {
  background: var(--pik-blue); color: #fff; border-color: var(--pik-blue);
  box-shadow: 0 2px 6px var(--pik-blue-dim);
}

/* ── Apply button ── */
.apply {
  width: 100%; height: 42px; border-radius: 10px; border: none;
  background: var(--pik-blue); color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all .2s; letter-spacing: .3px;
}
.apply:hover { filter: brightness(1.1); box-shadow: 0 4px 12px var(--pik-blue-dim); }
.apply:active { transform: scale(.98); }
.apply:disabled { opacity: .6; cursor: not-allowed; filter: none; }
.apply.ok  { background: var(--pik-green); }
.apply.err { background: var(--pik-red); }

.note {
  text-align: center; font-size: 10px; color: var(--pik-txt3);
  line-height: 1.5; margin-top: -4px;
}

/* ── Energy row ── */
.mi-energy { display: flex; gap: 5px; flex-wrap: wrap; }
.mi-en {
  flex: 1; min-width: 58px; text-align: center;
  padding: 6px 4px; border-radius: 8px; background: var(--pik-surface);
  cursor: pointer; transition: filter .15s;
}
.mi-en:hover { filter: brightness(1.15); }
.mi-en-val { font-size: 15px; font-weight: 700; color: var(--pik-txt1); }
.mi-en-unit { font-size: 10px; color: var(--pik-txt3); margin-left: 1px; }
.mi-en-lbl { font-size: 9px; color: var(--pik-txt2); margin-top: 2px; }

/* ── Section header ── */
.mi-sec {
  font-size: 11px; font-weight: 600; color: var(--pik-txt2);
  text-transform: uppercase; letter-spacing: .5px;
  padding: 2px 0;
}
`;


/* ═══════════════════════════════════════════════════════════════════════════
   <pik-outlet-more-info> Custom Element — Interactive Schedule UI
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

    // Schedule state (from pik-schedule-card)
    this._onMin    = 0;
    this._offMin   = 1440;
    this._days     = 0b0111110;
    this._enabled  = true;
    this._dirty    = false;
    this._drag     = null;
    this._applying = false;

    // Bound handlers for window-level drag listeners
    this._bMove = null;
    this._bUp   = null;
  }

  set entityId(v) {
    if (v === this._entityId) return;
    this._entityId = v;
    this._socket = getSocketNum(v);
    this._profile = 1;
    this._dirty = false;
    this._devMap = buildDeviceMap(v);
    this._loadState();
    this._refresh();
  }
  get entityId() { return this._entityId; }

  set hass(v) {
    const prev = this._hass;
    this._hass = v;
    // Reload state from entities when user hasn't made local edits
    if (!this._dirty && !this._applying && prev) {
      const teId = this._teId();
      if (teId && (!prev.states[teId] || prev.states[teId] !== v.states[teId])) {
        this._loadState();
      }
    }
    this._refresh();
  }

  _refresh() {
    if (!this._hass || !this._entityId) return;
    if (!this._built) { this._build(); this._built = true; }
    this._updateUI();
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
<div class="mi-wrap">
  <!-- Switch state + toggle -->
  <div class="mi-toggle-row">
    <span class="mi-state" id="miState">Off</span>
    <span id="miTog"></span>
  </div>

  <!-- Socket label -->
  <div class="mi-socket-lbl" id="miSocketLbl"></div>

  <!-- Socket mode -->
  <div class="mi-mode-row" id="miModeRow">
    <span class="mi-mode-lbl">Mode</span>
    <div class="mi-mode-btns" id="miModeBtns"></div>
  </div>

  <div class="mi-div"></div>

  <!-- Profile row with enable toggle (like schedule card) -->
  <div class="prof-row">
    <div class="tab-row" id="prTabs"></div>
    <button class="toggle" id="toggle"></button>
  </div>

  <!-- Socket timer enable toggle -->
  <div class="timer-row" id="timerRow">
    <span class="timer-lbl">Socket Timer</span>
    <button class="toggle" id="timerTog"></button>
  </div>

  <!-- Circular clock with draggable handles -->
  <div class="clock-wrap">
    <svg class="clock" id="clock" viewBox="0 0 300 300">
      <circle class="inner-disc" cx="${CX}" cy="${CY}" r="94"/>
      <circle class="inner-dim"  cx="${CX}" cy="${CY}" r="94"/>
      <circle class="track-ring" cx="${CX}" cy="${CY}" r="${R}"/>
      <path id="arcR" class="arc red"/>
      <path id="arcG" class="arc green"/>
      <g id="markers"></g>
      <circle id="hitOff" class="hit" r="24"/>
      <circle id="hOff"   class="handle off" r="12"/>
      <circle id="hitOn"  class="hit" r="24"/>
      <circle id="hOn"    class="handle on"  r="12"/>
      <text id="durTxt" class="dur-txt" x="${CX}" y="145"></text>
      <text class="dur-sub" x="${CX}" y="165">ON duration</text>
    </svg>
  </div>

  <!-- Time inputs -->
  <div class="time-row">
    <div class="t-grp on-grp">
      <div class="t-dot green"></div>
      <input class="t-in" id="iOH" maxlength="2" inputmode="numeric">
      <span class="sep">:</span>
      <input class="t-in" id="iOM" maxlength="2" inputmode="numeric">
    </div>
    <div class="t-grp off-grp">
      <div class="t-dot red"></div>
      <input class="t-in" id="iFH" maxlength="2" inputmode="numeric">
      <span class="sep">:</span>
      <input class="t-in" id="iFM" maxlength="2" inputmode="numeric">
    </div>
  </div>

  <!-- Day selector -->
  <div class="days" id="days"></div>

  <!-- Apply button -->
  <button class="apply" id="applyBtn">Apply Schedule</button>
  <div class="note">Drag handles on the clock · type in the boxes · 5-min snap</div>

  <div class="mi-div"></div>

  <!-- Energy -->
  <div class="mi-sec">Energy (Total)</div>
  <div class="mi-energy" id="miEnergy"></div>
</div>`;

    this._buildSocketLabel();
    this._buildToggle();
    this._buildModeButtons();
    this._buildProfileTabs();
    this._buildDays();
    this._buildMarkers();
    this._buildEnergy();
    this._bindEvents();
  }

  _buildSocketLabel() {
    const c = this._$('miSocketLbl');
    c.innerHTML = `<span class="mi-sdot"></span>Socket ${this._socket}`;
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
    const c = this._$('prTabs');
    const lbl = document.createElement('span');
    lbl.className = 'tab-label'; lbl.textContent = 'Profile';
    c.appendChild(lbl);
    for (let i = 1; i <= PROFILES; i++) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn'; btn.textContent = i; btn.dataset.idx = i;
      btn.addEventListener('click', () => this._selectProfile(i));
      c.appendChild(btn);
    }
  }

  _buildDays() {
    const c = this._$('days');
    DAYS.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'd-btn'; btn.textContent = d.l; btn.dataset.bit = d.b;
      btn.addEventListener('click', () => {
        this._days ^= (1 << d.b);
        this._dirty = true;
        this._updateUI();
      });
      c.appendChild(btn);
    });
  }

  _buildMarkers() {
    const g = this._$('markers');
    for (let h = 0; h < 24; h++) {
      const a = (h / 24) * 360;
      const rad = (a - 90) * Math.PI / 180;
      const isLbl = h % 3 === 0;
      const isMaj = h % 6 === 0;

      const len = isLbl ? 9 : 4;
      const r1  = isLbl ? TICK_IN - 2 : TICK_IN + 1;
      const ln = document.createElementNS(SVG_NS, 'line');
      ln.setAttribute('x1', CX + r1 * Math.cos(rad));
      ln.setAttribute('y1', CY + r1 * Math.sin(rad));
      ln.setAttribute('x2', CX + (r1 + len) * Math.cos(rad));
      ln.setAttribute('y2', CY + (r1 + len) * Math.sin(rad));
      ln.setAttribute('class', 'tick');
      ln.style.strokeWidth = isLbl ? '1.5' : '0.7';
      g.appendChild(ln);

      if (isLbl) {
        const [lx, ly] = polar(a, LBL_R);
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', lx); t.setAttribute('y', ly);
        t.setAttribute('class', isMaj ? 'h-lbl major' : 'h-lbl');
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

  /* ══════════════════════════════════════════════════════════════════════
     Event binding
     ══════════════════════════════════════════════════════════════════════ */
  _bindEvents() {
    // Enable toggle (profile enable)
    this._$('toggle').addEventListener('click', () => {
      this._enabled = !this._enabled;
      this._dirty = true;
      this._updateUI();
    });

    // Socket timer toggle
    this._$('timerTog').addEventListener('click', () => this._toggleSocketTimer());

    // Drag handles (pointer events → works for mouse + touch)
    ['hitOn','hOn'].forEach(id => {
      this._$(id).addEventListener('pointerdown', e => this._startDrag('on', e));
    });
    ['hitOff','hOff'].forEach(id => {
      this._$(id).addEventListener('pointerdown', e => this._startDrag('off', e));
    });

    // Time inputs
    ['iOH','iOM','iFH','iFM'].forEach(id => {
      const el = this._$(id);
      el.addEventListener('change', () => this._syncInputs());
      el.addEventListener('blur',   () => this._syncInputs());
      el.addEventListener('focus',  () => el.select());
      el.addEventListener('keydown', e => this._inputKey(id, e));
    });

    // Apply
    this._$('applyBtn').addEventListener('click', () => this._apply());
  }

  /* ══════════════════════════════════════════════════════════════════════
     State loading — read from entity attributes
     ══════════════════════════════════════════════════════════════════════ */
  _loadState() {
    if (!this._hass) return;
    const teId = this._teId();
    const teState = teId ? this._hass.states[teId] : null;

    if (teState?.attributes?.profiles) {
      const p = teState.attributes.profiles[this._profile - 1];
      if (p) {
        this._onMin   = (p.hour_on || 0) * 60 + (p.minute_on || 0);
        this._offMin  = (p.hour_off || 0) * 60 + (p.minute_off || 0);
        this._days    = p.days || 0;
        this._enabled = !!p.enabled;
      }
    } else if (this._profile === 1) {
      this._loadFromTimeEntities();
    }

    // Defaults for unconfigured profiles (all-zero)
    if (this._onMin === 0 && this._offMin === 0) {
      this._offMin = 1440;
      if (this._days === 0) this._days = 0b0111110;
    }
    // Safety: offMin must be > onMin (allow 1440 = 24:00 for always-on)
    if (this._offMin <= this._onMin) {
      this._offMin = Math.min(this._onMin + SNAP, 1440);
    }
  }

  _loadFromTimeEntities() {
    const s = this._socket;
    const pfx = this._devMap?.prefix || 'pik_outlet';

    const parse = (entityId) => {
      const st = this._hass.states[entityId];
      if (st && st.state && st.state !== 'unknown' && st.state !== 'unavailable') {
        const [h, m] = st.state.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
      }
      return null;
    };

    const onV  = parse(`time.${pfx}_socket_${s}_schedule_on`);
    const offV = parse(`time.${pfx}_socket_${s}_schedule_off`);
    if (onV  !== null) this._onMin = onV;
    if (offV !== null) this._offMin = offV;

    const dSt = this._hass.states[`select.${pfx}_socket_${s}_schedule_days`];
    if (dSt?.attributes && typeof dSt.attributes.days_bitmask === 'number') {
      this._days = dSt.attributes.days_bitmask;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     UI update — mutate existing DOM nodes (no re-render)
     ══════════════════════════════════════════════════════════════════════ */
  _updateUI() {
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

    // Socket label
    const lblDot = this._$('miSocketLbl')?.querySelector('.mi-sdot');
    if (lblDot) {
      lblDot.className = 'mi-sdot ' + (isOn ? 'on' : 'off');
    }

    // Mode buttons
    const curMode = modeSt ? modeSt.state : '';
    this._$('miModeBtns').querySelectorAll('.mi-mode-btn').forEach(b => {
      const m = b.dataset.mode;
      const isSel = curMode.toLowerCase() === m.toLowerCase();
      b.classList.remove('sel', 'sel-off');
      if (isSel) b.classList.add(m === 'Off' ? 'sel-off' : 'sel');
    });
    this._$('miModeRow').style.display = modeEid ? '' : 'none';

    // ── Profile tabs (with dot indicators) ──
    this._$('prTabs').querySelectorAll('.tab-btn').forEach(b => {
      const idx = +b.dataset.idx;
      b.classList.toggle('sel', idx === this._profile);

      let dot = b.querySelector('.dot');
      const profs = teSt?.attributes?.profiles;
      if (profs && profs[idx - 1]) {
        const p = profs[idx - 1];
        const configured = p.days > 0 || p.hour_on > 0 || p.hour_off > 0;
        if (configured) {
          if (!dot) { dot = document.createElement('span'); b.appendChild(dot); }
          dot.className = 'dot ' + (p.enabled ? 'on' : 'off');
        } else if (dot) { dot.remove(); }
      } else if (dot) { dot.remove(); }
    });

    // ── Enable toggle ──
    this._$('toggle').classList.toggle('on', this._enabled);

    // ── Socket timer toggle ──
    const socketTimerOn = teSt && teSt.state === 'on';
    this._$('timerTog').classList.toggle('on', !!socketTimerOn);
    this._$('timerRow').style.display = teEid ? '' : 'none';

    // ── SVG arcs ──
    const oa = min2deg(this._onMin);
    const fa = min2deg(this._offMin);
    const faClamp = Math.min(fa, 359.9);
    this._$('arcG').setAttribute('d', this._offMin > this._onMin ? arcD(oa, faClamp) : '');
    const redParts = [];
    if (this._onMin > 0)     redParts.push(arcD(0, oa));
    if (this._offMin < 1440) redParts.push(arcD(faClamp, 359.9));
    this._$('arcR').setAttribute('d', redParts.join(' '));

    const dragging = !!this._drag;
    ['arcG','arcR'].forEach(id => this._$(id).classList.toggle('glow', dragging));

    // ── Handle positions ──
    const [onX, onY]   = polar(oa);
    const [offX, offY] = polar(fa);
    ['hOn','hitOn'].forEach(id => {
      this._$(id).setAttribute('cx', onX);
      this._$(id).setAttribute('cy', onY);
    });
    ['hOff','hitOff'].forEach(id => {
      this._$(id).setAttribute('cx', offX);
      this._$(id).setAttribute('cy', offY);
    });
    this._$('hOn').classList.toggle('big', this._drag === 'on');
    this._$('hOff').classList.toggle('big', this._drag === 'off');

    // ── Centre duration text ──
    const dm = this._offMin - this._onMin;
    if (dm > 0) {
      const dh = Math.floor(dm / 60), dmin = dm % 60;
      this._$('durTxt').textContent = dh + 'h' + (dmin ? ' ' + dmin + 'm' : '');
    } else {
      this._$('durTxt').textContent = '--';
    }

    // ── Time inputs (skip if focused to avoid overwriting user typing) ──
    const active = this.shadowRoot.activeElement;
    if (active !== this._$('iOH')) this._$('iOH').value = pad(Math.floor(this._onMin / 60));
    if (active !== this._$('iOM')) this._$('iOM').value = pad(this._onMin % 60);
    if (active !== this._$('iFH')) this._$('iFH').value = pad(Math.floor(this._offMin / 60));
    if (active !== this._$('iFM')) this._$('iFM').value = pad(this._offMin % 60);

    // ── Day buttons ──
    this._$('days').querySelectorAll('.d-btn').forEach(b => {
      b.classList.toggle('sel', !!(this._days & (1 << +b.dataset.bit)));
    });

    // ── Apply button ──
    if (!this._applying) {
      const btn = this._$('applyBtn');
      btn.disabled = false;
      btn.className = 'apply';
      btn.textContent = this._dirty ? 'Apply Schedule  \u25CF' : 'Apply Schedule';
    }

    // ── Energy sensors ──
    ['voltage', 'current', 'power', 'frequency'].forEach(k => {
      const el = this._$('mie_' + k);
      if (!el) return;
      const st = this._hass.states[this._senId(k)];
      el.textContent = (st && st.state !== 'unknown' && st.state !== 'unavailable')
        ? st.state : '—';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     Drag interaction (from pik-schedule-card)
     ══════════════════════════════════════════════════════════════════════ */
  _startDrag(which, e) {
    e.preventDefault();
    this._drag = which;
    this._dirty = true;

    this._bMove = ev => this._onMove(ev);
    this._bUp   = ()  => this._onUp();
    window.addEventListener('pointermove', this._bMove);
    window.addEventListener('pointerup',   this._bUp);
    this._updateUI();
  }

  _onMove(e) {
    if (!this._drag) return;
    e.preventDefault();
    let m = deg2min(this._getAngle(e));
    if (this._drag === 'on') {
      this._onMin = Math.max(0, Math.min(m, (this._offMin === 1440 ? 1435 : this._offMin) - SNAP));
    } else {
      // 0° (midnight) means 24:00 for the OFF handle
      if (m === 0) m = 1440;
      this._offMin = Math.max(this._onMin + SNAP, Math.min(m, 1440));
    }
    this._updateUI();
  }

  _onUp() {
    this._drag = null;
    window.removeEventListener('pointermove', this._bMove);
    window.removeEventListener('pointerup',   this._bUp);
    this._updateUI();
  }

  _getAngle(e) {
    const svg = this._$('clock');
    const rect = svg.getBoundingClientRect();
    const sx = 300 / rect.width, sy = 300 / rect.height;
    const dx = (e.clientX - rect.left) * sx - CX;
    const dy = (e.clientY - rect.top) * sy - CY;
    let a = Math.atan2(dx, -dy) * 180 / Math.PI;
    return a < 0 ? a + 360 : a;
  }

  /* ══════════════════════════════════════════════════════════════════════
     Input handling (from pik-schedule-card)
     ══════════════════════════════════════════════════════════════════════ */
  _syncInputs() {
    let oh = parseInt(this._$('iOH').value) || 0;
    let om = parseInt(this._$('iOM').value) || 0;
    let fh = parseInt(this._$('iFH').value) || 0;
    let fm = parseInt(this._$('iFM').value) || 0;

    oh = Math.max(0, Math.min(23, oh));
    om = Math.max(0, Math.min(59, om));
    fh = Math.max(0, Math.min(24, fh));
    if (fh === 24) fm = 0; else fm = Math.max(0, Math.min(59, fm));

    let newOn  = oh * 60 + om;
    let newOff = fh * 60 + fm;
    if (newOff <= newOn) newOff = Math.min(newOn + SNAP, 1440);

    this._onMin  = newOn;
    this._offMin = newOff;
    this._dirty  = true;
    this._updateUI();
  }

  _inputKey(id, e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const el   = this._$(id);
    let val    = parseInt(el.value) || 0;
    const isH  = id === 'iOH' || id === 'iFH';
    const isOffH = id === 'iFH';
    const max  = isH ? (isOffH ? 24 : 23) : 59;
    const step = isH ? 1  : 5;
    val = e.key === 'ArrowUp'
      ? Math.min(max, val + step)
      : Math.max(0,   val - step);
    el.value = pad(val);
    this._syncInputs();
  }

  /* ══════════════════════════════════════════════════════════════════════
     Tab switching
     ══════════════════════════════════════════════════════════════════════ */
  _selectSocket(s) {
    if (s === this._socket) return;
    this._socket  = s;
    this._profile = 1;
    this._dirty   = false;
    this._entityId = this._swId(s) || this._entityId;
    this._devMap = buildDeviceMap(this._entityId);
    this._loadState();
    this._updateUI();
  }

  _selectProfile(p) {
    if (p === this._profile) return;
    this._profile = p;
    this._dirty   = false;
    this._loadState();
    this._updateUI();
  }

  /* ══════════════════════════════════════════════════════════════════════
     Apply — send to device via HA service (from pik-schedule-card)
     ══════════════════════════════════════════════════════════════════════ */
  async _apply() {
    if (this._applying || !this._hass) return;
    const deviceId = this._devMap?.deviceId;
    if (!deviceId) {
      this._flashBtn('No device ID!', 'err');
      return;
    }

    const btn = this._$('applyBtn');
    this._applying = true;
    btn.disabled = true;
    btn.textContent = 'Applying\u2026';

    try {
      // 1. Set the timer profile on the device
      await this._hass.callService(DOMAIN, 'set_timer_profile', {
        device_id:  deviceId,
        socket:     this._socket,
        profile:    this._profile,
        days:       this._days,
        hour_on:    Math.floor(this._onMin / 60),
        minute_on:  this._onMin % 60,
        hour_off:   Math.floor(this._offMin / 60),
        minute_off: this._offMin % 60,
        enabled:    this._enabled,
      });

      // 2. Auto-enable the socket timer if the profile is enabled
      if (this._enabled) {
        const teId = this._teId();
        const teState = this._hass.states[teId];
        if (teState && teState.state !== 'on') {
          await this._hass.callService('switch', 'turn_on', {
            entity_id: teId,
          });
        }
      }

      this._dirty = false;
      this._flashBtn('Applied  \u2713', 'ok');
    } catch (err) {
      console.error('PIK more-info: apply failed', err);
      this._flashBtn('Error!', 'err');
    }
  }

  _flashBtn(text, cls) {
    const btn = this._$('applyBtn');
    btn.textContent = text;
    btn.className = 'apply ' + cls;
    setTimeout(() => {
      this._applying = false;
      this._updateUI();
    }, cls === 'err' ? 3000 : 2000);
  }

  /* ══════════════════════════════════════════════════════════════════════
     Actions
     ══════════════════════════════════════════════════════════════════════ */
  async _toggleSocketTimer() {
    if (!this._hass) return;
    const teId = this._teId();
    if (!teId) return;
    const teSt = this._hass.states[teId];
    const isOn = teSt && teSt.state === 'on';
    try {
      await this._hass.callService('switch', isOn ? 'turn_off' : 'turn_on', {
        entity_id: teId,
      });
    } catch (err) {
      console.error('PIK more-info: toggle timer failed', err);
    }
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

if (!customElements.get('pik-outlet-more-info')) {
  customElements.define('pik-outlet-more-info', PikOutletMoreInfo);
}


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

    const moreInfoInfo = dialog.shadowRoot.querySelector('ha-more-info-info');
    const haDialog = dialog.shadowRoot.querySelector('ha-dialog');
    if (!haDialog && !moreInfoInfo) return;

    const isOpen = haDialog?.open || haDialog?.hasAttribute('open')
                || dialog.hasAttribute('opened') || dialog.open;
    if (!isOpen && !moreInfoInfo) return;

    clearInterval(timer);

    const existing = dialog.shadowRoot.querySelector('pik-outlet-more-info');
    if (existing && existing.entityId === entityId) {
      existing.hass = getHass();
      return;
    }

    const pikEl = document.createElement('pik-outlet-more-info');
    pikEl.hass = getHass();
    pikEl.entityId = entityId;

    if (moreInfoInfo) moreInfoInfo.style.display = 'none';

    const history = dialog.shadowRoot.querySelector('ha-more-info-history-and-logbook');
    if (history) history.style.display = 'none';

    if (existing) existing.remove();

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

    _trackHassUpdates(dialog, pikEl, entityId);

  }, POLL_MS);
}

function _trackHassUpdates(dialog, pikEl, entityId) {
  const interval = setInterval(() => {
    if (!dialog.isConnected) {
      clearInterval(interval);
      return;
    }
    // Re-inject if our element was removed by a LitElement re-render
    if (!pikEl.isConnected && dialog.isConnected) {
      const eid = dialog.entityId
               || dialog._params?.entityId
               || dialog.getAttribute('entity-id') || '';
      if (eid && isPikSocketSwitch(eid)) {
        waitAndReplace(eid);
      }
      clearInterval(interval);
      return;
    }
    const hass = getHass();
    if (hass) pikEl.hass = hass;
  }, 1000);

  // Debounced close-detection: MutationObserver fires during re-renders
  // where open state can be transiently falsy. Wait 300ms and re-check.
  let closeTimer = 0;
  const obs = new MutationObserver(() => {
    const haDialog = dialog.shadowRoot?.querySelector('ha-dialog');
    const isOpen = haDialog?.open || haDialog?.hasAttribute('open')
                || dialog.hasAttribute('opened');
    if (!isOpen) {
      if (!closeTimer) {
        closeTimer = setTimeout(() => {
          // Re-check after debounce — if still not open, truly closed
          const haD2 = dialog.shadowRoot?.querySelector('ha-dialog');
          const stillOpen = haD2?.open || haD2?.hasAttribute('open')
                         || dialog.hasAttribute('opened');
          if (!stillOpen) {
            clearInterval(interval);
            obs.disconnect();

            const existing = dialog.shadowRoot?.querySelector('pik-outlet-more-info');
            if (existing) existing.remove();
            const moreInfoInfo = dialog.shadowRoot?.querySelector('ha-more-info-info');
            if (moreInfoInfo) moreInfoInfo.style.display = '';
            const history = dialog.shadowRoot?.querySelector('ha-more-info-history-and-logbook');
            if (history) history.style.display = '';
          }
          closeTimer = 0;
        }, 300);
      }
    } else {
      // Dialog is (still) open — cancel any pending close
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
    }
  });
  if (dialog.shadowRoot) {
    obs.observe(dialog.shadowRoot, { childList: true, subtree: true, attributes: true });
  }
}

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

document.addEventListener('hass-more-info', (ev) => {
  const entityId = ev.detail?.entityId;
  if (!entityId) return;

  if (isPikSocketSwitch(entityId)) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        waitAndReplace(entityId);
      });
    });
  } else {
    requestAnimationFrame(() => restoreDefaults());
  }
}, true);

function setupObserver() {
  const ha = getHA();
  if (!ha?.shadowRoot) {
    setTimeout(setupObserver, 500);
    return;
  }

  const obs = new MutationObserver(() => {
    const dialog = ha.shadowRoot.querySelector('ha-more-info-dialog');
    if (!dialog?.shadowRoot) return;

    const eid = dialog.entityId
             || dialog._params?.entityId
             || dialog.getAttribute('entity-id')
             || '';
    if (!eid) return;

    if (isPikSocketSwitch(eid)) {
      const existing = dialog.shadowRoot.querySelector('pik-outlet-more-info');
      if (!existing || existing.entityId !== eid) {
        waitAndReplace(eid);
      }
    } else {
      restoreDefaults();
    }
  });

  obs.observe(ha.shadowRoot, { childList: true, subtree: true });
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
