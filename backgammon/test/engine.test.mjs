// Backgammon engine tests. Run: node backgammon/test/engine.test.mjs

import {
  initialBoard, newGameState, applyMove, replayMoves, currentDice, pipCount,
  legalStepList, maxDiceUsable, startingSeat, turnPips, ownerAt, countAt,
} from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eqNum = (m, g, w) => ok(g === w, `${m} (got ${g}, want ${w})`);

// Find a turn index for `seed` whose dice (sorted) match `want` (e.g. '1,3').
function findTurn(seed, want) {
  for (let t = 1; t < 200000; t++) {
    const p = turnPips(seed, t);
    if (p.length === 2 && [p[0], p[1]].slice().sort((a, b) => a - b).join() === want) return t;
  }
  throw new Error('no turn with dice ' + want);
}
// Craft a started state with a custom position.
function craft({ board, bar = [0, 0], off = [0, 0], turn = 0, turnIndex = 1, seed = 1 }) {
  const s = newGameState(seed);
  s.started = true; s.board = board; s.bar = bar; s.off = off; s.turn = turn; s.turnIndex = turnIndex; s.moveCount = turnIndex + 1;
  return s;
}

// ---- Setup & pip count ------------------------------------------------------
{
  const b = initialBoard();
  let w = 0, bl = 0;
  for (let i = 0; i < 24; i++) { if (b[i] > 0) w += b[i]; else bl += -b[i]; }
  eqNum('seat 0 has 15 checkers', w, 15);
  eqNum('seat 1 has 15 checkers', bl, 15);
  const s = newGameState(3);
  eqNum('start pip count seat 0', pipCount(s, 0), 167);
  eqNum('start pip count seat 1', pipCount(s, 1), 167);
}

// ---- Opening roll: deterministic, never doubles, decides first player -------
{
  for (let seed = 0; seed < 50; seed++) {
    const p = turnPips(seed, 0);
    ok(p.length === 2 && p[0] !== p[1], `opening not doubles @${seed}`);
    ok(startingSeat(seed) === 0 || startingSeat(seed) === 1, `first seat defined @${seed}`);
  }
}

// ---- Start move sets the position + first mover -----------------------------
{
  const s = newGameState(7);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: { tpm: 600 } });
  ok(s.started && s.turn === startingSeat(7), 'start: first mover from opening roll');
  eqNum('start: tpm carried', s.tpm, 600);
  eqNum('start: dice are the opening roll length', currentDice(s).length, 2);
}

// ---- Bar entry is forced ----------------------------------------------------
{
  const b = Array(24).fill(0);
  b[10] = 1;              // seat 0 checker on the board
  const s = craft({ board: b, bar: [1, 0], turn: 0 });
  const steps = legalStepList(s.board, s.bar, s.off, 0, [3, 4]);
  ok(steps.length > 0 && steps.every((st) => st.from === 'bar'), 'with a checker on the bar, only bar entries are legal');
}

// ---- Blocked entry point ----------------------------------------------------
{
  const b = Array(24).fill(0);
  b[21] = -2;             // seat 1 holds the die-3 entry point for seat 0 (24-3=21)
  const s = craft({ board: b, bar: [1, 0], turn: 0 });
  ok(legalStepList(s.board, s.bar, s.off, 0, [3]).length === 0, 'cannot enter on a blocked point');
  ok(legalStepList(s.board, s.bar, s.off, 0, [3, 4]).some((st) => st.to === 20), 'can enter with the open die');
}

// ---- Bearing off: exact and overshoot --------------------------------------
{
  const b = Array(24).fill(0);
  b[2] = 1;               // one seat-0 checker on the 3-point (index 2); all home
  ok(legalStepList(b, [0, 0], [0, 0], 0, [3]).some((s) => s.to === 'off'), 'bear off with the exact die');
  ok(legalStepList(b, [0, 0], [0, 0], 0, [5]).some((s) => s.to === 'off'), 'bear off with a larger die (overshoot, nothing higher)');
}
{
  const b = Array(24).fill(0);
  b[2] = 1; b[5] = 1;     // a checker on the 6-point blocks overshoot from the 3-point
  ok(!legalStepList(b, [0, 0], [0, 0], 0, [5]).some((s) => s.from === 2 && s.to === 'off'), 'no overshoot while a checker sits further back');
  // A 5 can't bear off the 6-point (that needs a 6) — it makes a board move.
  ok(legalStepList(b, [0, 0], [0, 0], 0, [5]).some((s) => s.from === 5 && s.to === 0), 'the 6-point plays 6→1 with a 5');
}

// ---- Hitting a blot sends it to the bar ------------------------------------
{
  const b = Array(24).fill(0);
  b[3] = 1; b[0] = -1;    // seat-0 checker on index3 (home), seat-1 blot on index0
  const t = findTurn(1, '1,3');
  const s = craft({ board: b, turn: 0, turnIndex: t, seed: 1 });
  // 3→0 (die 3) hits, then 0→off (die 1).
  applyMove(s, { move_index: t + 1, player: 0, type: 'move', payload: { steps: [{ from: 3, to: 0 }, { from: 0, to: 'off' }] } });
  eqNum('blot sent to the bar', s.bar[1], 1);
  eqNum('checker borne off after the hit', s.off[0], 1);
}

