// Chess tutorial runner. Drives the #screen-tutorial DOM: a shared board, a
// teaching panel, and ← / → navigation. Each step's position is authored as a
// FEN (or continues from the previous step), so the arrows can move back and
// forth freely and the player can re-read anything.
//
// Locking: on a task step the board only lets the player move the side to move
// (optionally restricted to specific pieces), and the → arrow stays disabled
// until the required move is played — so it's always clear what to do, and the
// player can only do what the lesson asks.

import { createBoard } from './board.js';
import { parseFEN, genLegal, makeMove } from './engine.js';
import { LEVELS } from './tutorial-levels.js';

const $ = (id) => document.getElementById(id);
const DONE_KEY = 'chess_tutorial_done';
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];

let board = null;
let onExit = null;
let levelIdx = 0;
let stepIdx = 0;
let cleared = new Set();
let workPos = null;       // live position for the step being solved
let tSelected = null;     // [r,c] selected piece in a task
let tTargets = [];        // [{to,capture}] legal destinations for the selection

function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); }
  catch { return new Set(); }
}
function markDone(id) {
  const d = loadDone(); d.add(id);
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...d])); } catch { /* ignore */ }
}

const level = () => LEVELS[levelIdx];
const step = () => level().steps[stepIdx];
const isTask = (s) => !!s.task;
const stepCleared = (i) => cleared.has(i);

// Apply a {from,to,promo?} move to a position by matching it in the legal list.
function applyMoveOn(pos, mv) {
  const m = genLegal(pos).find((x) => eq(x.from, mv.from) && eq(x.to, mv.to));
  if (!m) return pos;
  return makeMove(pos, m.flag === 'promo' ? { ...m, promo: mv.promo || 'q' } : m);
}

// Rebuild the position ENTERING step `target`: replay each earlier step's
// canonical solution (+ replies) from the most recent FEN anchor.
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

function annotationsFor(s) {
  return {
    marks: s.marks || [], arrows: s.arrows || [],
    regions: s.regions || [], labels: s.labels || [], ghosts: s.ghosts || [],
  };
}

function canDrag(r, c) {
  const s = step();
  if (!isTask(s) || stepCleared(stepIdx) || !workPos) return false;
  const p = workPos.board[r][c];
  if (!p || p[0] !== workPos.toMove) return false;
  if (s.task.allowFrom && !s.task.allowFrom.some((a) => eq(a, [r, c]))) return false;
  return true;
}
function dragTargetsFor(r, c) {
  return genLegal(workPos).filter((m) => eq(m.from, [r, c])).map((m) => ({
    to: m.to, capture: !!workPos.board[m.to[0]][m.to[1]] || m.flag === 'ep',
  }));
}
function onBoardDrop(from, to) {
  const s = step();
  if (!isTask(s) || stepCleared(stepIdx)) return;
  if (to && genLegal(workPos).some((m) => eq(m.from, from) && eq(m.to, to))) {
    attemptMove(from, to);
    return;
  }
  tSelected = null; tTargets = [];
  paint(annotationsFor(s));
}

export function initTutorial(exitCallback) {
  onExit = exitCallback;
  board = createBoard($('tut-board'), {
    onSquare: onBoardSquare, draggable: canDrag, dragTargets: dragTargetsFor, onDrop: onBoardDrop,
  });

  $('tut-prev').addEventListener('click', () => go(-1));
  $('tut-next').addEventListener('click', () => go(1));
  $('tut-exit').addEventListener('click', () => onExit?.());
  $('tut-menu-btn').addEventListener('click', openLevelMenu);
  $('tut-levels-close').addEventListener('click', () => $('tut-levels').classList.add('hidden'));
  $('tut-complete-next').addEventListener('click', () => {
    $('tut-complete').classList.add('hidden');
    if (levelIdx + 1 < LEVELS.length) openLevel(levelIdx + 1);
    else openLevelMenu();
  });
  $('tut-complete-menu').addEventListener('click', () => {
    $('tut-complete').classList.add('hidden');
    openLevelMenu();
  });
}

export function openTutorial() {
  buildLevelMenu();
  const done = loadDone();
  let start = LEVELS.findIndex((l) => !done.has(l.id));
  if (start < 0) start = 0;
  openLevel(start);
}

function openLevel(i) {
  levelIdx = i;
  stepIdx = 0;
  cleared = new Set();
  $('tut-levels').classList.add('hidden');
  $('tut-complete').classList.add('hidden');
  renderStep();
}

function go(dir) {
  const next = stepIdx + dir;
  if (next < 0) return;
  if (next >= level().steps.length) { finishLevel(); return; }
  if (dir > 0 && !stepCleared(stepIdx)) return;
  stepIdx = next;
  renderStep();
}

function finishLevel() {
  markDone(level().id);
  buildLevelMenu();
  $('tut-complete-title').textContent = `${level().title} — complete`;
  const last = levelIdx + 1 >= LEVELS.length;
  $('tut-complete-msg').textContent = last
    ? "That's the whole tutorial! You know enough to play a real game now."
    : 'Nicely done. Ready for the next lesson?';
  $('tut-complete-next').textContent = last ? 'Back to lessons' : 'Next lesson →';
  $('tut-complete').classList.remove('hidden');
}

