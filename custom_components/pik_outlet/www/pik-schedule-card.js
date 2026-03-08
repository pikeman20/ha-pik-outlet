/**
 * PIK Schedule Card v1.0.0
 * Custom Lovelace card for PIK BLE 6-Switch Outlet timer scheduling.
 *
 * Provides a circular 24-hour clock UI with draggable ON/OFF handles,
 * day-of-week selector, 6 socket tabs, and 6 profile slots per socket.
 *
 * Configuration:
 *   type: custom:pik-schedule-card
 *   entity: switch.pik_outlet_socket_1_timer_enable
 */
(function () {
'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════ */
const VERSION   = '1.0.0';
const SOCKETS   = 6;
const PROFILES  = 6;
const SNAP      = 5;                       // minute-snap while dragging
const CX = 150, CY = 150, R = 120;        // SVG viewBox centre & track radius
const SVG_NS    = 'http://www.w3.org/2000/svg';
const LBL_R     = 86;                     // hour-label radius
const TICK_IN   = 99;                     // tick inner radius
const DOMAIN    = 'pik_outlet';

// Day config: display Mon→Sun, firmware uses bit0=Sun … bit6=Sat
const DAYS = [
  {l:'Mon',b:1},{l:'Tue',b:2},{l:'Wed',b:3},
  {l:'Thu',b:4},{l:'Fri',b:5},{l:'Sat',b:6},{l:'Sun',b:0},
];

/* ═══════════════════════════════════════════════════════════════════════════
   Geometry helpers
   ═══════════════════════════════════════════════════════════════════════════ */
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
function pad(n) { return String(n).padStart(2, '0'); }

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
   CSS — uses HA theme variables with dark-mode fallbacks
   ═══════════════════════════════════════════════════════════════════════════ */
const CSS = `
:host {
  --pik-green: #4CAF50;
  --pik-green-dim: rgba(76,175,80,0.35);
  --pik-red: #EF5350;
  --pik-red-dim: rgba(239,83,80,0.35);
  --pik-blue: var(--primary-color, #42A5F5);
  --pik-blue-dim: rgba(66,165,245,0.25);
  --pik-surface: var(--primary-background-color, #252830);
  --pik-txt1: var(--primary-text-color, #e1e3e6);
  --pik-txt2: var(--secondary-text-color, #8b8f96);
  --pik-txt3: var(--disabled-text-color, #555a63);
  --pik-border: var(--divider-color, #2a2e38);
  --pik-track: var(--divider-color, #2a2e38);
}
ha-card { padding: 16px; overflow: hidden; }
.cc { display: flex; flex-direction: column; gap: 12px; }

/* ── Tab rows ── */
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

/* ── Profile row ── */
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

/* ── Warning banner ── */
.warn {
  display: none; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 10px;
  background: rgba(255,152,0,.1); color: #FFA726;
  font-size: 12px; font-weight: 500;
}
.warn.show { display: flex; }
.warn svg { width: 16px; height: 16px; fill: currentColor; flex-shrink: 0; }
.warn span { flex: 1; }
.warn-btn {
  padding: 3px 10px; border-radius: 6px; border: 1px solid currentColor;
  background: transparent; color: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.warn-btn:hover { background: rgba(255,152,0,.15); }

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
`;

/* ═══════════════════════════════════════════════════════════════════════════
   HTML Template
   ═══════════════════════════════════════════════════════════════════════════ */
const HTML = `
<ha-card>
<div class="cc">
  <div class="tab-row" id="sckTabs"></div>

  <div class="prof-row">
    <div class="tab-row" id="prTabs"></div>
    <button class="toggle" id="toggle"></button>
  </div>

  <div class="warn" id="warn">
    <svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
    <span>Socket timer is disabled</span>
    <button class="warn-btn" id="warnBtn">Enable</button>
  </div>

  <div class="clock-wrap">
    <svg class="clock" id="clock" viewBox="0 0 300 300">
      <circle class="inner-disc" cx="150" cy="150" r="94"/>
      <circle class="inner-dim"  cx="150" cy="150" r="94"/>
      <circle class="track-ring" cx="150" cy="150" r="120"/>
      <path id="arcR" class="arc red"/>
      <path id="arcG" class="arc green"/>
      <g id="markers"></g>
      <circle id="hitOff" class="hit" r="24"/>
      <circle id="hOff"   class="handle off" r="12"/>
      <circle id="hitOn"  class="hit" r="24"/>
      <circle id="hOn"    class="handle on"  r="12"/>
      <text id="durTxt" class="dur-txt" x="150" y="145"></text>
      <text class="dur-sub" x="150" y="165">ON duration</text>
    </svg>
  </div>

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

  <div class="days" id="days"></div>

  <button class="apply" id="applyBtn">Apply Schedule</button>
  <div class="note">Drag handles on the clock · type in the boxes · 5-min snap</div>
</div>
</ha-card>`;

/* ═══════════════════════════════════════════════════════════════════════════
   PikScheduleCard
   ═══════════════════════════════════════════════════════════════════════════ */
class PikScheduleCard extends HTMLElement {

  /* ── Construction ─────────────────────────────────────────────────────── */
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass     = null;
    this._config   = {};
    this._prefix   = '';
    this._deviceId = '';

    // Schedule state
    this._socket   = 1;
    this._profile  = 1;
    this._onMin    = 7 * 60;        // 07:00
    this._offMin   = 22 * 60;       // 22:00
    this._days     = 0b0111110;     // Mon–Fri
    this._enabled  = true;

    this._dirty    = false;
    this._drag     = null;          // 'on' | 'off' | null
    this._applying = false;
    this._built    = false;

    // Bound handlers for window-level drag listeners
    this._bMove = null;
    this._bUp   = null;
  }

  /* ── Config ───────────────────────────────────────────────────────────── */
  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity (timer_enable switch)');
    }
    this._config = { ...config };

    // Derive prefix from entity_id  e.g. switch.pik_outlet_socket_1_timer_enable
    const m = config.entity.match(/^switch\.(.+?)_socket_\d+/);
    this._prefix = m ? m[1] : 'pik_outlet';

    // Default socket from entity_id
    const sm = config.entity.match(/_socket_(\d+)/);
    if (sm) this._socket = parseInt(sm[1]);
  }

  /* ── Hass setter (called by HA on every state change) ─────────────────  */
  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;

    // Resolve device_id once
    if (!this._deviceId) {
      if (hass.entities) {
        const reg = hass.entities[this._config.entity];
        if (reg && reg.device_id) this._deviceId = reg.device_id;
      }
      // Fallback: scan devices for our domain
      if (!this._deviceId && hass.devices) {
        for (const [id, dev] of Object.entries(hass.devices)) {
          if (dev.identifiers && dev.identifiers.some(i => i[0] === DOMAIN)) {
            this._deviceId = id;
            break;
          }
        }
      }
    }

    if (!this._built) {
      this._build();
      this._built = true;
    }

    // Only reload state from entities when user hasn't made local edits
    if (!this._dirty && !this._applying) {
      // Check if relevant entity actually changed (fast reference check)
      const teId = this._teId();
      if (!prev || prev.states[teId] !== hass.states[teId]) {
        this._loadState();
      }
    }

    this._updateUI();
  }

  /* ── DOM shorthand ────────────────────────────────────────────────────── */
  _$(id) { return this.shadowRoot.getElementById(id); }

  _teId(s) {
    return `switch.${this._prefix}_socket_${s || this._socket}_timer_enable`;
  }

  /* ── Build static DOM ─────────────────────────────────────────────────── */
  _build() {
    this.shadowRoot.innerHTML = `<style>${CSS}</style>${HTML}`;
    this._buildSocketTabs();
    this._buildProfileTabs();
    this._buildDays();
    this._buildMarkers();
    this._bindEvents();
  }

  _buildSocketTabs() {
    const c = this._$('sckTabs');
    const lbl = document.createElement('span');
    lbl.className = 'tab-label'; lbl.textContent = 'Socket';
    c.appendChild(lbl);
    for (let i = 1; i <= SOCKETS; i++) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn'; btn.textContent = i; btn.dataset.idx = i;
      btn.addEventListener('click', () => this._selectSocket(i));
      c.appendChild(btn);
    }
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

      // Tick mark
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

      // Hour label (every 3 h)
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

  /* ── Event binding ────────────────────────────────────────────────────── */
  _bindEvents() {
    // Enable toggle
    this._$('toggle').addEventListener('click', () => {
      this._enabled = !this._enabled;
      this._dirty = true;
      this._updateUI();
    });

    // Warning → enable socket timer
    this._$('warnBtn').addEventListener('click', () => this._enableSocketTimer());

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

  /* ═══════════════════════════════════════════════════════════════════════
     State loading — read from entity attributes
     ═══════════════════════════════════════════════════════════════════════ */
  _loadState() {
    if (!this._hass) return;

    const teState = this._hass.states[this._teId()];

    // Primary: structured profiles from timer_enable switch attributes
    if (teState && teState.attributes && teState.attributes.profiles) {
      const p = teState.attributes.profiles[this._profile - 1];
      if (p) {
        this._onMin   = (p.hour_on || 0) * 60 + (p.minute_on || 0);
        this._offMin  = (p.hour_off || 0) * 60 + (p.minute_off || 0);
        this._days    = p.days || 0;
        this._enabled = !!p.enabled;
      }
    } else if (this._profile === 1) {
      // Fallback: individual time / select entities (profile 1 only)
      this._loadFromTimeEntities();
    }

    // Defaults for unconfigured profiles (all-zero)
    if (this._onMin === 0 && this._offMin === 0) {
      this._onMin = 7 * 60;
      this._offMin = 22 * 60;
      if (this._days === 0) this._days = 0b0111110;
    }
    // Safety: offMin must be > onMin
    if (this._offMin <= this._onMin) {
      this._offMin = Math.min(this._onMin + SNAP, 1435);
    }
  }

  _loadFromTimeEntities() {
    const s = this._socket;
    const pfx = this._prefix;

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
    if (dSt && dSt.attributes && typeof dSt.attributes.days_bitmask === 'number') {
      this._days = dSt.attributes.days_bitmask;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     UI update — mutate existing DOM nodes (no re-render)
     ═══════════════════════════════════════════════════════════════════════ */
  _updateUI() {
    if (!this._built) return;

    // ── Socket tabs ──
    this._$('sckTabs').querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('sel', +b.dataset.idx === this._socket);
    });

    // ── Profile tabs (with dot indicators) ──
    this._$('prTabs').querySelectorAll('.tab-btn').forEach(b => {
      const idx = +b.dataset.idx;
      b.classList.toggle('sel', idx === this._profile);

      // Dot showing whether profile is configured / enabled
      let dot = b.querySelector('.dot');
      const teState = this._hass && this._hass.states[this._teId()];
      const profs = teState && teState.attributes && teState.attributes.profiles;
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

    // ── Warning (socket timer disabled) ──
    const teState = this._hass && this._hass.states[this._teId()];
    const socketOn = teState && teState.state === 'on';
    this._$('warn').classList.toggle('show', teState != null && !socketOn);

    // ── SVG arcs ──
    const oa = min2deg(this._onMin);
    const fa = min2deg(this._offMin);
    // Green = ON→OFF (device on), Red = OFF→ON (device off, wraps via midnight)
    this._$('arcG').setAttribute('d', this._offMin > this._onMin ? arcD(oa, fa) : '');
    const redParts = [];
    if (this._onMin > 0)     redParts.push(arcD(0, oa));
    if (this._offMin < 1440) redParts.push(arcD(fa, 359.9));
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
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Drag interaction
     ═══════════════════════════════════════════════════════════════════════ */
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
    const m = deg2min(this._getAngle(e));
    if (this._drag === 'on') {
      this._onMin = Math.max(0, Math.min(m, this._offMin - SNAP));
    } else {
      this._offMin = Math.max(this._onMin + SNAP, Math.min(m, 1440 - SNAP));
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

  /* ═══════════════════════════════════════════════════════════════════════
     Input handling
     ═══════════════════════════════════════════════════════════════════════ */
  _syncInputs() {
    let oh = parseInt(this._$('iOH').value) || 0;
    let om = parseInt(this._$('iOM').value) || 0;
    let fh = parseInt(this._$('iFH').value) || 0;
    let fm = parseInt(this._$('iFM').value) || 0;

    oh = Math.max(0, Math.min(23, oh));
    om = Math.max(0, Math.min(59, om));
    fh = Math.max(0, Math.min(23, fh));
    fm = Math.max(0, Math.min(59, fm));

    let newOn  = oh * 60 + om;
    let newOff = fh * 60 + fm;
    if (newOff <= newOn) newOff = Math.min(newOn + SNAP, 1439);

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
    const max  = isH ? 23 : 59;
    const step = isH ? 1  : 5;
    val = e.key === 'ArrowUp'
      ? Math.min(max, val + step)
      : Math.max(0,   val - step);
    el.value = pad(val);
    this._syncInputs();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Tab switching
     ═══════════════════════════════════════════════════════════════════════ */
  _selectSocket(s) {
    if (s === this._socket) return;
    this._socket  = s;
    this._dirty   = false;
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

  /* ═══════════════════════════════════════════════════════════════════════
     Apply — send to device via HA service
     ═══════════════════════════════════════════════════════════════════════ */
  async _apply() {
    if (this._applying || !this._hass) return;
    if (!this._deviceId) {
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
        device_id: this._deviceId,
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
        const teState = this._hass.states[this._teId()];
        if (teState && teState.state !== 'on') {
          await this._hass.callService('switch', 'turn_on', {
            entity_id: this._teId(),
          });
        }
      }

      this._dirty = false;
      this._flashBtn('Applied  \u2713', 'ok');
    } catch (err) {
      console.error('PIK Schedule Card: apply failed', err);
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

  /* ── Enable socket timer (from warning banner) ─────────────────────── */
  async _enableSocketTimer() {
    if (!this._hass) return;
    try {
      await this._hass.callService('switch', 'turn_on', {
        entity_id: this._teId(),
      });
    } catch (err) {
      console.error('PIK Schedule Card: enable timer failed', err);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Card metadata
     ═══════════════════════════════════════════════════════════════════════ */
  getCardSize() { return 7; }

  static getConfigElement() {
    return document.createElement('pik-schedule-card-editor');
  }

  static getStubConfig() {
    return { entity: '' };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Editor
   ═══════════════════════════════════════════════════════════════════════════ */
class PikScheduleCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._built = false;
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._built) this._updatePicker();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
  }

  _build() {
    this._built = true;
    this.innerHTML = `
      <div style="padding: 8px 0;">
        <ha-entity-picker allow-custom-entity></ha-entity-picker>
        <p style="margin-top:8px;font-size:12px;color:var(--secondary-text-color);">
          Pick any <b>timer_enable</b> switch entity from the PIK Outlet device.
        </p>
      </div>`;

    const picker = this.querySelector('ha-entity-picker');
    if (!picker) return;
    picker.hass  = this._hass;
    picker.value = this._config.entity || '';
    picker.label = 'Timer Enable Entity';

    picker.addEventListener('value-changed', (ev) => {
      const val = ev.detail.value;
      if (val !== this._config.entity) {
        this._config = { ...this._config, entity: val };
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: this._config },
        }));
      }
    });
  }

  _updatePicker() {
    const picker = this.querySelector('ha-entity-picker');
    if (picker) picker.value = this._config.entity || '';
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Registration
   ═══════════════════════════════════════════════════════════════════════════ */
customElements.define('pik-schedule-card', PikScheduleCard);
customElements.define('pik-schedule-card-editor', PikScheduleCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'pik-schedule-card',
  name: 'PIK Schedule Card',
  description: 'Circular timer schedule for PIK BLE 6-Switch Outlet',
  preview: false,
  documentationURL: 'https://github.com/pik-electronics/ha-pik-outlet',
});

console.info(
  '%c PIK-SCHEDULE-CARD %c v' + VERSION + ' ',
  'background:#42A5F5;color:#fff;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px;',
  'background:#1c1f27;color:#42A5F5;font-weight:700;padding:2px 6px;border-radius:0 4px 4px 0;',
);
})();
