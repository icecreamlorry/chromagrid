// Shared in-app dev tools panel for LB Games.
//
// Drop-in for any game: add ONE line to the page after the menu exists, e.g.
//   <script type="module" src="../shared/devtools.js"></script>
//
// It adds a "Dev tools" item to the existing hamburger menu (#app-menu) and
// opens a self-styled panel with:
//   • a scrollable, live log of recent errors/warnings (from devlog.js), and
//   • a feature-flags section games can populate at runtime.
//
// Everything here is game-agnostic: the panel brings its own styles (scoped to
// .lbdev-*) so it looks the same and needs no per-game CSS, and it attaches to
// whatever menu the game injects, whenever that happens.
//
// Feature flags API (for gating experimental gameplay):
//   import { registerFlag, flagEnabled, onFlagChange } from '../shared/devtools.js';
//   registerFlag({ key: 'fastTimer', label: 'Fast timer', default: false });
//   if (flagEnabled('fastTimer')) { ... }
// or via the global: window.LBDevtools.flagEnabled('fastTimer')

import { getEntries, clearEntries, subscribe } from './devlog.js';
import { getTestIdentity, setTestIdentity } from './guest-id.js';

const FLAGS_KEY = 'lb_devflags';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- feature flags --------------------------------------------------------

const flagDefs = new Map();       // key -> { key, label, description, default }
const flagListeners = new Set();  // (key, value) -> void

