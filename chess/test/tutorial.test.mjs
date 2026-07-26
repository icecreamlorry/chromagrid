// Chess tutorial validator. Run: node chess/test/tutorial.test.mjs
//
// Walks every lesson exactly as the runner would: rebuild each step's position
// from its FEN anchor (folding earlier steps' canonical solution + replies), and
// for each task assert that every accepted move is legal from that position,
// that the canonical move satisfies any success predicate, and that scripted
// replies are legal in sequence.

import { parseFEN, genLegal, makeMove } from '../js/engine.js';
import { LEVELS } from '../js/tutorial-levels.js';

let pass = 0, fail = 0;
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
function check(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗ ' + name); } }

function applyMoveOn(pos, m) {
  const legal = genLegal(pos);
  const match = legal.find((x) => eq(x.from, m.from) && eq(x.to, m.to));
  if (!match) return null;
  return makeMove(pos, match.flag === 'promo' ? { ...match, promo: m.promo || 'q' } : match);
}

function posEnteringStep(lvl, target) {
  let pos = null;
  for (let i = 0; i <= target; i++) {
    const s = lvl.steps[i];
    if (s.fen) pos = parseFEN(s.fen);
    if (i === target) break;
    const task = s.task;
    if (task && task.moves) {
      pos = applyMoveOn(pos, task.moves[0]);
      for (const rep of task.replies || []) pos = applyMoveOn(pos, rep);
    }
  }
  return pos;
}

for (const lvl of LEVELS) {
  check(`${lvl.id}: has id + title + steps`, !!lvl.id && !!lvl.title && lvl.steps.length > 0);
  // First step must anchor with a FEN.
  check(`${lvl.id}: first step has a FEN`, !!lvl.steps[0].fen);

  lvl.steps.forEach((s, i) => {
    const pos = posEnteringStep(lvl, i);
    check(`${lvl.id} step ${i}: position reconstructs`, !!pos && !!pos.board);
    if (!pos) return;

    if (s.task) {
      const t = s.task;
      check(`${lvl.id} step ${i}: task has at least one move`, Array.isArray(t.moves) && t.moves.length > 0);
      const legal = genLegal(pos);
      // Every accepted move is legal from here.
      for (const m of t.moves) {
        const ok = legal.some((x) => eq(x.from, m.from) && eq(x.to, m.to));
        check(`${lvl.id} step ${i}: accepted move ${JSON.stringify(m.from)}→${JSON.stringify(m.to)} is legal`, ok);
      }
      // allowFrom squares must actually hold a movable piece for the side to move.
      for (const a of t.allowFrom || []) {
        const p = pos.board[a[0]][a[1]];
        check(`${lvl.id} step ${i}: allowFrom holds a ${pos.toMove} piece`, !!p && p[0] === pos.toMove);
      }
      // Canonical move applies and satisfies the predicate.
      const after = applyMoveOn(pos, t.moves[0]);
      check(`${lvl.id} step ${i}: canonical move applies`, !!after);
      if (after && t.check) {
        check(`${lvl.id} step ${i}: canonical move satisfies check()`, t.check(after, { from: t.moves[0].from, to: t.moves[0].to }));
      }
      // Replies are legal in sequence.
      let rp = after;
      for (const rep of t.replies || []) {
        const nrp = rp && applyMoveOn(rp, rep);
        check(`${lvl.id} step ${i}: reply ${JSON.stringify(rep.from)}→${JSON.stringify(rep.to)} is legal`, !!nrp);
        rp = nrp;
      }
    }
  });
}

console.log(`\nchess tutorial: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
