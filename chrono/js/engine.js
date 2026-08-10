// chrono/js/engine.js — pure deterministic Chrono quiz engine

import { seededShuffle, gradeOrder as quizGradeOrder } from '../../shared/quiz-engine.js';

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
  return quizGradeOrder(orderKey, placedIds, datasetById);
}