function readFlags() {
  try { return JSON.parse(localStorage.getItem(FLAGS_KEY)) || {}; }
  catch { return {}; }
}
function writeFlags(obj) {
  try { localStorage.setItem(FLAGS_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

export function registerFlag({ key, label, description = '', default: def = false }) {
  if (!key) return;
  flagDefs.set(key, { key, label: label || key, description, default: !!def });
  renderFlags();
}

export function flagEnabled(key) {
  const flags = readFlags();
  if (key in flags) return !!flags[key];
  return !!flagDefs.get(key)?.default;
}

export function setFlag(key, value) {
  const flags = readFlags();
  flags[key] = !!value;
  writeFlags(flags);
  for (const fn of flagListeners) { try { fn(key, !!value); } catch { /* ignore */ } }
  renderFlags();
}

export function onFlagChange(fn) {
  flagListeners.add(fn);
  return () => flagListeners.delete(fn);
}

// ---- styles ---------------------------------------------------------------

function injectStyles() {
  if ($('lbdev-styles')) return;
  const style = document.createElement('style');
  style.id = 'lbdev-styles';
  style.textContent = `
    #lbdev-modal {
      position: fixed; inset: 0; z-index: 980;
      display: none; align-items: center; justify-content: center;
      background: rgba(2,2,8,0.82);
      -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      padding: 16px; font-family: 'Share Tech Mono', ui-monospace, monospace;
    }
    #lbdev-modal.lbdev-open { display: flex; }
    .lbdev-panel {
      width: 100%; max-width: 680px; max-height: 88vh;
      display: flex; flex-direction: column;
      background: #07071a;
      border: 1px solid rgba(0,245,255,0.28);
      border-radius: 6px;
      box-shadow: 0 0 40px rgba(0,245,255,0.08), inset 0 0 60px rgba(0,0,0,0.5);
      color: #cfe9ee;
    }
    .lbdev-head {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px; border-bottom: 1px solid rgba(0,245,255,0.18);
    }
    .lbdev-title {
      flex: 1; font-family: 'Orbitron', monospace; font-weight: 800;
      font-size: 0.74rem; letter-spacing: 0.22em; color: #00f5ff;
      text-shadow: 0 0 10px rgba(0,245,255,0.6); text-transform: uppercase;
    }
    .lbdev-btn {
      background: transparent; color: #00f5ff;
      border: 1px solid rgba(0,245,255,0.4); border-radius: 3px;
      padding: 5px 10px; font-family: inherit; font-size: 0.62rem;
      letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .lbdev-btn:hover { background: rgba(0,245,255,0.12); color: #fff; }
    .lbdev-btn.lbdev-x { border-color: rgba(255,0,200,0.5); color: #ff5ad8; }
    .lbdev-btn.lbdev-x:hover { background: rgba(255,0,200,0.14); color: #fff; }
    .lbdev-body { overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }
    .lbdev-section-label {
      font-family: 'Orbitron', monospace; font-size: 0.5rem; letter-spacing: 0.18em;
      color: rgba(255,0,200,0.75); text-transform: uppercase; margin-bottom: 6px;
    }
    .lbdev-log {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 1px;
      font-size: 0.68rem; line-height: 1.45;
    }
    .lbdev-day-header {
      display: flex; align-items: center; gap: 10px;
      margin: 12px 0 4px 0; padding: 4px 0;
      font-family: 'Orbitron', monospace; font-size: 0.54rem; font-weight: 700;
      letter-spacing: 0.16em; color: #00f5ff; opacity: 0.9; text-transform: uppercase;
      user-select: none;
    }
    .lbdev-day-header:first-child { margin-top: 2px; }
    .lbdev-day-header::after {
      content: ''; flex: 1; height: 1px;
      background: linear-gradient(90deg, rgba(0,245,255,0.35), transparent);
    }
    .lbdev-empty-day {
      padding: 8px 6px; color: rgba(0,245,255,0.45);
      font-size: 0.66rem; font-style: italic;
    }
    .lbdev-row {
      display: grid; grid-template-columns: 58px 44px 1fr auto; gap: 8px;
      padding: 5px 8px; border-radius: 3px;
      border-left: 2px solid transparent; white-space: pre-wrap; word-break: break-word;
      cursor: pointer; position: relative; transition: background 0.15s, border-color 0.15s;
    }
    .lbdev-row:hover {
      background: rgba(0,245,255,0.08) !important;
      outline: 1px solid rgba(0,245,255,0.25);
    }
    .lbdev-row.error:hover {
      background: rgba(255,40,80,0.12) !important;
      outline: 1px solid rgba(255,59,92,0.4);
    }
    .lbdev-row.warn:hover {
      background: rgba(255,210,0,0.1) !important;
      outline: 1px solid rgba(255,210,59,0.4);
    }
    .lbdev-row .lbdev-time { color: rgba(0,245,255,0.4); font-variant-numeric: tabular-nums; }
    .lbdev-row .lbdev-lvl  { font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; font-size: 0.56rem; }
    .lbdev-row.error { background: rgba(255,40,80,0.06); border-left-color: #ff3b5c; }
    .lbdev-row.error .lbdev-lvl { color: #ff6a85; }
    .lbdev-row.warn  { background: rgba(255,210,0,0.05); border-left-color: #ffd23b; }
    .lbdev-row.warn  .lbdev-lvl { color: #ffe06a; }
    .lbdev-row.info  .lbdev-lvl { color: rgba(0,245,255,0.7); }
    .lbdev-row .lbdev-msg { color: #d6eef2; }
    .lbdev-copy-hint {
      font-size: 0.52rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: rgba(0,245,255,0.4); opacity: 0; transition: opacity 0.15s;
      align-self: center; user-select: none;
    }
    .lbdev-row:hover .lbdev-copy-hint { opacity: 1; }
    .lbdev-copy-badge {
      font-size: 0.54rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
      color: #00f5ff; background: rgba(0,245,255,0.22); border: 1px solid #00f5ff;
      border-radius: 2px; padding: 1px 6px; opacity: 0; transition: opacity 0.2s, transform 0.2s;
      position: absolute; right: 8px; top: 4px; pointer-events: none;
      box-shadow: 0 0 10px rgba(0,245,255,0.5);
    }
    .lbdev-row.copied .lbdev-copy-badge { opacity: 1; transform: translateY(0); }
    .lbdev-empty { padding: 18px 6px; text-align: center; color: rgba(0,245,255,0.4); font-size: 0.7rem; }
    .lbdev-flags { display: flex; flex-direction: column; gap: 6px; }
    .lbdev-flag {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 3px;
      background: rgba(0,245,255,0.04); border: 1px solid rgba(0,245,255,0.12);
    }
    .lbdev-flag-text { flex: 1; }
    .lbdev-flag-label { font-size: 0.72rem; color: #d6eef2; }
    .lbdev-flag-desc  { font-size: 0.58rem; color: rgba(0,245,255,0.45); margin-top: 2px; }
    .lbdev-toggle {
      flex-shrink: 0; width: 40px; height: 22px; border-radius: 11px; cursor: pointer;
      border: 1px solid rgba(0,245,255,0.4); background: rgba(0,245,255,0.06);
      position: relative; transition: background 0.15s, border-color 0.15s;
    }
    .lbdev-toggle::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 16px; height: 16px; border-radius: 50%;
      background: rgba(0,245,255,0.6); transition: transform 0.15s, background 0.15s;
    }
    .lbdev-toggle.on { background: rgba(0,245,255,0.25); border-color: #00f5ff; }
    .lbdev-toggle.on::after { transform: translateX(18px); background: #00f5ff; }
    .lbdev-empty-flags { font-size: 0.62rem; color: rgba(0,245,255,0.4); padding: 4px 2px; }
    .lbdev-testid { display: flex; gap: 8px; }
    .lbdev-testid input {
      flex: 1; min-width: 0; background: rgba(0,245,255,0.04);
      border: 1px solid rgba(0,245,255,0.25); border-radius: 3px;
      padding: 7px 9px; font-family: inherit; font-size: 0.72rem; color: #d6eef2;
    }
    .lbdev-testid input:focus { outline: none; border-color: #00f5ff; }
    .lbdev-testid input.active { border-color: #ff5ad8; background: rgba(255,0,200,0.06); }
    .lbdev-testid-status { font-size: 0.58rem; color: rgba(0,245,255,0.45); margin-top: 4px; }
    .lbdev-testid-status.active { color: #ff9ae8; }
  `;
  document.head.appendChild(style);
}

// ---- panel ----------------------------------------------------------------

function buildPanel() {
  if ($('lbdev-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'lbdev-modal';
  modal.innerHTML = `
    <div class="lbdev-panel">
      <div class="lbdev-head">
        <span class="lbdev-title">Dev Tools</span>
        <button class="lbdev-btn" id="lbdev-copy">Copy</button>
        <button class="lbdev-btn" id="lbdev-clear">Clear</button>
        <button class="lbdev-btn lbdev-x" id="lbdev-close">Close</button>
      </div>
      <div class="lbdev-body">
        <div>
          <div class="lbdev-section-label">Test identity (this tab only)</div>
          <div class="lbdev-testid">
            <input id="lbdev-testid-input" type="text" maxlength="24" placeholder="Off — using your real guest name" autocomplete="off" spellcheck="false">
            <button class="lbdev-btn" id="lbdev-testid-apply">Apply &amp; reload</button>
          </div>
          <div class="lbdev-testid-status" id="lbdev-testid-status"></div>
        </div>
        <div>
          <div class="lbdev-section-label">Feature flags</div>
          <div class="lbdev-flags" id="lbdev-flags"></div>
        </div>
        <div>
          <div class="lbdev-section-label">Recent log</div>
          <ul class="lbdev-log" id="lbdev-log"></ul>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => { if (e.target === modal) closePanel(); });
  $('lbdev-close').addEventListener('click', closePanel);
  $('lbdev-clear').addEventListener('click', () => { clearEntries(); renderLog(); });
  $('lbdev-copy').addEventListener('click', copyLog);

  const testIdInput = $('lbdev-testid-input');
  const applyTestId = () => {
    const v = testIdInput.value.trim();
    if (v === getTestIdentity()) return; // nothing changed — skip the reload
    setTestIdentity(v);
    location.reload();
  };
  $('lbdev-testid-apply').addEventListener('click', applyTestId);
  testIdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyTestId(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closePanel();
  });
}

function getDayKey(t) {
  const d = new Date(t);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtDate(t) {
  const d = new Date(t);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtTime(t) {
  const d = new Date(t);
  return d.toTimeString().slice(0, 8);
}

function fmtDayHeader(dayKey, todayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dateStr = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).toUpperCase();

  if (dayKey === todayKey) {
    return `TODAY — ${dateStr}`;
  }

  const [ty, tm, td] = todayKey.split('-').map(Number);
  const todayObj = new Date(ty, tm - 1, td);
  const diffDays = Math.round((todayObj - dateObj) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) {
    return `YESTERDAY — ${dateStr}`;
  }

  return dateStr;
}

async function copyRowDetail(r, li) {
  const dateStr = fmtDate(r.t);
  const timeStr = fmtTime(r.t);
  const levelStr = (r.level || 'info').toUpperCase();
  const text = `[${dateStr} ${timeStr}] [${levelStr}] ${r.msg}`;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }

  li.classList.add('copied');
  clearTimeout(li._copyTimer);
  li._copyTimer = setTimeout(() => {
    li.classList.remove('copied');
  }, 1200);
}

function createLogRow(r) {
  const li = document.createElement('li');
  li.className = 'lbdev-row ' + (r.level || 'info');
  li.title = 'Click to copy event details';

  const time = document.createElement('span');
  time.className = 'lbdev-time';
  time.textContent = fmtTime(r.t);

  const lvl = document.createElement('span');
  lvl.className = 'lbdev-lvl';
  lvl.textContent = r.level;

  const msg = document.createElement('span');
  msg.className = 'lbdev-msg';
  msg.textContent = r.msg;

  const hint = document.createElement('span');
  hint.className = 'lbdev-copy-hint';
  hint.textContent = 'Copy';

  const badge = document.createElement('span');
  badge.className = 'lbdev-copy-badge';
  badge.textContent = 'Copied';

  li.append(time, lvl, msg, hint, badge);

  li.addEventListener('click', (e) => {
    e.stopPropagation();
    copyRowDetail(r, li);
  });

  return li;
}

function renderLog() {
  const el = $('lbdev-log');
  if (!el) return;

  const entries = getEntries();
  const todayKey = getDayKey(Date.now());

  const grouped = new Map();
  for (const r of entries) {
    const key = getDayKey(r.t);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }

  el.innerHTML = '';

  // 1. Always render Today at the top
  const todayHeader = document.createElement('li');
  todayHeader.className = 'lbdev-day-header';
  todayHeader.textContent = fmtDayHeader(todayKey, todayKey);
  el.appendChild(todayHeader);

  const todayEntries = grouped.get(todayKey) || [];
  if (todayEntries.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'lbdev-empty-day';
    emptyLi.textContent = 'No log entries for today yet.';
    el.appendChild(emptyLi);
  } else {
    for (const r of todayEntries) {
      el.appendChild(createLogRow(r));
    }
  }

  // 2. Render past days (if any entries exist from earlier days)
  const pastDayKeys = Array.from(grouped.keys())
    .filter(k => k !== todayKey)
    .sort((a, b) => b.localeCompare(a));

  for (const dayKey of pastDayKeys) {
    const dayHeader = document.createElement('li');
    dayHeader.className = 'lbdev-day-header';
    dayHeader.textContent = fmtDayHeader(dayKey, todayKey);
    el.appendChild(dayHeader);

    const dayEntries = grouped.get(dayKey);
    for (const r of dayEntries) {
      el.appendChild(createLogRow(r));
    }
  }

  const body = el.closest('.lbdev-body');
  if (body) body.scrollTop = body.scrollHeight;
}

function renderTestIdentity() {
  const input = $('lbdev-testid-input');
  const status = $('lbdev-testid-status');
  if (!input || !status) return;
  const active = getTestIdentity();
  // Never clobber the field while someone is mid-edit.
  if (document.activeElement !== input) input.value = active;
  input.classList.toggle('active', !!active);
  status.classList.toggle('active', !!active);
  status.textContent = active
    ? `Active on this tab as "${active}" — a made-up guest identity, separate from your real one. Clear the field and Apply to go back to normal.`
    : 'Type a name and Apply to make this ONE tab a distinct player — handy for testing multiplayer with two tabs in one browser. Never touches your real name or the other tab.';
}

function renderFlags() {
  const el = $('lbdev-flags');
  if (!el) return;
  if (!flagDefs.size) {
    el.innerHTML = '<div class="lbdev-empty-flags">No feature flags registered.</div>';
    return;
  }
  el.innerHTML = '';
  for (const def of flagDefs.values()) {
    const on = flagEnabled(def.key);
    const row = document.createElement('div');
    row.className = 'lbdev-flag';
    row.innerHTML =
      '<div class="lbdev-flag-text">' +
        '<div class="lbdev-flag-label"></div>' +
        (def.description ? '<div class="lbdev-flag-desc"></div>' : '') +
      '</div>' +
      '<div class="lbdev-toggle' + (on ? ' on' : '') + '" role="switch"></div>';
    row.querySelector('.lbdev-flag-label').textContent = def.label;
    if (def.description) row.querySelector('.lbdev-flag-desc').textContent = def.description;
    const toggle = row.querySelector('.lbdev-toggle');
    toggle.setAttribute('aria-checked', String(on));
    toggle.addEventListener('click', () => setFlag(def.key, !flagEnabled(def.key)));
    el.appendChild(row);
  }
}

async function copyLog() {
  const text = getEntries().map(r => `[${fmtDate(r.t)} ${fmtTime(r.t)}] [${(r.level || 'info').toUpperCase()}] ${r.msg}`).join('\n');
  const btn = $('lbdev-copy');
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1400); }
  } catch {
    if (btn) { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 1400); }
  }
}

function isOpen() { return $('lbdev-modal')?.classList.contains('lbdev-open'); }

export function openPanel() {
  buildPanel();
  renderTestIdentity();
  renderFlags();
  renderLog();
  $('lbdev-modal').classList.add('lbdev-open');
  $('app-menu')?.classList.add('hidden'); // dismiss the hamburger if it's open
}

function closePanel() { $('lbdev-modal')?.classList.remove('lbdev-open'); }

// Live-update the log while the panel is open.
subscribe(() => { if (isOpen()) renderLog(); });

// ---- menu item ------------------------------------------------------------

function makeMenuItem() {
  const btn = document.createElement('button');
  btn.className = 'menu-item menu-sep';
  btn.id = 'lbdev-menu-item';
  // Surface an active test identity right on the menu item — so a tab running
  // as a fake player is never mistaken for a real one during manual QA.
  const testId = getTestIdentity();
  btn.title = testId ? `Dev tools — test identity: ${testId}` : 'Dev tools';
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6.5 2.5 3 6l3.5 3.5"/><path d="M9.5 6.5 13 10l-3.5 3.5"/>' +
    '</svg><span>Dev tools' + (testId ? ` (${esc(testId)})` : '') + '</span>';
  btn.addEventListener('click', openPanel);
  return btn;
}

// Attach to #app-menu now, or as soon as the game injects it.
function attachMenuItem() {
  const menu = $('app-menu');
  if (menu && !$('lbdev-menu-item')) {
    menu.appendChild(makeMenuItem());
    return true;
  }
  return false;
}

function init() {
  injectStyles();
  if (attachMenuItem()) return;
  // The menu may be injected later (e.g. by account-ui.js). Watch for it.
  const observer = new MutationObserver(() => {
    if (attachMenuItem()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose a small global so non-module game code can use flags / open the panel,
// and so browser-automation testing can set a per-tab test identity in one call
// (window.LBDevtools.setTestIdentity('Dana'); then reload) instead of poking
// localStorage/sessionStorage keys by hand.
window.LBDevtools = {
  registerFlag, flagEnabled, setFlag, onFlagChange, openPanel,
  getTestIdentity, setTestIdentity,
};