function renderStep() {
  const s = step();
  const info = !isTask(s);
  if (info) cleared.add(stepIdx);
  tSelected = null; tTargets = [];

  workPos = posEnteringStep(level(), stepIdx);

  const alreadyCleared = stepCleared(stepIdx);
  // On a solved/revisited task, show the resulting position so it reads as done.
  if (isTask(s) && alreadyCleared && s.task.moves) {
    workPos = applyMoveOn(workPos, s.task.moves[0]);
    for (const rep of s.task.replies || []) workPos = applyMoveOn(workPos, rep);
  }
  board.setInteractive(isTask(s) && !alreadyCleared);
  paint(annotationsFor(s));

  $('tut-title').textContent = level().title;
  $('tut-badge').textContent = `Lesson ${levelIdx + 1} of ${LEVELS.length}`;
  $('tut-text').innerHTML = s.text;
  renderStepDots();

  const fb = $('tut-feedback');
  fb.className = 'tut-feedback';
  if (isTask(s) && alreadyCleared) {
    fb.classList.add('good');
    fb.innerHTML = s.task.success ? `✓ ${s.task.success}` : '✓ Done.';
  } else if (isTask(s)) {
    fb.classList.add('hint');
    fb.innerHTML = s.task.hint ? `→ ${s.task.hint}` : '→ Make your move on the board.';
  } else {
    fb.textContent = '';
  }

  $('tut-prev').disabled = stepIdx === 0;
  $('tut-next').disabled = !stepCleared(stepIdx);
  $('tut-next').textContent = (stepIdx + 1 >= level().steps.length) ? 'Finish ✓' : '→';
}

function renderStepDots() {
  const wrap = $('tut-steps');
  wrap.innerHTML = '';
  level().steps.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'step-dot';
    if (i === stepIdx) dot.classList.add('current');
    else if (stepCleared(i)) dot.classList.add('done');
    wrap.appendChild(dot);
  });
}

function paint(ann) {
  board.render({
    board: workPos.board, flipped: false, selected: tSelected, targets: tTargets,
  }, ann);
}

function onBoardSquare(r, c) {
  const s = step();
  if (!isTask(s) || stepCleared(stepIdx)) return;
  const task = s.task;
  const p = workPos.board[r][c];
  const mine = p && p[0] === workPos.toMove;

  if (tSelected) {
    const tgt = tTargets.find((t) => eq(t.to, [r, c]));
    if (tgt) { attemptMove(tSelected, [r, c]); return; }
  }
  if (mine) {
    if (task.allowFrom && !task.allowFrom.some((a) => eq(a, [r, c]))) {
      flash('Move the highlighted piece.', 'warn');
      return;
    }
    tSelected = [r, c];
    tTargets = genLegal(workPos).filter((m) => eq(m.from, [r, c])).map((m) => ({
      to: m.to, capture: !!workPos.board[m.to[0]][m.to[1]] || m.flag === 'ep',
    }));
    paint(annotationsFor(s));
    return;
  }
  tSelected = null; tTargets = [];
  paint(annotationsFor(s));
}

function attemptMove(from, to) {
  const task = step().task;
  const isPromo = genLegal(workPos).some((m) => eq(m.from, from) && eq(m.to, to) && m.flag === 'promo');
  const promo = isPromo ? 'q' : undefined; // tutorials auto-promote to a queen

  let good = true;
  if (task.moves) good = task.moves.some((m) => eq(m.from, from) && eq(m.to, to));
  if (good && task.check) good = task.check(applyMoveOn(workPos, { from, to, promo }), { from, to });

  if (!good) {
    flash(task.onWrong || 'Not quite — try the highlighted move.', 'warn');
    tSelected = null; tTargets = [];
    paint(annotationsFor(step()));
    return;
  }

  workPos = applyMoveOn(workPos, { from, to, promo });
  for (const rep of task.replies || []) workPos = applyMoveOn(workPos, rep);
  tSelected = null; tTargets = [];
  cleared.add(stepIdx);
  board.setInteractive(false);
  paint(annotationsFor(step()));

  const fb = $('tut-feedback');
  fb.className = 'tut-feedback good';
  fb.innerHTML = task.success ? `✓ ${task.success}` : '✓ Correct!';
  $('tut-next').disabled = false;
  $('tut-next').textContent = (stepIdx + 1 >= level().steps.length) ? 'Finish ✓' : 'Next →';
  renderStepDots();
}

let flashTimer = null;
function flash(msg, kind) {
  const fb = $('tut-feedback');
  fb.className = `tut-feedback ${kind || ''}`;
  fb.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (!stepCleared(stepIdx)) renderHintLine(); }, 2600);
}
function renderHintLine() {
  const s = step();
  const fb = $('tut-feedback');
  if (isTask(s) && !stepCleared(stepIdx)) {
    fb.className = 'tut-feedback hint';
    fb.innerHTML = s.task.hint ? `→ ${s.task.hint}` : '→ Make your move on the board.';
  }
}

// ---- Level menu ------------------------------------------------------------

function buildLevelMenu() {
  const list = $('tut-levels-list');
  if (!list) return;
  const done = loadDone();
  list.innerHTML = '';
  LEVELS.forEach((lvl, i) => {
    const btn = document.createElement('button');
    btn.className = 'tut-level-item';
    if (done.has(lvl.id)) btn.classList.add('done');
    btn.innerHTML = `<span class="tl-num">${i + 1}</span>`
      + `<span class="tl-name">${lvl.title}</span>`
      + `<span class="tl-tick">${done.has(lvl.id) ? '✓' : ''}</span>`;
    btn.addEventListener('click', () => openLevel(i));
    list.appendChild(btn);
  });
}

function openLevelMenu() {
  buildLevelMenu();
  $('tut-levels').classList.remove('hidden');
}
