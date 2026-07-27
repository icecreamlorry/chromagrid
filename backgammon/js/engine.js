// Backgammon engine — deterministic board state folded from an ordered move log.
//
// The dice are the interesting part: because the engine is pure and both clients
// must agree, dice are NOT a per-client random. Each turn's dice are derived from
// the room seed + a turn index via shared/dice.js, so every client computes the
// same faces and nobody can pick favourable rolls. A turn is ONE move-log entry
// containing the whole sequence of checker steps; the engine validates the
// sequence against that turn's dice (legal steps, bar entry first, hitting,
// bearing off) and enforces that the player used the MAXIMUM number of dice
// possible (the core backgammon obligation).
//
// Board: 24 points as a signed array — board[i] > 0 is that many seat-0 checkers,
// board[i] < 0 is |value| seat-1 checkers. `bar[seat]` and `off[seat]` hold
// checkers on the bar / borne off. Seat 0 moves from index 23 toward 0 (home =
// indices 0–5, bears off past 0); seat 1 moves 0 → 23 (home = 18–23, bears off
// past 23). Which seat moves first is decided by the opening roll (from the seed).

import { rollDice, openingRoll } from '../../shared/dice.js';

const sign = (seat) => (seat === 0 ? 1 : -1);
const ownerAt = (board, i) => (board[i] > 0 ? 0 : board[i] < 0 ? 1 : null);
const countAt = (board, i) => Math.abs(board[i]);
const isBlocked = (board, i, seat) => ownerAt(board, i) === 1 - seat && countAt(board, i) >= 2;

export function initialBoard() {
  const b = Array(24).fill(0);
  b[23] = 2; b[12] = 5; b[7] = 3; b[5] = 5;      // seat 0 (+)
  b[0] = -2; b[11] = -5; b[16] = -3; b[18] = -5; // seat 1 (−)
  return b;
}

// Home indices for a seat.
const inHome = (seat, i) => (seat === 0 ? i >= 0 && i <= 5 : i >= 18 && i <= 23);

// Are all of `seat`'s checkers in the home board (or already off), bar empty?
function allHome(board, bar, seat) {
  if (bar[seat] > 0) return false;
  for (let i = 0; i < 24; i++) {
    if (ownerAt(board, i) === seat && !inHome(seat, i)) return false;
  }
  return true;
}

// The dice (pip values) available on turn `t`: opening roll on turn 0 (never
// doubles), otherwise a fresh roll (doubles → four of the value).
export function turnPips(seed, t) {
  if (t === 0) { const o = openingRoll(seed); return [o.a, o.b]; }
  const [a, b] = rollDice(seed, t);
  return a === b ? [a, a, a, a] : [a, b];
}
export function startingSeat(seed) { return openingRoll(seed).firstIsA ? 0 : 1; }

const removeDie = (dice, d) => { const i = dice.indexOf(d); const c = dice.slice(); if (i >= 0) c.splice(i, 1); return c; };

// Validate one step for `seat` given board/bar/off and the multiset of remaining
// dice. Returns { die } if legal, else null. A step is { from, to } where `from`
// is a point index or 'bar', and `to` is a point index or 'off'.
function stepLegal(board, bar, off, seat, step, dice) {
  if (bar[seat] > 0 && step.from !== 'bar') return null;

  if (step.from === 'bar') {
    if (bar[seat] === 0 || typeof step.to !== 'number') return null;
    if (!inHome(1 - seat, step.to)) return null; // enter in the opponent's home
    const d = seat === 0 ? 24 - step.to : step.to + 1;
    if (!dice.includes(d) || isBlocked(board, step.to, seat)) return null;
    return { die: d };
  }

  if (typeof step.from !== 'number' || ownerAt(board, step.from) !== seat) return null;

  if (step.to === 'off') {
    if (!allHome(board, bar, seat)) return null;
    const need = seat === 0 ? step.from + 1 : 24 - step.from;
    if (dice.includes(need)) return { die: need };
    // Overshoot: a larger die may bear off only if no checker sits further from
    // the edge (a higher pip distance) than this one.
    const larger = dice.filter((x) => x > need);
    if (!larger.length) return null;
    if (seat === 0) { for (let i = step.from + 1; i <= 5; i++) if (ownerAt(board, i) === 0) return null; }
    else { for (let i = step.from - 1; i >= 18; i--) if (ownerAt(board, i) === 1) return null; }
    return { die: Math.min(...larger) };
  }

  if (typeof step.to !== 'number' || step.to < 0 || step.to > 23) return null;
  const d = seat === 0 ? step.from - step.to : step.to - step.from;
  if (d <= 0 || !dice.includes(d) || isBlocked(board, step.to, seat)) return null;
  return { die: d };
}

