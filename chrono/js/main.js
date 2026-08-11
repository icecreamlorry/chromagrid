// chrono/js/main.js — Chrono quiz application main entry point matching Quiz Games group standards

import { buildRounds, gradeOrder, orderKey } from './engine.js';
import { loadEvents } from './dataset.js';
import { createMode, renderReview, hidePanels } from './modes.js';
import {
  createRoom, joinRoom, fetchRoom, fetchMoves, fetchMyRooms, updateRoomStatus,
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

export function modeMeta(id) {
  const modes = {
    timeline: { id: 'timeline', name: 'Timeline', prompt: 'Sort events chronologically:' }
  };
  return modes[id] || modes.timeline;
}

export function diffMeta(id) {
  const diffs = {
    medium: { id: 'medium', name: 'Standard', desc: '10 Rounds' }
  };
  return diffs[id] || diffs.medium;
}

function scoreOf(result) {
  return result?.score ?? 0;
}

function rankSeats(results = {}) {
  return Object.keys(results).sort((a, b) => (results[b]?.score || 0) - (results[a]?.score || 0));
}

function winnerSeat(results = {}) {
  const ranked = rankSeats(results);
  return ranked.length ? ranked[0] : null;
}

createQuizGame({
  slug: GAME_SLUG,
  gameName: 'Chrono',
  stageId: 'chrono-stage',
  maxPlayers: 5,
  loadData: loadEvents,
  createMode,
  renderReview,
  hidePanels,
  net: {
    createRoom, joinRoom, fetchRoom, fetchMyRooms, updateRoomStatus,
    finishRoom, RoomConnection, triggerPush, seatName, seatLeft, markPlayerLeft,
  },
  engine: {
    modeMeta, diffMeta, rankSeats, winnerSeat, scoreOf,
  },
  initCfgSel: () => ({ mode: 'timeline', diff: 'medium' }),
  loadCfgInto: () => {},
  buildCfgButtons: () => {},
  markSelected: () => {},
  pickTitle: () => 'CHRONO RACE',
  cfgSummary: () => '10 Rounds Chronological Sort',
  cfgComplete: () => true,
  diffEffect: () => '',
  startPayload: () => ({ mode: 'timeline', diff: 'medium', count: 10 }),
  payloadValid: () => true,
  modeChipLabel: () => 'TIMELINE',
  buildRounds: (data, seed, payload) => buildRounds(data, seed, payload?.count ?? 10),
  historyDetail: (data, result) => `${result?.score || 0} pts`,
  configReady,
  cachedUser,
  onAuthChange,
  displayName,
  getGuestName,
  signOut,
  openHistory,
  createRematch,
  filterDismissed,
  dismissGame,
  makeDismissControl,
  registerServiceWorker,
  requestNotifications,
  notifyEnabled,
  subscribeToPush,
  notificationsSupported,
  notificationPermission,
});
