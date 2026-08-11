// chrono/js/engine.js — pure deterministic Chrono quiz engine

import {
  seededShuffle, gradeOrder as quizGradeOrder,
  scoreOf, compareResults, rankSeats, winnerSeat,
} from '../../shared/quiz-engine.js';

// The shared ranking is the contract quiz-game.js expects: numeric seats, a
// 'tie' winner, and seats that never submitted still listed. Re-export, never
// re-implement.
export { scoreOf, compareResults, rankSeats, winnerSeat };

export function orderKey(item) {
  return item ? item.year : 0;
}

export function buildRounds(dataset, seed, count = 10) {
  const shuffled = seededShuffle(dataset, seed);
  const rounds = [];

  for (let i = 0; i < count && (i + 1) * 4 <= shuffled.length; i++) {
    const items = shuffled.slice(i * 4, (i + 1) * 4);
    const expected = items.slice().sort((a, b) => a.year - b.year);
    rounds.push({ items, expected });
  }

  return rounds;
}

export function gradeOrder(placedIds, datasetById) {
  const graded = quizGradeOrder(orderKey, placedIds, datasetById);
  // A result move can carry any id string. An id that isn't in the dataset
  // takes orderKey's 0 fallback, which would sort first and score — never let
  // an unknown id count as a correct placement.
  return graded.map((correct, i) => correct && !!datasetById[placedIds[i]]);
}
