// chrono/js/main.js — Chrono main controller leveraging shared/quiz-game.js

import { createQuizGame } from '../../shared/quiz-game.js';
import { loadEvents } from './dataset.js';
import { buildRounds, gradeOrder } from './engine.js';
import { GAME_SLUG } from './config.js';

createQuizGame({
  slug: GAME_SLUG,
  name: 'Chrono',
  stageId: 'chrono-stage',
  maxPlayers: 5,
  loadData: loadEvents,
  buildRounds: (data, seed, cfg) => buildRounds(data, seed, cfg?.count ?? 10),
  historyDetail: (data, result) => `${result?.score || 0} pts`,
  dismissGame: () => {},
  registerServiceWorker: () => {},
  notifyEnabled: () => false,
  subscribeToPush: async () => {},
  payloadValid: () => true,
});
