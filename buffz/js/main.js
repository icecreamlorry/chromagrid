// Buffz — movie & TV trivia. The whole landing/lobby/room/results flow lives in
// shared/quiz-game.js; this file is just the Buffz-specific config: its engine
// tables, title data, the pool-filter + mode + difficulty picker, and how a
// picked config becomes a `start` payload + seeded rounds. Gameplay (each mode's
// rendering) is modes.js; title data is data.js.
//
// Multiplayer model: the host's `start` move (index 0) carries
// { f: {type,decade,genre}, mode, diff, startAt }; everyone derives the same
// filtered pool and races identical seeded rounds; each seat submits ONE sparse
// `result` move (index 10+seat).

import { MODES, modeMeta, DIFFS, diffMeta, buildRounds, roundsFor, isOrderMode, MIN_POOL, rankSeats, winnerSeat, scoreOf } from './engine.js';
import { loadData, filterIds, decadeList, genreList, filterLabel } from './data.js';
import { createMode, renderReview, hidePanels } from './modes.js';
import {
  createRoom, joinRoom, fetchRoom, fetchMyRooms, updateRoomStatus,
  finishRoom, RoomConnection, triggerPush, seatName, seatLeft, markPlayerLeft,
} from './net.js';
import { createRematch } from '../../shared/rematch.js';
import { createQuizGame } from '../../shared/quiz-game.js';
import { configReady, GAME_SLUG } from './config.js';
import { cachedUser, onAuthChange, displayName, signOut } from '../../shared/auth.js';
import { openHistory } from '../../shared/history.js';
import { filterDismissed, dismissGame, makeDismissControl } from '../../shared/dismissed-games.js';
import { getGuestName } from '../../shared/guest-name.js';
import {
  registerServiceWorker, requestNotifications, isEnabled as notifyEnabled,
  subscribeToPush, notificationsSupported, notificationPermission,
} from './notify.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const validFilters = (data, f) => f && typeof f === 'object'
  && ['all', 'm', 'v'].includes(f.type)
  && (f.decade === 'all' || decadeList(data).includes(f.decade))
  && (f.genre === 'all' || genreList(data).includes(f.genre));
const poolLen = (data, sel) => filterIds(data, sel.f).length;

