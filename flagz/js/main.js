// Flagz — flag guessing games. The whole landing/lobby/room/results flow lives
// in shared/quiz-game.js; this file is just the Flagz-specific config: its
// engine tables, country data, the region+mode+difficulty picker, and how a
// picked config becomes a `start` payload + seeded rounds. Gameplay (each mode's
// rendering) is modes.js; country data is data.js.
//
// Multiplayer model: the host's `start` move (index 0) carries
// { region, mode, diff, startAt }; everyone races identical seeded rounds; each
// seat submits ONE sparse `result` move (index 10+seat).

import { MODES, modeMeta, DIFFS, diffMeta, buildRounds, roundsFor, isOrderMode, rankSeats, winnerSeat, scoreOf } from './engine.js';
import { loadData, regionMetaOf, regionIso } from './data.js';
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
  slug: GAME_SLUG, gameName: 'Flagz', maxPlayers: 5, stageId: 'flag-stage',
  net: {
    createRoom, joinRoom, fetchRoom, fetchMyRooms, updateRoomStatus,
    finishRoom, RoomConnection, triggerPush, seatName, seatLeft, markPlayerLeft,
  },
  engine: { modeMeta, diffMeta, rankSeats, winnerSeat, scoreOf },
  createRematch,
  loadData,
  createMode: (modeId, opts) => createMode(modeId, opts),
  renderReview, hidePanels,

  // shared-layer plumbing
  displayName, getGuestName, signOut, cachedUser, onAuthChange, configReady,
  openHistory, filterDismissed, dismissGame, makeDismissControl,
  registerServiceWorker, requestNotifications, notifyEnabled, subscribeToPush,
  notificationsSupported, notificationPermission,
  dataError: (e) => `Could not load country data (${e.message}).`,

  // ---- Prestart: region + mode + difficulty ----
  initCfgSel: () => ({ region: null, mode: null, diff: 'medium' }),
  loadCfgInto(data, sel, c) {
    if (data && regionMetaOf(data, c.region)) sel.region = c.region;
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
    mk($('cfg-regions'), data.regions.map((r) => ({ id: r.id, label: `${r.label} · ${r.iso.split(' ').length}` })), 'region');
    mk($('cfg-modes'), MODES, 'mode');
    mk($('cfg-diffs'), DIFFS, 'diff');
  },
  markSelected(sel) {
    for (const b of document.querySelectorAll('.cfg-btn')) b.classList.toggle('on', sel[b.dataset.key] === b.dataset.val);
  },
  pickTitle: 'PICK A REGION, MODE & DIFFICULTY',
  pickPrompt: 'Pick a region, a mode and a difficulty.',
  cfgSummary(data, sel) {
    const r = regionMetaOf(data, sel.region), m = modeMeta(sel.mode), d = diffMeta(sel.diff);
    if (!r || !m || !d) return '';
    return `${esc(r.label)} — ${esc(m.name)} — ${esc(d.name)}`;
  },
  cfgComplete(data, sel) { return !!this.cfgSummary(data, sel); },
  // Spell out what the chosen difficulty does for the chosen mode, so the dial is
  // never silently inert (namedrop's difficulty used to do nothing at all).
  diffEffect(data, sel) {
    const r = regionMetaOf(data, sel.region), m = modeMeta(sel.mode), d = diffMeta(sel.diff);
    if (!r || !m || !d) return '';
    const len = r.iso.split(' ').length;
    const rounds = roundsFor(m.id, d, len);
    if (isOrderMode(m.id)) {
      const flags = d.n ? Math.min(d.n, len) : len;
      return `Sort ${flags} at a time · ${rounds} round${rounds === 1 ? '' : 's'}`;
    }
    if (m.id === 'namedrop') return `${rounds} question${rounds === 1 ? '' : 's'}`;
    const opts = d.n && d.n < len ? d.n : len;
    return `${rounds} questions · ${opts} ${m.id === 'spotter' ? 'flags' : 'options'} each`;
  },

  // ---- Payload <-> rounds ----
  startPayload: (sel) => ({ region: sel.region, mode: sel.mode, diff: sel.diff }),
  payloadValid: (data, p) => !!(regionMetaOf(data, p.region) && modeMeta(p.mode) && diffMeta(p.diff)),
  buildRounds: (data, p, seed) => buildRounds(p.mode, diffMeta(p.diff), regionIso(data, p.region), seed),
  modeChipLabel: (data, p) => `${regionMetaOf(data, p.region).label} · ${modeMeta(p.mode).name}`,
  resultMeta: (p) => ({ region: p.region, mode: p.mode, diff: p.diff }),
  historyDetail(data, r) {
    if (!data || (!r.region && !r.mode)) return '';
    return [regionMetaOf(data, r.region)?.label || r.region, modeMeta(r.mode)?.name || r.mode, diffMeta(r.diff)?.name]
      .filter(Boolean).join(' · ');
  },
});