// ---- Must use the maximum number of dice -----------------------------------
{
  const b = Array(24).fill(0);
  b[10] = 1;              // a lone checker that can play both dice (10→7→3 with 3,4)
  const t = findTurn(2, '3,4');
  const s = craft({ board: b, turn: 0, turnIndex: t, seed: 2 });
  ok(maxDiceUsable(b, [0, 0], [0, 0], 0, [3, 4]) === 2, 'both dice are usable here');
  let threw = false;
  try { applyMove(s, { move_index: t + 1, player: 0, type: 'move', payload: { steps: [{ from: 10, to: 7 }] } }); } catch { threw = true; }
  ok(threw, 'playing only one die when both are usable is rejected');
  // Playing both is accepted.
  const s2 = craft({ board: b, turn: 0, turnIndex: t, seed: 2 });
  applyMove(s2, { move_index: t + 1, player: 0, type: 'move', payload: { steps: [{ from: 10, to: 7 }, { from: 7, to: 3 }] } });
  ok(ownerAt(s2.board, 3) === 0 && s2.turn === 1, 'full move applied and turn passes');
}

// ---- Winning + gammon / backgammon classification --------------------------
{
  // Seat 0 has 14 off and one checker on its 1-point; seat 1 has borne some off.
  const b = Array(24).fill(0); b[0] = 1;
  const t = findTurn(5, '1,2');
  const s = craft({ board: b, off: [14, 3], turn: 0, turnIndex: t, seed: 5 });
  applyMove(s, { move_index: t + 1, player: 0, type: 'move', payload: { steps: [{ from: 0, to: 'off' }] } });
  ok(s.gameOver && s.winner === 0, 'bearing off the 15th wins');
  ok(s.endDetail.margin === 'single', 'single game (loser has borne off)');
}
{
  // Seat 1 bore off none and has a checker in seat 0's home → backgammon.
  const b = Array(24).fill(0); b[0] = 1; b[4] = -1;
  const t = findTurn(6, '1,2');
  const s = craft({ board: b, off: [14, 0], turn: 0, turnIndex: t, seed: 6 });
  applyMove(s, { move_index: t + 1, player: 0, type: 'move', payload: { steps: [{ from: 0, to: 'off' }] } });
  ok(s.gameOver && s.winner === 0 && s.endDetail.margin === 'backgammon', 'backgammon: loser trapped in winner\'s home');
}

// ---- Move log: replay, resign, timeout, out-of-turn ------------------------
{
  const seed = 4242;
  const first = startingSeat(seed);
  const t0 = turnPips(seed, 0); // opening dice for the first turn
  // Play a legal opening: move two back checkers with the two dice if possible.
  const s = newGameState(seed);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  const steps = firstLegalFullTurn(s);
  applyMove(s, { move_index: 1, player: first, type: 'move', payload: { steps } });
  const log = [
    { move_index: 0, player: 0, type: 'start', payload: {} },
    { move_index: 1, player: first, type: 'move', payload: { steps } },
  ];
  const a = replayMoves(seed, log);
  const b = replayMoves(seed, [...log].reverse());
  ok(JSON.stringify(a.board) === JSON.stringify(b.board), 'replay is order-independent');
  ok(a.turn === 1 - first, 'turn passes after the opening move');
  ok(t0.length === 2, 'opening had two dice');
}
{
  const s = newGameState(7);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 0, type: 'resign', payload: {} });
  ok(s.gameOver && s.winner === 1 && s.endDetail.reason === 'resign', 'resign ends game');
}
{
  const s = newGameState(8);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: { tpm: 60 } });
  applyMove(s, { move_index: 1, player: 1, type: 'timeout', payload: { player: 1 } });
  ok(s.gameOver && s.winner === 0 && s.endDetail.reason === 'timeout', 'timeout: flagged loses');
}
{
  const s = newGameState(9);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  const wrong = 1 - startingSeat(9);
  let threw = false;
  try { applyMove(s, { move_index: 1, player: wrong, type: 'move', payload: { steps: [] } }); } catch { threw = true; }
  ok(threw, 'out-of-turn move rejected');
}

// Greedily build a legal maximal turn from the current state (test helper).
function firstLegalFullTurn(state) {
  const pips = currentDice(state);
  const seat = state.turn;
  let board = state.board.slice(), bar = state.bar.slice(), off = state.off.slice(), dice = pips.slice();
  const steps = [];
  const want = maxDiceUsable(board, bar, off, seat, dice);
  while (steps.length < want) {
    const list = legalStepList(board, bar, off, seat, dice);
    // Pick a step that still allows reaching the max with the rest.
    let chosen = null;
    for (const st of list) {
      const nb = applyStepLocal(board, bar, off, seat, st);
      if (1 + maxDiceUsable(nb.board, nb.bar, nb.off, seat, removeDieLocal(dice, st.die)) >= want - steps.length) { chosen = st; break; }
    }
    if (!chosen) break;
    const nb = applyStepLocal(board, bar, off, seat, chosen);
    board = nb.board; bar = nb.bar; off = nb.off; dice = removeDieLocal(dice, chosen.die);
    steps.push({ from: chosen.from, to: chosen.to });
  }
  return steps;
}
function removeDieLocal(dice, d) { const i = dice.indexOf(d); const c = dice.slice(); if (i >= 0) c.splice(i, 1); return c; }
function applyStepLocal(board, bar, off, seat, step) {
  const nb = board.slice(), nbar = bar.slice(), noff = off.slice(); const s = seat === 0 ? 1 : -1; const opp = 1 - seat;
  if (step.from === 'bar') nbar[seat] -= 1; else nb[step.from] -= s;
  if (step.to === 'off') noff[seat] += 1;
  else { if ((opp === 0 ? nb[step.to] > 0 : nb[step.to] < 0) && Math.abs(nb[step.to]) === 1) { nb[step.to] = 0; nbar[opp] += 1; } nb[step.to] += s; }
  return { board: nb, bar: nbar, off: noff };
}

console.log(`\nbackgammon engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