createQuizGame({
  slug: GAME_SLUG, gameName: 'Buffz', maxPlayers: 5, stageId: 'q-stage',
  net: {
    createRoom, joinRoom, fetchRoom, fetchMyRooms, updateRoomStatus,
    finishRoom, RoomConnection, triggerPush, seatName, seatLeft, markPlayerLeft,
  },
  engine: { modeMeta, diffMeta, rankSeats, winnerSeat, scoreOf },
  createRematch,
  loadData,
  createMode: (modeId, opts) => createMode(modeId, opts),
  renderReview, hidePanels,

  displayName, getGuestName, signOut, cachedUser, onAuthChange, configReady,
  openHistory, filterDismissed, dismissGame, makeDismissControl,
  registerServiceWorker, requestNotifications, notifyEnabled, subscribeToPush,
  notificationsSupported, notificationPermission,
  dataError: (e) => `Could not load title data (${e.message}).`,

  // ---- Prestart: pool filters + mode + difficulty ----
  initCfgSel: () => ({ f: { type: 'all', decade: 'all', genre: 'all' }, mode: null, diff: 'medium' }),
  loadCfgInto(data, sel, c) {
    if (validFilters(data, c.f)) sel.f = c.f;
    if (modeMeta(c.mode)) sel.mode = c.mode;
    if (diffMeta(c.diff)) sel.diff = c.diff;
  },
  buildCfgButtons(data, { onPick, commit, canPick, sel }) {
    // Three pool filters are dropdowns ("All" default) — the host mixes and
    // narrows; the live count (rendered in markSelected) shows the result.
    const fill = (el, opts) => {
      el.innerHTML = '';
      for (const [val, label] of opts) {
        const o = document.createElement('option');
        o.value = val; o.textContent = label;
        el.appendChild(o);
      }
    };
    fill($('f-type'), [['all', 'All'], ['m', 'Movies'], ['v', 'TV shows']]);
    fill($('f-decade'), [['all', 'All decades'], ...decadeList(data).map((d) => [d, d])]);
    fill($('f-genre'), [['all', 'All genres'], ...genreList(data).map((g) => [g, g])]);
    for (const key of ['type', 'decade', 'genre']) {
      $(`f-${key}`).addEventListener('change', (e) => {
        if (!canPick()) return;
        sel.f = { ...sel.f, [key]: e.target.value };
        commit();
      });
    }
    const mk = (host, defs, key) => {
      host.innerHTML = '';
      for (const d of defs) {
        const b = document.createElement('button');
        b.className = 'cfg-btn';
        b.dataset.val = d.id;
        b.dataset.key = key;
        b.innerHTML = d.tagline ? `<span>${esc(d.name)}</span><small>${esc(d.tagline)}</small>` : esc(d.name);
        b.addEventListener('click', () => { if (canPick()) onPick(key, d.id); });
        host.appendChild(b);
      }
    };
    mk($('cfg-modes'), MODES, 'mode');
    mk($('cfg-diffs'), DIFFS, 'diff');
  },
  markSelected(sel, { host, data }) {
    // Sync the dropdowns (rematch/config restore), disable them for guests, and
    // render the live pool count.
    for (const key of ['type', 'decade', 'genre']) {
      const el = $(`f-${key}`);
      el.value = sel.f[key];
      el.disabled = !host;
    }
    const pool = poolLen(data, sel);
    const enough = pool >= MIN_POOL;
    const countEl = $('pool-count');
    countEl.textContent = enough ? `${pool} titles in play`
      : pool ? `Only ${pool} titles — loosen the filters (need ${MIN_POOL}+)`
      : 'No titles match — loosen the filters';
    countEl.classList.toggle('short', !enough);
    for (const b of document.querySelectorAll('.cfg-btn')) b.classList.toggle('on', sel[b.dataset.key] === b.dataset.val);
  },
  pickTitle: 'FILTER THE POOL, PICK A MODE',
  pickPrompt: 'Filter the pool, then pick a mode and a difficulty.',
  cfgSummary(data, sel) {
    this._data = data; // cache for markSelected's live pool count
    const m = modeMeta(sel.mode), d = diffMeta(sel.diff);
    if (!m || !d) return '';
    return `${esc(filterLabel(sel.f))} — ${esc(m.name)} — ${esc(d.name)}`;
  },
  cfgComplete(data, sel) {
    this._data = data;
    return !!this.cfgSummary(data, sel) && poolLen(data, sel) >= MIN_POOL;
  },
  diffEffect(data, sel) {
    const m = modeMeta(sel.mode), d = diffMeta(sel.diff);
    if (!m || !d) return '';
    const len = poolLen(data, sel);
    if (len < MIN_POOL) return '';
    const rounds = roundsFor(m.id, d, len);
    if (isOrderMode(m.id)) return `Sort ${Math.min(d.n, len)} at a time · ${rounds} round${rounds === 1 ? '' : 's'}`;
    return `${rounds} question${rounds === 1 ? '' : 's'} · up to ${d.n} options each`;
  },
  readyNote: (data) => (data?.sample ? '<br><span class="start-note">⚠ Sample data — run tools/build-data.mjs for the full TMDb pool.</span>' : ''),

  // ---- Payload <-> rounds ----
  startPayload: (sel) => ({ f: sel.f, mode: sel.mode, diff: sel.diff }),
  payloadValid: (data, p) => !!(validFilters(data, p.f) && modeMeta(p.mode) && diffMeta(p.diff)),
  buildRounds: (data, p, seed) => buildRounds(p.mode, diffMeta(p.diff), filterIds(data, p.f), seed, data.items),
  modeChipLabel: (data, p) => `${filterLabel(p.f)} · ${modeMeta(p.mode).name}`,
  resultMeta: (p) => ({ f: p.f, mode: p.mode, diff: p.diff }),
  historyDetail(data, r) {
    if (!r.mode && !r.f) return '';
    return [filterLabel(r.f), modeMeta(r.mode)?.name || r.mode, diffMeta(r.diff)?.name].filter(Boolean).join(' · ');
  },
});
