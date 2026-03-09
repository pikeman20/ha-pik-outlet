/**
 * PIK Outlet — More-Info Dialog Override v1.0.0
 *
 * Intercepts HA's more-info dialog for PIK outlet entities and injects
 * a rich custom UI (switch toggle, schedule timeline, profile summary,
 * energy sensors) instead of the default switch more-info panel.
 *
 * Only affects entities matching  switch.pik_outlet_*  — all other
 * entities keep their default more-info dialog.
 *
 * Loaded automatically by the pik_outlet integration.
 */
(function () {
'use strict';

const VERSION      = '1.0.0';
const DOMAIN       = 'pik_outlet';
const ENTITY_MATCH = /^switch\..*pik_outlet.*_socket_\d+$/;  // socket switches only (not timer_enable)
const POLL_MS      = 60;
const POLL_TIMEOUT = 3000;
const SOCKETS      = 6;
const PROFILES     = 6;
const SVG_NS       = 'http://www.w3.org/2000/svg';

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
function getHA() { return document.querySelector('home-assistant'); }
function getHass() { return getHA()?.hass; }

/* Derive prefix / socket from entity_id */
function parseEntity(eid) {
  const sm = eid.match(/_socket_(\d+)$/);
  const pm = eid.match(/^switch\.(.+?)_socket_\d+$/);
  return {
    socket: sm ? parseInt(sm[1]) : 1,
    prefix: pm ? pm[1] : 'pik_outlet',
  };
}

/* Timeline constants */
const TL_X = 24, TL_W = 264, TL_BAR_H = 7, TL_GAP = 2;
const TL_H = PROFILES * (TL_BAR_H + TL_GAP);
function minToX(m) { return TL_X + (m / 1440) * TL_W; }


/* ═══════════════════════════════════════════════════════════════════════════
   CSS for the custom more-info content
   ═══════════════════════════════════════════════════════════════════════════ */
const MI_CSS = `
:host {
  display: block;
  --pik-green: #4CAF50;
  --pik-green-dim: rgba(76,175,80,0.25);
  --pik-red: #EF5350;
  --pik-blue: var(--primary-color, #42A5F5);
  --pik-surface: var(--secondary-background-color, var(--primary-background-color, #252830));
  --pik-txt1: var(--primary-text-color, #e1e3e6);
  --pik-txt2: var(--secondary-text-color, #8b8f96);
  --pik-txt3: var(--disabled-text-color, #555a63);
  --pik-border: var(--divider-color, #2a2e38);
}

/* ── Main toggle row ── */
.mi-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0 16px;
}
.mi-state {
  font-size: 28px; font-weight: 700; color: var(--pik-txt1);
  text-transform: capitalize;
}
.mi-state.on { color: var(--pik-green); }

/* ── Socket chips ── */
.mi-chips { display: flex; gap: 4px; flex-wrap: wrap; padding-bottom: 12px; }
.mi-chip {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 16px;
  font-size: 11px; font-weight: 600; cursor: pointer;
  border: 1.5px solid var(--pik-border); background: transparent;
  color: var(--pik-txt2); transition: all .15s;
}
.mi-chip:hover { background: var(--pik-surface); }
.mi-chip.sel { background: var(--pik-blue); color: #fff; border-color: var(--pik-blue); }
.mi-cdot {
  width: 6px; height: 6px; border-radius: 50%;
}
.mi-cdot.on  { background: var(--pik-green); }
.mi-cdot.off { background: var(--pik-red); opacity: .5; }
.mi-chip.sel .mi-cdot.on  { background: #b9f6ca; }
.mi-chip.sel .mi-cdot.off { background: #ffcdd2; }

/* ── Section headers ── */
.mi-sec {
  font-size: 11px; font-weight: 600; color: var(--pik-txt2);
  text-transform: uppercase; letter-spacing: .5px;
  padding: 8px 0 4px; display: flex; align-items: center; gap: 6px;
}
.mi-badge {
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px;
  text-transform: none; letter-spacing: 0;
}
.mi-badge.on  { background: var(--pik-green-dim); color: var(--pik-green); }
.mi-badge.off { background: rgba(255,255,255,.06); color: var(--pik-txt3); }

/* ── Timeline SVG ── */
.mi-tl { width: 100%; display: block; margin: 4px 0; }
.mi-tl-bg   { fill: var(--pik-surface); }
.mi-tl-on   { fill: var(--pik-green); opacity: .55; }
.mi-tl-dis  { fill: var(--pik-txt3); opacity: .25; }
.mi-tl-now  { stroke: var(--pik-blue); stroke-width: 1.5; stroke-dasharray: 3 2; }
.mi-tl-hour { fill: var(--pik-txt3); font-size: 8px; text-anchor: middle; }
.mi-tl-lbl  { fill: var(--pik-txt3); font-size: 7px; text-anchor: end;
              dominant-baseline: central; font-weight: 700; }

/* ── Profile list ── */
.mi-plist { display: flex; flex-direction: column; gap: 1px; }
.mi-pr {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; border-radius: 6px; font-size: 11px;
}
.mi-pr:hover { background: var(--pik-surface); }
.mi-pd { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.mi-pd.en    { background: var(--pik-green); }
.mi-pd.dis   { background: var(--pik-txt3); }
.mi-pd.empty { border: 1.5px dashed var(--pik-border); background: transparent; }
.mi-pi { font-weight: 700; color: var(--pik-txt2); width: 16px; font-size: 10px; }
.mi-pt {
  color: var(--pik-txt1); font-weight: 600;
  font-family: 'SF Mono','Menlo','Cascadia Code','Consolas',monospace; font-size: 11px;
}
.mi-pa { color: var(--pik-txt3); margin: 0 2px; font-size: 9px; }
.mi-pdays { color: var(--pik-txt2); margin-left: auto; font-size: 10px; }
.mi-pna { color: var(--pik-txt3); font-style: italic; font-size: 10px; }

/* ── Timer row ── */
.mi-tmr {
  display: flex; align-items: center; gap: 8px;
  margin: 8px 0 4px; padding: 6px 8px; border-radius: 8px;
  background: var(--pik-surface);
}
.mi-tmr-lbl { font-size: 12px; font-weight: 600; color: var(--pik-txt2); }
.mi-tmr-tog {
  width: 36px; height: 20px; border-radius: 10px; border: none;
  background: var(--pik-border); cursor: pointer; position: relative;
  transition: background .2s; flex-shrink: 0;
}
.mi-tmr-tog.on { background: var(--pik-green); }
.mi-tmr-tog::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  transition: transform .2s; box-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.mi-tmr-tog.on::after { transform: translateX(16px); }
.mi-tmr-state { font-size: 11px; color: var(--pik-txt2); }

/* ── Energy row ── */
.mi-energy { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 0 0; }
.mi-en {
  flex: 1; min-width: 60px; text-align: center;
  padding: 6px 4px; border-radius: 8px; background: var(--pik-surface);
  cursor: pointer; transition: filter .15s;
}
.mi-en:hover { filter: brightness(1.15); }
.mi-en-val { font-size: 15px; font-weight: 700; color: var(--pik-txt1); }
.mi-en-unit { font-size: 10px; color: var(--pik-txt3); margin-left: 1px; }
.mi-en-lbl { font-size: 9px; color: var(--pik-txt2); margin-top: 2px; }

/* ── Edit button ── */
.mi-edit {
  display: block; width: 100%; margin: 12px 0 4px; padding: 8px;
  border-radius: 8px; border: 1.5px solid var(--pik-blue);
  background: transparent; color: var(--pik-blue);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all .15s; text-align: center;
}
.mi-edit:hover { background: rgba(66,165,245,.1); }

/* ── Divider ── */
.mi-div { height: 1px; background: var(--pik-border); margin: 6px 0; }
`;


/* ═══════════════════════════════════════════════════════════════════════════
   <pik-outlet-more-info> Custom Element
   ═══════════════════════════════════════════════════════════════════════════ */
class PikOutletMoreInfo extends HTMLElement {

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass     = null;
    this._entityId = '';
    this._prefix   = '';
    this._socket   = 1;
    this._built    = false;
  }

  set entityId(v) {
    if (v === this._entityId) return;
    this._entityId = v;
    const p = parseEntity(v);
    this._prefix = p.prefix;
    this._socket = p.socket;
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

  _swId(s)  { return `switch.${this._prefix}_socket_${s || this._socket}`; }
  _teId(s)  { return `switch.${this._prefix}_socket_${s || this._socket}_timer_enable`; }
  _senId(k) { return `sensor.${this._prefix}_${k}`; }

  /* ── Build ────────────────────────────────────────────────────────────── */
  _build() {
    const svgH = TL_H + 16;
    this.shadowRoot.innerHTML = `<style>${MI_CSS}</style>
<div>
  <div class="mi-toggle-row">
    <span class="mi-state" id="miState">Off</span>
    <span id="miTog"></span>
  </div>

  <div class="mi-chips" id="miChips"></div>
  <div class="mi-div"></div>

  <div class="mi-sec">
    <span>Schedule</span>
    <span class="mi-badge" id="miBadge"></span>
  </div>
  <svg class="mi-tl" id="miTL" viewBox="0 0 ${TL_X + TL_W + 4} ${svgH}"></svg>
  <div class="mi-plist" id="miProfs"></div>
  <div class="mi-tmr">
    <span class="mi-tmr-lbl">Timer</span>
    <button class="mi-tmr-tog" id="miTmrTog"></button>
    <span class="mi-tmr-state" id="miTmrSt"></span>
  </div>

  <div class="mi-div"></div>
  <div class="mi-sec">Energy</div>
  <div class="mi-energy" id="miEnergy"></div>

  <button class="mi-edit" id="miEdit">Edit Schedule</button>
</div>`;

    this._buildChips();
    this._buildToggle();
    this._buildEnergy();
    this._bindEvents();
  }

  _buildChips() {
    const c = this._$('miChips');
    for (let i = 1; i <= SOCKETS; i++) {
      const chip = document.createElement('button');
      chip.className = 'mi-chip';
      chip.dataset.idx = i;
      chip.innerHTML = `<span class="mi-cdot"></span>Socket ${i}`;
      chip.addEventListener('click', () => {
        this._socket = i;
        this._entityId = this._swId(i);
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
        const ha = getHA();
        if (ha) ha.dispatchEvent(new CustomEvent('hass-more-info', {
          bubbles: true, composed: true,
          detail: { entityId: this._senId(s.key) },
        }));
      });
      row.appendChild(el);
    });
  }

  _bindEvents() {
    this._$('miTmrTog').addEventListener('click', () => this._toggleTimer());
    this._$('miEdit').addEventListener('click', () => {
      // Close dialog → navigate or just inform
      const ha = getHA();
      if (ha) {
        // Close current dialog
        const dlg = ha.shadowRoot?.querySelector('ha-more-info-dialog');
        if (dlg) {
          // Try closing
          try { dlg.closeDialog?.(); } catch(e) {}
          try { dlg.close?.(); } catch(e) {}
          // Fallback: fire browser-navigate to go to schedule card if available
        }
      }
    });
  }

  /* ── Update ────────────────────────────────────────────────────────────── */
  _update() {
    if (!this._hass || !this._built) return;

    const swSt = this._hass.states[this._swId()];
    const teSt = this._hass.states[this._teId()];
    const isOn = swSt && swSt.state === 'on';

    // State label
    const stEl = this._$('miState');
    stEl.textContent = swSt ? (isOn ? 'On' : 'Off') : 'Unavailable';
    stEl.className = 'mi-state' + (isOn ? ' on' : '');

    // Main toggle
    const tog = this._$('miMainTog');
    if (tog && swSt) {
      tog.hass = this._hass;
      tog.stateObj = swSt;
    }

    // Socket chips
    this._$('miChips').querySelectorAll('.mi-chip').forEach(c => {
      const idx = +c.dataset.idx;
      c.classList.toggle('sel', idx === this._socket);
      const dot = c.querySelector('.mi-cdot');
      const st = this._hass.states[this._swId(idx)];
      dot.className = 'mi-cdot ' + (st && st.state === 'on' ? 'on' : 'off');
    });

    // Timer badge
    const tmrOn = teSt && teSt.state === 'on';
    const badge = this._$('miBadge');
    badge.textContent = tmrOn ? 'Active' : 'Off';
    badge.className = 'mi-badge ' + (tmrOn ? 'on' : 'off');

    // Timer toggle
    this._$('miTmrTog').classList.toggle('on', !!tmrOn);
    this._$('miTmrSt').textContent = tmrOn ? 'Enabled' : 'Disabled';

    // Timeline + Profiles
    this._renderTimeline(teSt);
    this._renderProfiles(teSt);

    // Energy
    ['voltage', 'current', 'power', 'frequency'].forEach(k => {
      const el = this._$('mie_' + k);
      if (!el) return;
      const st = this._hass.states[this._senId(k)];
      el.textContent = (st && st.state !== 'unknown' && st.state !== 'unavailable')
        ? st.state : '—';
    });
  }

  /* ── Timeline SVG ──────────────────────────────────────────────────────── */
  _renderTimeline(teSt) {
    const svg = this._$('miTL');
    svg.innerHTML = '';
    const profiles = (teSt && teSt.attributes && teSt.attributes.profiles) || [];

    for (let i = 0; i < PROFILES; i++) {
      const y = i * (TL_BAR_H + TL_GAP);
      // Background
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', TL_X); bg.setAttribute('y', y);
      bg.setAttribute('width', TL_W); bg.setAttribute('height', TL_BAR_H);
      bg.setAttribute('rx', '2'); bg.setAttribute('class', 'mi-tl-bg');
      svg.appendChild(bg);
      // Label
      const lbl = document.createElementNS(SVG_NS, 'text');
      lbl.setAttribute('x', TL_X - 3); lbl.setAttribute('y', y + TL_BAR_H / 2);
      lbl.setAttribute('class', 'mi-tl-lbl');
      lbl.textContent = 'P' + (i + 1);
      svg.appendChild(lbl);
      // Bar
      const p = profiles[i];
      if (p) {
        const onM = (p.hour_on||0)*60 + (p.minute_on||0);
        const offM = (p.hour_off||0)*60 + (p.minute_off||0);
        if ((p.days > 0 || onM > 0 || offM > 0) && offM > onM) {
          const bar = document.createElementNS(SVG_NS, 'rect');
          bar.setAttribute('x', minToX(onM)); bar.setAttribute('y', y);
          bar.setAttribute('width', Math.max(2, minToX(offM) - minToX(onM)));
          bar.setAttribute('height', TL_BAR_H); bar.setAttribute('rx', '2');
          bar.setAttribute('class', p.enabled ? 'mi-tl-on' : 'mi-tl-dis');
          svg.appendChild(bar);
        }
      }
    }
    // Hour marks
    for (let h = 0; h <= 24; h += 6) {
      const x = TL_X + (h/24)*TL_W;
      const tk = document.createElementNS(SVG_NS, 'line');
      tk.setAttribute('x1', x); tk.setAttribute('y1', TL_H);
      tk.setAttribute('x2', x); tk.setAttribute('y2', TL_H + 3);
      tk.setAttribute('stroke', 'var(--pik-txt3)'); tk.setAttribute('stroke-width', '.5');
      svg.appendChild(tk);
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', TL_H + 12);
      t.setAttribute('class', 'mi-tl-hour');
      t.textContent = String(h);
      svg.appendChild(t);
    }
    // Now line
    const now = new Date();
    const nx = minToX(now.getHours() * 60 + now.getMinutes());
    const ln = document.createElementNS(SVG_NS, 'line');
    ln.setAttribute('x1', nx); ln.setAttribute('y1', 0);
    ln.setAttribute('x2', nx); ln.setAttribute('y2', TL_H);
    ln.setAttribute('class', 'mi-tl-now');
    svg.appendChild(ln);
  }

  /* ── Profile list ──────────────────────────────────────────────────────── */
  _renderProfiles(teSt) {
    const list = this._$('miProfs');
    list.innerHTML = '';
    const profiles = (teSt && teSt.attributes && teSt.attributes.profiles) || [];

    for (let i = 0; i < PROFILES; i++) {
      const row = document.createElement('div');
      row.className = 'mi-pr';
      const p = profiles[i];
      const hasCfg = p && (p.days > 0 || p.hour_on > 0 || p.hour_off > 0
                          || p.minute_on > 0 || p.minute_off > 0);
      if (hasCfg) {
        row.innerHTML =
          `<span class="mi-pd ${p.enabled ? 'en' : 'dis'}"></span>`
          + `<span class="mi-pi">P${i+1}</span>`
          + `<span class="mi-pt">${pad(p.hour_on)}:${pad(p.minute_on)}</span>`
          + `<span class="mi-pa">→</span>`
          + `<span class="mi-pt">${pad(p.hour_off)}:${pad(p.minute_off)}</span>`
          + `<span class="mi-pdays">${daysStr(p.days)}</span>`;
      } else {
        row.innerHTML =
          `<span class="mi-pd empty"></span>`
          + `<span class="mi-pi">P${i+1}</span>`
          + `<span class="mi-pna">not configured</span>`;
      }
      list.appendChild(row);
    }
  }

  /* ── Toggle timer ──────────────────────────────────────────────────────── */
  async _toggleTimer() {
    const teId = this._teId();
    const st = this._hass?.states[teId];
    if (!st) return;
    try {
      await this._hass.callService('switch', st.state === 'on' ? 'turn_off' : 'turn_on',
        { entity_id: teId });
    } catch (e) { console.error('PIK more-info: timer toggle failed', e); }
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

  if (ENTITY_MATCH.test(entityId)) {
    // PIK entity → intercept after HA opens the dialog
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
        if (ENTITY_MATCH.test(eid)) {
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
