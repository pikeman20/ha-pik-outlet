/**
 * PIK Outlet Card v1.0.0
 * Enhanced more-info style Lovelace card for PIK BLE 6-Switch Outlet.
 *
 * Inspired by thomasloven/lovelace-more-info-card — provides a rich
 * dashboard card combining switch control, 24h schedule timeline,
 * profile summary, and energy sensor readings in a single view.
 *
 * Configuration:
 *   type: custom:pik-outlet-card
 *   entity: switch.pik_outlet_socket_1
 */
(function () {
'use strict';

const VERSION   = '1.0.0';
const DOMAIN    = 'pik_outlet';
const SOCKETS   = 6;
const PROFILES  = 6;

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */
function pad(n) { return String(n).padStart(2, '0'); }

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function daysStr(bm) {
  if (!bm) return '—';
  if (bm === 127) return 'Every day';
  if (bm === 62)  return 'Mon–Fri';
  if (bm === 126) return 'Mon–Sat';
  if (bm === 65)  return 'Weekends';
  const r = [];
  for (let i = 0; i < 7; i++) if (bm & (1 << i)) r.push(DAY_NAMES[i]);
  return r.join(', ');
}

function fireEvent(node, type, detail) {
  node.dispatchEvent(new CustomEvent(type, {
    bubbles: true, composed: true, detail: detail || {},
  }));
}

/* ── Timeline constants ────────────────────────────────────────────────── */
const SVG_NS   = 'http://www.w3.org/2000/svg';
const TL_X     = 28;            // left offset for P-labels
const TL_W     = 340;           // bar area width
const TL_BAR_H = 8;             // height per profile bar
const TL_GAP   = 2;             // gap between bars
const TL_H     = PROFILES * (TL_BAR_H + TL_GAP);  // total bar area

function minToX(m) { return TL_X + (m / 1440) * TL_W; }

/* ═══════════════════════════════════════════════════════════════════════════
   CSS — uses HA theme variables with dark-mode fallbacks
   ═══════════════════════════════════════════════════════════════════════════ */
const CSS = `
:host {
  --pik-green: #4CAF50;
  --pik-green-dim: rgba(76,175,80,0.25);
  --pik-red: #EF5350;
  --pik-red-dim: rgba(239,83,80,0.25);
  --pik-blue: var(--primary-color, #42A5F5);
  --pik-blue-dim: rgba(66,165,245,0.20);
  --pik-surface: var(--primary-background-color, #252830);
  --pik-txt1: var(--primary-text-color, #e1e3e6);
  --pik-txt2: var(--secondary-text-color, #8b8f96);
  --pik-txt3: var(--disabled-text-color, #555a63);
  --pik-border: var(--divider-color, #2a2e38);
  --pik-card-bg: var(--ha-card-background, var(--card-background-color, #1c1f27));
}
ha-card { overflow: hidden; }

/* ── Header ── */
.hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 10px;
}
.hdr-left { display: flex; align-items: center; gap: 10px; }
.hdr-icon {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; flex-shrink: 0; transition: background .2s;
}
.hdr-icon.on  { background: var(--pik-green-dim); }
.hdr-icon.off { background: rgba(255,255,255,.06); }
.hdr-name {
  font-size: 16px; font-weight: 600; color: var(--pik-txt1);
  cursor: pointer; line-height: 1.2;
}
.hdr-name:hover { text-decoration: underline; }
.hdr-sub {
  font-size: 11px; color: var(--pik-txt2); margin-top: 1px;
}
ha-entity-toggle { flex-shrink: 0; }

/* ── Socket tabs ── */
.sock-row {
  display: flex; gap: 4px; padding: 0 16px 10px;
}
.sock-btn {
  flex: 1; height: 34px; border-radius: 10px;
  border: 1.5px solid var(--pik-border); background: transparent;
  color: var(--pik-txt2); font-size: 12px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  gap: 5px; transition: all .2s;
}
.sock-btn:hover { background: var(--pik-surface); }
.sock-btn.sel {
  background: var(--pik-blue); color: #fff; border-color: var(--pik-blue);
}
.sock-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.sock-dot.on  { background: var(--pik-green); }
.sock-dot.off { background: var(--pik-red); opacity: .6; }
.sock-btn.sel .sock-dot.on  { background: #b9f6ca; }
.sock-btn.sel .sock-dot.off { background: #ffcdd2; }

/* ── Section ── */
.sec {
  padding: 4px 16px 10px;
}
.sec-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; font-weight: 600; color: var(--pik-txt2);
  text-transform: uppercase; letter-spacing: .5px;
  margin-bottom: 6px;
}
.sec-badge {
  font-size: 10px; font-weight: 600; letter-spacing: 0;
  text-transform: none; padding: 1px 7px; border-radius: 10px;
}
.sec-badge.on  { background: var(--pik-green-dim); color: var(--pik-green); }
.sec-badge.off { background: rgba(255,255,255,.06); color: var(--pik-txt3); }

/* ── Timeline SVG ── */
.tl-wrap { padding: 0 0 2px; }
.tl-svg { width: 100%; display: block; }
.tl-bg   { fill: var(--pik-surface); }
.tl-on   { fill: var(--pik-green); opacity: .55; }
.tl-dis  { fill: var(--pik-txt3); opacity: .25; }
.tl-now  { stroke: var(--pik-blue); stroke-width: 1.5; stroke-dasharray: 3 2; }
.tl-hour { fill: var(--pik-txt3); font-size: 9px; text-anchor: middle; }
.tl-lbl  { fill: var(--pik-txt3); font-size: 7.5px; text-anchor: end;
           dominant-baseline: central; font-weight: 600; }

/* ── Profile list ── */
.prof-list { display: flex; flex-direction: column; gap: 2px; }
.pr {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: 8px;
  font-size: 12px; transition: background .15s; cursor: default;
}
.pr:hover { background: var(--pik-surface); }
.pr-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.pr-dot.en    { background: var(--pik-green); box-shadow: 0 0 4px var(--pik-green-dim); }
.pr-dot.dis   { background: var(--pik-txt3); }
.pr-dot.empty { background: transparent; border: 1.5px dashed var(--pik-border); }
.pr-idx {
  font-weight: 700; color: var(--pik-txt2); width: 18px; flex-shrink: 0; font-size: 11px;
}
.pr-time {
  color: var(--pik-txt1); font-weight: 600;
  font-family: 'SF Mono','Menlo','Cascadia Code','Consolas',monospace;
  font-size: 12px;
}
.pr-arr { color: var(--pik-txt3); margin: 0 2px; font-size: 10px; }
.pr-days { color: var(--pik-txt2); margin-left: auto; font-size: 11px; }
.pr-na { color: var(--pik-txt3); font-style: italic; font-size: 11px; }

/* ── Timer row ── */
.tmr-row {
  display: flex; align-items: center; gap: 10px;
  margin-top: 8px; padding: 7px 10px; border-radius: 10px;
  background: var(--pik-surface);
}
.tmr-lbl {
  font-size: 12px; font-weight: 600; color: var(--pik-txt2);
}
.tmr-tog {
  width: 40px; height: 22px; border-radius: 11px; border: none;
  background: var(--pik-border); cursor: pointer; position: relative;
  transition: background .25s; flex-shrink: 0;
}
.tmr-tog.on { background: var(--pik-green); }
.tmr-tog::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%; background: #fff;
  transition: transform .25s; box-shadow: 0 1px 3px rgba(0,0,0,.25);
}
.tmr-tog.on::after { transform: translateX(18px); }
.tmr-state { font-size: 11px; color: var(--pik-txt2); }

/* ── Sensor row ── */
.sens-row {
  display: flex; gap: 8px; flex-wrap: wrap;
}
.sens {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--pik-txt2); cursor: pointer;
  padding: 5px 10px; border-radius: 8px;
  background: var(--pik-surface); transition: all .15s;
  flex: 1; min-width: 70px; justify-content: center;
}
.sens:hover { filter: brightness(1.15); }
.sens-icon { font-size: 13px; }
.sens-val { font-weight: 700; color: var(--pik-txt1); }
.sens-unit { font-size: 10px; color: var(--pik-txt3); margin-left: 1px; }

/* ── Divider ── */
.divider {
  height: 1px; background: var(--pik-border); margin: 2px 16px;
}

/* ── Unavailable state ── */
.unavail {
  padding: 24px 16px; text-align: center;
  color: var(--pik-txt3); font-size: 13px;
}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   PikOutletCard
   ═══════════════════════════════════════════════════════════════════════════ */
class PikOutletCard extends HTMLElement {

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass   = null;
    this._config = {};
    this._prefix = '';
    this._socket = 1;
    this._built  = false;
  }

  /* ── Config ──────────────────────────────────────────────────────────── */
  setConfig(config) {
    if (!config.entity) throw new Error('Please define an entity');
    this._config = { ...config };

    // Accept both socket switch and timer_enable switch
    const sm = config.entity.match(/_socket_(\d+)/);
    this._socket = sm ? parseInt(sm[1]) : 1;
    const pm = config.entity.match(/^switch\.(.+?)_socket_\d+/);
    this._prefix = pm ? pm[1] : 'pik_outlet';

    // Pre-load HA switch more-info control (thomasloven pattern)
    if (window.loadCardHelpers) {
      window.loadCardHelpers().then(h => {
        if (h && h.importMoreInfoControl) h.importMoreInfoControl('switch');
      }).catch(() => {});
    }
  }

  /* ── Entity ID builders ──────────────────────────────────────────────── */
  _swId(s)        { return `switch.${this._prefix}_socket_${s || this._socket}`; }
  _teId(s)        { return `switch.${this._prefix}_socket_${s || this._socket}_timer_enable`; }
  _sensorId(key)  { return `sensor.${this._prefix}_${key}`; }

  /* ── Hass setter ─────────────────────────────────────────────────────── */
  set hass(hass) {
    this._hass = hass;
    if (!this._built) { this._build(); this._built = true; }
    this._update();
  }

  _$(id) { return this.shadowRoot.getElementById(id); }

  /* ═══════════════════════════════════════════════════════════════════════
     Build DOM
     ═══════════════════════════════════════════════════════════════════════ */
  _build() {
    const svgH = TL_H + 18;  // bar area + hour labels
    this.shadowRoot.innerHTML = `<style>${CSS}</style>
<ha-card>
  <!-- Header -->
  <div class="hdr">
    <div class="hdr-left">
      <div class="hdr-icon" id="hdrIcon">🔌</div>
      <div>
        <div class="hdr-name" id="hdrName">Socket</div>
        <div class="hdr-sub" id="hdrSub"></div>
      </div>
    </div>
    <span id="toggleWrap"></span>
  </div>

  <!-- Socket tabs -->
  <div class="sock-row" id="sockRow"></div>

  <div class="divider"></div>

  <!-- Schedule section -->
  <div class="sec">
    <div class="sec-title">
      <span>Schedule</span>
      <span class="sec-badge" id="tmrBadge"></span>
    </div>

    <div class="tl-wrap">
      <svg class="tl-svg" id="timeline" viewBox="0 0 ${TL_X + TL_W + 4} ${svgH}"></svg>
    </div>

    <div class="prof-list" id="profList"></div>

    <div class="tmr-row">
      <span class="tmr-lbl">Timer</span>
      <button class="tmr-tog" id="tmrTog"></button>
      <span class="tmr-state" id="tmrState"></span>
    </div>
  </div>

  <div class="divider"></div>

  <!-- Energy sensors -->
  <div class="sec">
    <div class="sec-title"><span>Energy</span></div>
    <div class="sens-row" id="sensRow"></div>
  </div>
</ha-card>`;

    this._buildSocketTabs();
    this._buildToggle();
    this._buildSensors();
    this._bindEvents();
  }

  _buildSocketTabs() {
    const row = this._$('sockRow');
    for (let i = 1; i <= SOCKETS; i++) {
      const btn = document.createElement('button');
      btn.className = 'sock-btn';
      btn.dataset.idx = i;
      btn.innerHTML = `<span class="sock-dot"></span>${i}`;
      btn.addEventListener('click', () => { this._socket = i; this._update(); });
      row.appendChild(btn);
    }
  }

  _buildToggle() {
    const wrap = this._$('toggleWrap');
    const tog = document.createElement('ha-entity-toggle');
    tog.id = 'mainTog';
    wrap.appendChild(tog);
  }

  _buildSensors() {
    const row = this._$('sensRow');
    const list = [
      { key: 'voltage',   icon: '⚡', unit: 'V'  },
      { key: 'current',   icon: '🔌', unit: 'A'  },
      { key: 'power',     icon: '💡', unit: 'W'  },
      { key: 'frequency', icon: '〰', unit: 'Hz' },
    ];
    list.forEach(s => {
      const el = document.createElement('div');
      el.className = 'sens';
      el.dataset.key = s.key;
      el.innerHTML = `<span class="sens-icon">${s.icon}</span>`
        + `<span class="sens-val" id="sv_${s.key}">—</span>`
        + `<span class="sens-unit">${s.unit}</span>`;
      el.addEventListener('click', () => {
        const eid = this._sensorId(s.key);
        if (this._hass && this._hass.states[eid]) {
          fireEvent(this, 'hass-more-info', { entityId: eid });
        }
      });
      row.appendChild(el);
    });
  }

  _bindEvents() {
    // Timer toggle
    this._$('tmrTog').addEventListener('click', () => this._toggleTimer());

    // Header name → open entity more-info dialog
    this._$('hdrName').addEventListener('click', () => {
      fireEvent(this, 'hass-more-info', { entityId: this._swId() });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Update
     ═══════════════════════════════════════════════════════════════════════ */
  _update() {
    if (!this._hass || !this._built) return;

    const swState = this._hass.states[this._swId()];
    const teState = this._hass.states[this._teId()];
    const isOn = swState && swState.state === 'on';

    // ── Header ──
    const name = this._config.title
      || (swState && swState.attributes.friendly_name)
      || `Socket ${this._socket}`;
    this._$('hdrName').textContent = name;
    this._$('hdrSub').textContent = swState
      ? (isOn ? 'On' : 'Off') + ' · Socket ' + this._socket
      : 'Unavailable';
    this._$('hdrIcon').className = 'hdr-icon ' + (isOn ? 'on' : 'off');

    // Main entity toggle
    const tog = this._$('mainTog');
    if (tog && swState) {
      tog.hass = this._hass;
      tog.stateObj = swState;
    }

    // ── Socket tabs ──
    this._$('sockRow').querySelectorAll('.sock-btn').forEach(btn => {
      const idx = +btn.dataset.idx;
      btn.classList.toggle('sel', idx === this._socket);
      const dot = btn.querySelector('.sock-dot');
      const st = this._hass.states[this._swId(idx)];
      dot.className = 'sock-dot ' + (st && st.state === 'on' ? 'on' : 'off');
    });

    // ── Timer badge ──
    const tmrOn = teState && teState.state === 'on';
    const badge = this._$('tmrBadge');
    badge.textContent = tmrOn ? 'Active' : 'Off';
    badge.className = 'sec-badge ' + (tmrOn ? 'on' : 'off');

    // Timer toggle row
    this._$('tmrTog').classList.toggle('on', !!tmrOn);
    this._$('tmrState').textContent = tmrOn ? 'Enabled' : 'Disabled';

    // ── Timeline & profiles ──
    this._renderTimeline(teState);
    this._renderProfiles(teState);

    // ── Sensors ──
    ['voltage', 'current', 'power', 'frequency'].forEach(key => {
      const el = this._$('sv_' + key);
      if (!el) return;
      const st = this._hass.states[this._sensorId(key)];
      el.textContent = (st && st.state !== 'unknown' && st.state !== 'unavailable')
        ? st.state : '—';
    });
  }

  /* ── 24 h timeline SVG ──────────────────────────────────────────────── */
  _renderTimeline(teState) {
    const svg = this._$('timeline');
    svg.innerHTML = '';

    const profiles = (teState && teState.attributes && teState.attributes.profiles) || [];

    for (let i = 0; i < PROFILES; i++) {
      const y = i * (TL_BAR_H + TL_GAP);

      // Background bar
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', TL_X); bg.setAttribute('y', y);
      bg.setAttribute('width', TL_W); bg.setAttribute('height', TL_BAR_H);
      bg.setAttribute('rx', '2'); bg.setAttribute('class', 'tl-bg');
      svg.appendChild(bg);

      // P-label
      const lbl = document.createElementNS(SVG_NS, 'text');
      lbl.setAttribute('x', TL_X - 4);
      lbl.setAttribute('y', y + TL_BAR_H / 2);
      lbl.setAttribute('class', 'tl-lbl');
      lbl.textContent = `P${i + 1}`;
      svg.appendChild(lbl);

      // Profile bar
      const p = profiles[i];
      if (p) {
        const onMin  = (p.hour_on  || 0) * 60 + (p.minute_on  || 0);
        const offMin = (p.hour_off || 0) * 60 + (p.minute_off || 0);
        const hasCfg = p.days > 0 || onMin > 0 || offMin > 0;
        if (hasCfg && offMin > onMin) {
          const bar = document.createElementNS(SVG_NS, 'rect');
          bar.setAttribute('x', minToX(onMin));
          bar.setAttribute('y', y);
          bar.setAttribute('width', Math.max(2, minToX(offMin) - minToX(onMin)));
          bar.setAttribute('height', TL_BAR_H);
          bar.setAttribute('rx', '2');
          bar.setAttribute('class', p.enabled ? 'tl-on' : 'tl-dis');
          svg.appendChild(bar);
        }
      }
    }

    // Hour marks & labels
    const labelY = TL_H + 4;
    for (let h = 0; h <= 24; h += 3) {
      const x = TL_X + (h / 24) * TL_W;
      // Tick
      const tk = document.createElementNS(SVG_NS, 'line');
      tk.setAttribute('x1', x); tk.setAttribute('y1', TL_H);
      tk.setAttribute('x2', x); tk.setAttribute('y2', TL_H + 3);
      tk.setAttribute('stroke', 'var(--pik-txt3)');
      tk.setAttribute('stroke-width', '0.5');
      svg.appendChild(tk);
      // Label
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', labelY + 10);
      t.setAttribute('class', 'tl-hour');
      t.textContent = String(h);
      svg.appendChild(t);
    }

    // Current time indicator
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nx = minToX(nowMin);
    const ln = document.createElementNS(SVG_NS, 'line');
    ln.setAttribute('x1', nx); ln.setAttribute('y1', 0);
    ln.setAttribute('x2', nx); ln.setAttribute('y2', TL_H);
    ln.setAttribute('class', 'tl-now');
    svg.appendChild(ln);
    // Now dot
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', nx); dot.setAttribute('cy', 0);
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', 'var(--pik-blue)');
    svg.appendChild(dot);
  }

  /* ── Profile rows ───────────────────────────────────────────────────── */
  _renderProfiles(teState) {
    const list = this._$('profList');
    list.innerHTML = '';

    const profiles = (teState && teState.attributes && teState.attributes.profiles) || [];

    for (let i = 0; i < PROFILES; i++) {
      const row = document.createElement('div');
      row.className = 'pr';

      const p = profiles[i];
      const hasCfg = p && (p.days > 0 || p.hour_on > 0 || p.hour_off > 0
                          || p.minute_on > 0 || p.minute_off > 0);

      if (hasCfg) {
        const onTime  = pad(p.hour_on)  + ':' + pad(p.minute_on);
        const offTime = pad(p.hour_off) + ':' + pad(p.minute_off);
        row.innerHTML =
          `<span class="pr-dot ${p.enabled ? 'en' : 'dis'}"></span>`
          + `<span class="pr-idx">P${i + 1}</span>`
          + `<span class="pr-time">${onTime}</span>`
          + `<span class="pr-arr">→</span>`
          + `<span class="pr-time">${offTime}</span>`
          + `<span class="pr-days">${daysStr(p.days)}</span>`;
      } else {
        row.innerHTML =
          `<span class="pr-dot empty"></span>`
          + `<span class="pr-idx">P${i + 1}</span>`
          + `<span class="pr-na">not configured</span>`;
      }
      list.appendChild(row);
    }
  }

  /* ── Timer toggle ────────────────────────────────────────────────────── */
  async _toggleTimer() {
    const teId = this._teId();
    const st = this._hass && this._hass.states[teId];
    if (!st) return;
    const svc = st.state === 'on' ? 'turn_off' : 'turn_on';
    try {
      await this._hass.callService('switch', svc, { entity_id: teId });
    } catch (e) {
      console.error('PIK Outlet Card: timer toggle failed', e);
    }
  }

  /* ── Card metadata ───────────────────────────────────────────────────── */
  getCardSize() { return 6; }

  static getConfigElement() {
    return document.createElement('pik-outlet-card-editor');
  }

  static getStubConfig() {
    return { entity: '' };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Editor
   ═══════════════════════════════════════════════════════════════════════════ */
class PikOutletCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass   = null;
    this._built  = false;
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
      <div style="padding:8px 0;">
        <ha-entity-picker allow-custom-entity></ha-entity-picker>
        <p style="margin-top:8px;font-size:12px;color:var(--secondary-text-color);">
          Pick any <b>socket switch</b> or <b>timer enable</b> entity from the PIK Outlet device.
        </p>
      </div>`;

    const picker = this.querySelector('ha-entity-picker');
    if (!picker) return;
    picker.hass  = this._hass;
    picker.value = this._config.entity || '';
    picker.label = 'PIK Outlet Entity';

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
customElements.define('pik-outlet-card', PikOutletCard);
customElements.define('pik-outlet-card-editor', PikOutletCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'pik-outlet-card',
  name: 'PIK Outlet Card',
  description: 'More-info style card for PIK BLE 6-Switch Outlet with schedule timeline and energy sensors',
  preview: false,
  documentationURL: 'https://github.com/pik-electronics/ha-pik-outlet',
});

console.info(
  '%c PIK-OUTLET-CARD %c v' + VERSION + ' ',
  'background:#4CAF50;color:#fff;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px;',
  'background:#1c1f27;color:#4CAF50;font-weight:700;padding:2px 6px;border-radius:0 4px 4px 0;',
);
})();
