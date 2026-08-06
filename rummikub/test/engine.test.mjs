// Rummikub engine tests. Run: node rummikub/test/engine.test.mjs

import {
  makePool, makeShuffledPool, classifySet, isValidSet, validatePlay, arrangeSet,
  newGameState, applyMove, replayMoves, tileValue, RACK_SIZE, MELD_MIN,
  MIN_PLAYERS, MAX_PLAYERS,
} from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eqNum = (m, g, w) => ok(g === w, `${m} (got ${g}, want ${w})`);

// A started game with the given number of players.
function started(seed = 1, players = 2) {
  const s = newGameState(seed);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: { players } });
  return s;
}
// Force a known rack + table onto a started state (bypassing the deal) so a
// play can be tested in isolation. Marks players melded unless told not to.
function rig(rack, table = [], { seed = 1, melded = true, player = 0, players = 2 } = {}) {
  const s = started(seed, players);
  s.racks[player] = rack.slice();
  s.table = table.map((t) => t.slice());
  s.melded = new Array(players).fill(melded);
  s.turn = player;
  return s;
}
const play = (s, table, played, player = s.turn) =>
  applyMove(s, { move_index: s.moveCount, player, type: 'play', payload: { table, played } });

// ---- Pool -------------------------------------------------------------------
{
  eqNum('pool has 106 tiles', makePool().length, 106);
  eqNum('two jokers', makePool().filter((t) => t === 'j').length, 2);
  eqNum('two of each numbered tile', makePool().filter((t) => t === 'r7').length, 2);
  const a = makeShuffledPool(42).join(','), b = makeShuffledPool(42).join(','), c = makeShuffledPool(43).join(',');
  ok(a === b, 'shuffle is deterministic for a seed');
  ok(a !== c, 'different seeds shuffle differently');
  ok(makeShuffledPool(42).slice().sort().join(',') === makePool().sort().join(','), 'shuffle is a permutation');
}

// ---- Set classification -----------------------------------------------------
{
  ok(isValidSet(['r7', 'b7', 'k7']), 'group of three colours');
  ok(isValidSet(['r7', 'b7', 'k7', 'o7']), 'group of four colours');
  ok(!isValidSet(['r7', 'b7', 'r7']), 'group rejects a duplicate colour');
  ok(!isValidSet(['r7', 'b7', 'k8']), 'group rejects mixed numbers');
  ok(!isValidSet(['r7', 'b7']), 'a set needs three tiles');
  ok(!isValidSet(['r7', 'b7', 'k7', 'o7', 'j']), 'group can’t exceed four');

  ok(isValidSet(['r5', 'r6', 'r7']), 'run of three');
  ok(isValidSet(['r5', 'r6', 'r7', 'r8', 'r9']), 'longer run');
  ok(!isValidSet(['r5', 'b6', 'r7']), 'run rejects mixed colours');
  ok(!isValidSet(['r5', 'r7', 'r8']), 'run rejects a gap');
  ok(!isValidSet(['r5', 'r5', 'r6']), 'run rejects a repeat');
  ok(!isValidSet(['r12', 'r13', 'j']), 'run can’t wrap past 13');
  ok(isValidSet(['r11', 'r12', 'r13']), 'run up to 13');

  ok(isValidSet(['r7', 'b7', 'j']), 'joker completes a group');
  ok(isValidSet(['j', 'j', 'r7']), 'two jokers in a group');
  ok(isValidSet(['r5', 'j', 'r7']), 'joker fills a run gap');
  ok(isValidSet(['j', 'j', 'r3', 'r4', 'r5']), 'leading jokers in a run');
  ok(!isValidSet(['j', 'j', 'j']), 'all-joker set is invalid');
}

// ---- Set values -------------------------------------------------------------
{
  eqNum('group value counts every tile', classifySet(['r7', 'b7', 'k7']).value, 21);
  eqNum('group joker takes the number', classifySet(['r7', 'b7', 'j']).value, 21);
  eqNum('run value sums the numbers', classifySet(['r5', 'r6', 'r7']).value, 18);
  eqNum('run joker takes its slot', classifySet(['r5', 'j', 'r7']).value, 18);
  eqNum('leading-joker run value', classifySet(['j', 'j', 'r3', 'r4', 'r5']).value, 15);
}