// Apply a legal step to copies; returns { board, bar, off, hit }.
function doStep(board, bar, off, seat, step) {
  const nb = board.slice(); const nbar = bar.slice(); const noff = off.slice();
  const s = sign(seat); const opp = 1 - seat;
  if (step.from === 'bar') nbar[seat] -= 1; else nb[step.from] -= s;
  let hit = false;
  if (step.to === 'off') { noff[seat] += 1; }
  else {
    if (ownerAt(nb, step.to) === opp && countAt(nb, step.to) === 1) { nb[step.to] = 0; nbar[opp] += 1; hit = true; }
    nb[step.to] += s;
  }
  return { board: nb, bar: nbar, off: noff, hit };
}

// All legal single steps for `seat` given remaining dice.
export function legalStepList(board, bar, off, seat, dice) {
  const steps = [];
  const distinct = [...new Set(dice)];
  if (bar[seat] > 0) {
    for (const d of distinct) {
      const to = seat === 0 ? 24 - d : d - 1;
      if (to < 0 || to > 23) continue;
      if (stepLegal(board, bar, off, seat, { from: 'bar', to }, dice)) steps.push({ from: 'bar', to, die: d });
    }
    return steps;
  }
  for (let i = 0; i < 24; i++) {
    if (ownerAt(board, i) !== seat) continue;
    for (const d of distinct) {
      const to = seat === 0 ? i - d : i + d;
      if (to >= 0 && to <= 23) { const r = stepLegal(board, bar, off, seat, { from: i, to }, dice); if (r) steps.push({ from: i, to, die: r.die }); }
    }
    const rOff = stepLegal(board, bar, off, seat, { from: i, to: 'off' }, dice);
    if (rOff) steps.push({ from: i, to: 'off', die: rOff.die });
  }
  return steps;
}

// The maximum number of dice any legal sequence can consume from here.
function maxDiceUsable(board, bar, off, seat, dice) {
  if (!dice.length) return 0;
  const steps = legalStepList(board, bar, off, seat, dice);
  if (!steps.length) return 0;
  let best = 0;
  for (const st of steps) {
    const r = doStep(board, bar, off, seat, st);
    best = Math.max(best, 1 + maxDiceUsable(r.board, r.bar, r.off, seat, removeDie(dice, st.die)));
    if (best === dice.length) break;
  }
  return best;
}

// ---- Game state ------------------------------------------------------------

export function newGameState(seed) {
  const first = startingSeat(seed);
  return {
    seed,
    tpm: 0,
    board: initialBoard(),
    bar: [0, 0],
    off: [0, 0],
    turn: null,           // seat to move, or null before start
    turnIndex: 0,         // which turn number (drives the dice)
    started: false,
    moveCount: 0,
    lastMove: null,
    gameOver: false,
    winner: null,
    endDetail: null,
    _firstSeat: first,
  };
}

// Colours for display (seat 0 = light, seat 1 = dark).
export function colorForSeat(state, seat) { return seat === 0 ? 'w' : 'b'; }
export function colorOf(state, seat) { return colorForSeat(state, seat); }

// The dice pips available to the side to move this turn.
export function currentDice(state) {
  if (!state.started || state.gameOver || state.turn == null) return [];
  return turnPips(state.seed, state.turnIndex);
}

// Pip count (distance for all of a seat's checkers to bear off) — a race gauge.
export function pipCount(state, seat) {
  let n = state.bar[seat] * 25;
  for (let i = 0; i < 24; i++) {
    if (ownerAt(state.board, i) !== seat) continue;
    const dist = seat === 0 ? i + 1 : 24 - i;
    n += countAt(state.board, i) * dist;
  }
  return n;
}

export function legalStepsNow(state) {
  if (!state.started || state.gameOver) return [];
  return legalStepList(state.board, state.bar, state.off, state.turn, currentDice(state));
}
export function maxDiceNow(state) {
  return maxDiceUsable(state.board, state.bar, state.off, state.turn, currentDice(state));
}

