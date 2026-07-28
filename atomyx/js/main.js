// Atomyx — periodic-table guessing games. The whole landing/lobby/room/results
// flow lives in shared/quiz-game.js; this file is just the Atomyx-specific
// config: its engine tables, element data, the set+mode+difficulty picker, and
// how a picked config becomes a `start` payload + seeded rounds. Gameplay (each
// mode's rendering) is modes.js; element data is data.js.
//
// Multiplayer model: the host's `start` move (index 0) carries
// { set, mode, diff, startAt }; everyone races identical seeded rounds; each
// seat submits ONE sparse `result` move (index 10+seat).

import { MODES, modeMeta, DIFFS, diffMeta, buildRounds, roundsFor, rankSeats, winnerSeat, scoreOf } from './engine.js';
import { loadData, setMetaOf, setEls } from './data.js';
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

createQuizGame({
  slug: GAME_SLUG, gameName: 'Atomyx', maxPlayers: 5, stageId: 'table-stage',
  net: {
    createRoom, joinRoom, fetchRoom, fetchMyRooms, updateRoomStatus,
    finishRoom, RoomConnection, triggerPush, seatName, seatLeft, markPlayerLeft,
  },
  engine: { modeMeta, diffMeta, rankSeats, winnerSeat, scoreOf },
  createRematch,
  loadData,
  // SWEEP/BUILD need the whole set of ids to render a blank table.
  createMode: (modeId, opts, { data, payload }) => createMode(modeId, { ...opts, setIds: setEls(data, payload.set) }),
  renderReview, hidePanels,

  displayName, getGuestName, signOut, cachedUser, onAuthChange, configReady,
  openHistory, filterDismissed, dismissGame, makeDismissControl,
  registerServiceWorker, requestNotifications, notifyEnabled, subscribeToPush,
  notificationsSupported, notificationPermission,
  dataError: (e) => `Could not load element data (${e.message}).`,

  // ---- Prestart: set + mode + difficulty ----
  initCfgSel: () => ({ set: null, mode: null, diff: 'medium' }),
  loadCfgInto(data, sel, c) {
    if (data && setMetaOf(data, c.set)) sel.set = c.set;
    if (modeMeta(c.mode)) sel.mode = c.mode;
    if (diffMeta(c.diff)) sel.diff = c.diff;
  },
  buildCfgButtons(data, { onPick, canPick }) {
    const mk = (host, defs, key) => {
      host.innerHTML = '';
      for (const d of defs) {
        const b = document.createElement('button');
        b.className = 'cfg-btn';
        b.dataset.val = d.id;
        b.dataset.key = key;
        b.innerHTML = d.tagline ? `<span>${esc(d.name)}</span><small>${esc(d.tagline)}</small>` : esc(d.label ?? d.name);
        b.addEventListener('click', () => { if (canPick()) onPick(key, d.id); });
        host.appendChild(b);
      }
    };
    mk($('cfg-sets'), data.sets.map((s) => ({ id: s.id, label: `${s.label} · ${s.els.split(' ').length}` })), 'set');
    mk($('cfg-modes'), MODES, 'mode');
    mk($('cfg-diffs'), DIFFS, 'diff');
  },
  markSelected(sel) {
    for (const b of document.querySelectorAll('.cfg-btn')) b.classList.toggle('on', sel[b.dataset.key] === b.dataset.val);
  },
  pickTitle: 'PICK A SET, MODE & DIFFICULTY',
  pickPrompt: 'Pick a set, a mode and a difficulty.',
  cfgSummary(data, sel) {
    const s = setMetaOf(data, sel.set), m = modeMeta(sel.mode), d = diffMeta(sel.diff);
    if (!s || !m || !d) return '';
    return `${esc(s.label)} — ${esc(m.name)} — ${esc(d.name)}`;
  },
  cfgComplete(data, sel) { return !!this.cfgSummary(data, sel); },
  // Spell out exactly what the chosen difficulty does for the chosen mode, so the
  // dial is never silently inert (the whole point of this feature).
  diffEffect(data, sel) {
    const s = setMetaOf(data, sel.set), m = modeMeta(sel.mode), d = diffMeta(sel.diff);
    if (!s || !m || !d) return '';
    const len = s.els.split(' ').length;
    if (m.id === 'sweep') return `Whole set (${len}) — difficulty doesn’t apply`;
    const rounds = roundsFor(m.id, d, len);
    if (m.id === 'mass') {
      const cards = d.n ? Math.min(d.n, len) : len;
      return `Sort ${cards} at a time · ${rounds} round${rounds === 1 ? '' : 's'}`;
    }
    if (m.id === 'lineup') {
      const opts = d.n && d.n < len ? d.n : len;
      return `${rounds} question${rounds === 1 ? '' : 's'} · ${opts} options each`;
    }
    return `${rounds} question${rounds === 1 ? '' : 's'}`;
  },

  // ---- Payload <-> rounds ----
  startPayload: (sel) => ({ set: sel.set, mode: sel.mode, diff: sel.diff }),
  payloadValid: (data, p) => !!(setMetaOf(data, p.set) && modeMeta(p.mode) && diffMeta(p.diff)),
  buildRounds: (data, p, seed) => buildRounds(p.mode, diffMeta(p.diff), setEls(data, p.set), seed),
  modeChipLabel: (data, p) => `${setMetaOf(data, p.set).label} · ${modeMeta(p.mode).name}`,
  resultMeta: (p) => ({ set: p.set, mode: p.mode, diff: p.diff }),
  historyDetail(data, r) {
    if (!data || (!r.set && !r.mode)) return '';
    return [setMetaOf(data, r.set)?.label || r.set, modeMeta(r.mode)?.name || r.mode, diffMeta(r.diff)?.name]
      .filter(Boolean).join(' · ');
  },
});