// ---- arrangeSet (auto-ordering) ---------------------------------------------
{
  ok(isValidSet(arrangeSet(['r7', 'r5', 'r6'])), 'scrambled run auto-orders to valid');
  ok(arrangeSet(['r7', 'r5', 'r6']).join(',') === 'r5,r6,r7', 'run comes back ascending');
  ok(isValidSet(arrangeSet(['r5', 'r7', 'j'])), 'joker slots into a run gap');
  ok(isValidSet(arrangeSet(['b7', 'r7', 'k7'])), 'group auto-orders');
  ok(arrangeSet(['b7', 'r7', 'k7']).join(',') === 'k7,r7,b7', 'group ordered by colour');
  ok(!isValidSet(arrangeSet(['r5', 'r7', 'r9'])), 'unfixable set left invalid');
}

// ---- Deal -------------------------------------------------------------------
{
  const s = started(7);
  eqNum('seat 0 dealt 14', s.racks[0].length, RACK_SIZE);
  eqNum('seat 1 dealt 14', s.racks[1].length, RACK_SIZE);
  eqNum('pool holds the rest', s.pool.length, 106 - 2 * RACK_SIZE);
  ok(s.turn === 0 || s.turn === 1, 'a first player is chosen');
  // Every client reconstructs identical racks (hidden-hand determinism).
  const s2 = replayMoves(7, [{ move_index: 0, player: 0, type: 'start', payload: { players: 2 } }]);
  ok(s.racks[0].join(',') === s2.racks[0].join(',') && s.racks[1].join(',') === s2.racks[1].join(','), 'racks are deterministic from the seed');
}
{
  // 3- and 4-player deals.
  for (const n of [3, 4]) {
    const s = started(7, n);
    eqNum(`${n}p: numPlayers`, s.numPlayers, n);
    eqNum(`${n}p: every rack 14`, s.racks.filter((r) => r.length === RACK_SIZE).length, n);
    eqNum(`${n}p: pool holds the rest`, s.pool.length, 106 - n * RACK_SIZE);
    ok(s.turn >= 0 && s.turn < n, `${n}p: first seat in range`);
    // No tile dealt twice across all racks + pool.
    const all = [...s.racks.flat(), ...s.pool].sort().join(',');
    ok(all === makePool().sort().join(','), `${n}p: deal conserves the pool`);
  }
}

// ---- Opening meld -----------------------------------------------------------
{
  // Below 30 is rejected; 30+ is allowed as the first play.
  const low = rig(['r1', 'b1', 'k1'], [], { melded: false });
  ok(!validatePlay(low, 0, [['r1', 'b1', 'k1']], ['r1', 'b1', 'k1']).ok, 'opening meld under 30 rejected');
  const s = rig(['r10', 'b10', 'k10', 'r5'], [], { melded: false });
  const r = validatePlay(s, 0, [['r10', 'b10', 'k10']], ['r10', 'b10', 'k10']);
  ok(r.ok && r.meldPoints === 30, 'opening meld of exactly 30 allowed');
  play(s, [['r10', 'b10', 'k10']], ['r10', 'b10', 'k10']);
  ok(s.melded[0], 'player marked melded after opening');
  eqNum('played tiles left the rack', s.racks[0].length, 1);
  eqNum('turn passes', s.turn, 1);
}
{
  // Can't touch the existing table on your opening meld.
  const s = rig(['r10', 'b10', 'k10'], [['o1', 'o2', 'o3']], { melded: false });
  const bad = validatePlay(s, 0, [['o1', 'o2', 'o3', 'r10'], ['b10', 'k10', 'j']], ['r10', 'b10', 'k10']);
  ok(!bad.ok, 'opening meld can’t rearrange the table');
}

// ---- Conservation + rearranging ---------------------------------------------
{
  // Already melded: may extend/rearrange the table using rack tiles.
  const s = rig(['r8'], [['r5', 'r6', 'r7']]);
  const r = validatePlay(s, 0, [['r5', 'r6', 'r7', 'r8']], ['r8']);
  ok(r.ok, 'extend a run once melded');
  play(s, [['r5', 'r6', 'r7', 'r8']], ['r8']);
  eqNum('emptying the rack wins', s.winner, 0);
  ok(s.gameOver, 'game over when a rack empties');
}
{
  const s = rig(['r8', 'b2'], [['r5', 'r6', 'r7']]);
  ok(!validatePlay(s, 0, [['r5', 'r6', 'r7', 'r8']], ['r8', 'b2']).ok, 'played tiles must all reach the table (conservation)');
  ok(!validatePlay(s, 0, [['r5', 'r6', 'r7', 'r9']], ['r9']).ok, 'can’t play a tile you don’t hold');
  ok(!validatePlay(s, 0, [['r5', 'r6', 'r7']], []).ok, 'a play must use at least one tile');
  ok(!validatePlay(s, 0, [['r5', 'r6', 'r7'], ['r8', 'r8', 'r8']], ['r8']).ok, 'can’t invent tiles');
}

