// chrono/js/main.js — Chrono quiz application main entry point

import { createQuizGame } from '../../shared/quiz-game.js';
import { loadEvents } from './dataset.js';
import { buildRounds, gradeOrder } from './engine.js';
import { configReady, GAME_SLUG } from './config.js';
import {
  createRoom, joinRoom, fetchRoom, fetchMoves, fetchMyRooms, updateRoomStatus,
  finishRoom, RoomConnection, triggerPush, seatName, seatLeft, markPlayerLeft,
} from './net.js';
import { cachedUser, onAuthChange, displayName } from '../../shared/auth.js';
import { filterDismissed, dismissGame, makeDismissControl } from '../../shared/dismissed-games.js';

createQuizGame({
  slug: GAME_SLUG,
  name: 'Chrono',
  stageId: 'chrono-stage',
  maxPlayers: 5,
  loadData: loadEvents,
  buildRounds: (data, seed, cfg) => buildRounds(data, seed, cfg?.count ?? 10),
  historyDetail: (data, result) => `${result?.score || 0} pts`,
  configReady,
  cachedUser,
  onAuthChange,
  createRoom,
  joinRoom,
  fetchRoom,
  fetchMoves,
  fetchMyRooms,
  updateRoomStatus,
  finishRoom,
  RoomConnection,
  triggerPush,
  seatName,
  seatLeft,
  markPlayerLeft,
  filterDismissed,
  dismissGame,
  makeDismissControl,
  registerServiceWorker: () => {},
  notifyEnabled: () => false,
  subscribeToPush: async () => {},
  payloadValid: () => true,
});