function classifyWin(board, bar, off, winner) {
  const loser = 1 - winner;
  if (off[loser] > 0) return 'single';
  // Gammon (loser bore off none); backgammon if a loser checker is on the bar or
  // in the winner's home board.
  if (bar[loser] > 0) return 'backgammon';
  for (let i = 0; i < 24; i++) if (ownerAt(board, i) === loser && inHome(winner, i)) return 'backgammon';
  return 'gammon';
}

export function applyMove(state, move) {
  if (move.move_index !== state.moveCount) {
    throw new Error(`Move ${move.move_index} applied out of order (expected ${state.moveCount})`);
  }
  const seat = move.player;
  const payload = move.payload || {};

  switch (move.type) {
    case 'start': {
      state.board = initialBoard();
      state.bar = [0, 0]; state.off = [0, 0];
      state.tpm = payload.tpm || 0;
      state.started = true;
      state.turnIndex = 0;
      state.turn = state._firstSeat;
      state.lastMove = { type: 'start', player: seat, first: state._firstSeat, dice: turnPips(state.seed, 0) };
      break;
    }
    case 'move': {
      if (seat !== state.turn) throw new Error('Move played out of turn in log');
      const pips = currentDice(state);
      const steps = payload.steps || [];
      let board = state.board, bar = state.bar, off = state.off, dice = pips.slice();
      const applied = [];
      for (const step of steps) {
        const r = stepLegal(board, bar, off, seat, step, dice);
        if (!r) throw new Error('Illegal backgammon step in log');
        const d = doStep(board, bar, off, seat, { ...step });
        board = d.board; bar = d.bar; off = d.off; dice = removeDie(dice, r.die);
        applied.push({ from: step.from, to: step.to, die: r.die, hit: d.hit });
      }
      // Must use the maximum number of dice possible.
      const maxUse = maxDiceUsable(state.board, state.bar, state.off, seat, pips);
      if (steps.length !== maxUse) throw new Error('Move must use the maximum number of dice');
      // When only one die can be played, it must be the higher one if that is
      // itself playable from the start.
      if (maxUse === 1 && pips.length === 2 && pips[0] !== pips[1]) {
        const hi = Math.max(...pips);
        const canHi = legalStepList(state.board, state.bar, state.off, seat, pips).some((s) => s.die === hi);
        if (canHi && applied[0].die !== hi) throw new Error('Must play the higher die');
      }

      state.board = board; state.bar = bar; state.off = off;
      state.lastMove = { type: 'move', player: seat, steps: applied, dice: pips.slice() };
      if (off[seat] === 15) {
        state.gameOver = true; state.winner = seat;
        state.endDetail = { reason: 'borne-off', margin: classifyWin(board, bar, off, seat) };
      } else {
        state.turnIndex += 1;
        state.turn = 1 - seat;
      }
      break;
    }
    case 'resign': {
      state.gameOver = true; state.winner = 1 - seat;
      state.endDetail = { reason: 'resign', resignedPlayer: seat };
      state.lastMove = { type: 'resign', player: seat };
      break;
    }
    case 'timeout': {
      const flagged = payload.player ?? seat;
      state.gameOver = true; state.winner = 1 - flagged;
      state.endDetail = { reason: 'timeout', flaggedPlayer: flagged };
      state.lastMove = { type: 'timeout', player: flagged };
      break;
    }
    default:
      throw new Error(`Unknown move type: ${move.type}`);
  }
  state.moveCount += 1;
  return state;
}

export function replayMoves(seed, moves) {
  const state = newGameState(seed);
  const ordered = [...moves].sort((a, b) => a.move_index - b.move_index);
  for (const m of ordered) {
    if (m.type === 'rematch') continue;
    applyMove(state, m);
  }
  return state;
}

// Validate + apply a single step, for the UI to build a turn locally. Returns
// { board, bar, off, die, hit } or null if the step is illegal.
export function stepResult(board, bar, off, seat, step, dice) {
  const legal = stepLegal(board, bar, off, seat, step, dice);
  if (!legal) return null;
  const r = doStep(board, bar, off, seat, step);
  return { ...r, die: legal.die };
}

export { ownerAt, countAt, inHome, allHome, maxDiceUsable };