// ---- Draw / pass ------------------------------------------------------------
{
  const s = started(3);
  const before = s.racks[s.turn].length, mover = s.turn;
  applyMove(s, { move_index: s.moveCount, player: mover, type: 'draw', payload: {} });
  eqNum('draw adds a tile', s.racks[mover].length, before + 1);
  eqNum('draw passes the turn', s.turn, 1 - mover);
}
{
  const s = started(3); s.pool = [];
  let threw = false;
  try { applyMove(s, { move_index: s.moveCount, player: s.turn, type: 'draw', payload: {} }); } catch { threw = true; }
  ok(threw, 'cannot draw from an empty pool');
  applyMove(s, { move_index: s.moveCount, player: s.turn, type: 'pass', payload: {} });
  applyMove(s, { move_index: s.moveCount, player: s.turn, type: 'pass', payload: {} });
  ok(s.gameOver && s.endDetail.reason === 'stalemate', 'two passes end the game (stalemate)');
}

// ---- Resign / out of turn ---------------------------------------------------
{
  const s = started(9); const me = s.turn;
  applyMove(s, { move_index: s.moveCount, player: me, type: 'resign', payload: {} });
  ok(s.gameOver && s.winner === 1 - me, 'resign hands the win to the opponent (2p)');
}

// ---- 3–4 player rotation + elimination --------------------------------------
{
  // Seat rotation wraps around all players.
  const s = started(2, 3); const first = s.turn;
  applyMove(s, { move_index: s.moveCount, player: first, type: 'draw', payload: {} });
  eqNum('3p: turn advances clockwise', s.turn, (first + 1) % 3);
  applyMove(s, { move_index: s.moveCount, player: s.turn, type: 'draw', payload: {} });
  applyMove(s, { move_index: s.moveCount, player: s.turn, type: 'draw', payload: {} });
  eqNum('3p: rotation returns to the first seat', s.turn, first);
}
{
  // A resign in a 4-player game removes that seat but the game continues.
  const s = started(2, 4);
  const a = s.turn;
  applyMove(s, { move_index: s.moveCount, player: a, type: 'resign', payload: {} });
  ok(!s.gameOver, '4p: one resignation doesn’t end the game');
  ok(s.out[a] && s.turn !== a, '4p: resigned seat is skipped');
  // Two more resign → only one active seat left → that seat wins.
  const rest = [0, 1, 2, 3].filter((x) => x !== a);
  applyMove(s, { move_index: s.moveCount, player: rest[0], type: 'resign', payload: {} });
  applyMove(s, { move_index: s.moveCount, player: rest[1], type: 'resign', payload: {} });
  ok(s.gameOver && s.winner === rest[2], '4p: last player standing wins');
}
{
  // Timeout eliminates the flagged seat (skipped, not a whole-game loss in 3p).
  const s = started(4, 3); const victim = s.turn;
  applyMove(s, { move_index: s.moveCount, player: victim, type: 'timeout', payload: { player: victim } });
  ok(!s.gameOver && s.out[victim], '3p: timeout eliminates just that seat');
}
{
  const s = started(1);
  let threw = false;
  try { applyMove(s, { move_index: 99, player: 0, type: 'draw', payload: {} }); } catch { threw = true; }
  ok(threw, 'out-of-order move rejected');
}
{
  // A play/draw/pass logged for the wrong seat is rejected on replay (guards the
  // move log even though the UI already gates by turn + the DB index lock).
  const s = started(2, 3); const notTurn = (s.turn + 1) % 3;
  let drew = false, passed = false, played = false;
  try { applyMove(s, { move_index: s.moveCount, player: notTurn, type: 'draw', payload: {} }); } catch { drew = true; }
  try { applyMove(s, { move_index: s.moveCount, player: notTurn, type: 'pass', payload: {} }); } catch { passed = true; }
  try { applyMove(s, { move_index: s.moveCount, player: notTurn, type: 'play', payload: { table: [], played: ['r1'] } }); } catch { played = true; }
  ok(drew && passed && played, 'out-of-turn draw/pass/play rejected');
}

// ---- Determinism of a full game ---------------------------------------------
{
  const moves = [{ move_index: 0, player: 0, type: 'start', payload: {} }];
  const s = rig([], []); // ignore; just check replay wiring
  const a = replayMoves(5, moves), b = replayMoves(5, moves);
  ok(a.racks[0].join(',') === b.racks[0].join(','), 'replay is deterministic');
  eqNum('joker rack value', tileValue('j'), 30);
  eqNum('numbered rack value', tileValue('r9'), 9);
  ok(MELD_MIN === 30, 'meld minimum is 30');
}

console.log(`\nrummikub engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
