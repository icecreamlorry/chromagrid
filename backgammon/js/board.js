// SVG backgammon-board renderer + tap input. Draws the 24 triangular points, the
// central bar, the bear-off tray, stacked checkers, the dice, and highlights for
// the current selection and legal destinations. It's a dumb renderer: main.js
// owns the turn/step logic and tells it what to highlight; input is a single tap
// handler that reports the point tapped (0–23, or 'bar' / 'off').
//
// Geometry is computed with a `flipped` flag (coordinate math, not an SVG
// rotation) so text stays upright, letting each player view their own home board
// in the bottom-right.

import { pipPositions } from '../../shared/dice.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const M = 0.5;            // outer margin
const PW = 1.0;           // point column width
const POINT_H = 4.3;      // triangle height
const FIELD_TOP = M, FIELD_BOT = M + 10;   // playing field vertical extent (h=10)
const OFF_X = M + 13;     // bear-off tray left edge (width 1)
const TOTAL_W = M * 2 + 14, TOTAL_H = M + 10 + M;

function el(name, attrs = {}) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createBoard(container, { onPoint, onRoll } = {}) {
  let flipped = false;
  let interactive = true;
  let view = { board: Array(24).fill(0), bar: [0, 0], off: [0, 0] };

  const svg = el('svg', { class: 'bgboard', xmlns: SVGNS, viewBox: `0 0 ${TOTAL_W} ${TOTAL_H}` });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  container.innerHTML = '';
  container.appendChild(svg);

  // Column centre x for a point index, honouring the flip.
  function colRow(i) {
    let col = i <= 11 ? 11 - i : i - 12;   // 0..5 left half, 6..11 right half
    let row = i <= 11 ? 1 : 0;             // 0 = top, 1 = bottom
    if (flipped) { col = 11 - col; row = 1 - row; }
    return [col, row];
  }
  function pointX(col) { return M + (col < 6 ? col : col + 1) + 0.5; } // +1 unit for the bar gap
  function baseY(row) { return row === 0 ? FIELD_TOP : FIELD_BOT; }
  function dirY(row) { return row === 0 ? 1 : -1; }     // checkers stack toward centre

  function draw() {
    svg.innerHTML = '';
    // Frame + felt.
    svg.appendChild(el('rect', { x: 0, y: 0, width: TOTAL_W, height: TOTAL_H, rx: 0.3, class: 'bg-frame' }));
    svg.appendChild(el('rect', { x: M, y: M, width: 12 + 1, height: 10, class: 'bg-felt' }));
    // Bar.
    svg.appendChild(el('rect', { x: M + 6, y: M, width: 1, height: 10, class: 'bg-bar' }));
    // Off tray.
    svg.appendChild(el('rect', { x: OFF_X, y: M, width: 1, height: 10, class: 'bg-off-tray' }));

    // Points.
    for (let i = 0; i < 24; i++) {
      const [col, row] = colRow(i);
      const cx = pointX(col), by = baseY(row), ay = by + dirY(row) * POINT_H;
      const tri = `M${cx - 0.46} ${by} L${cx + 0.46} ${by} L${cx} ${ay} Z`;
      svg.appendChild(el('path', { d: tri, class: `bg-point ${(i + (i <= 11 ? 0 : 1)) % 2 ? 'a' : 'b'}` }));
    }

    // Highlight FILLS on source / target / selected points, drawn UNDER the
    // checkers so a tinted point reads as a wash behind the piece.
    const hi = view.highlights || {};
    for (const i of hi.sources || []) markPoint(i, 'bg-src');
    for (const t of hi.targets || []) {
      if (t === 'off') markOff('bg-tgt');
      else markPoint(t, 'bg-tgt');
    }
    if (hi.selected === 'bar') markBar('bg-sel');
    else if (typeof hi.selected === 'number') markPoint(hi.selected, 'bg-sel');

    // Checkers on the points.
    for (let i = 0; i < 24; i++) {
      const n = Math.abs(view.board[i]); if (!n) continue;
      const seat = view.board[i] > 0 ? 0 : 1;
      const [col, row] = colRow(i);
      stackCheckers(pointX(col), baseY(row) + dirY(row) * 0.5, dirY(row), n, seat);
    }
    // Bar checkers (seat 0 lower half, seat 1 upper half of the bar).
    if (view.bar[0]) stackCheckers(M + 6.5, M + 6.2, 1, view.bar[0], 0);
    if (view.bar[1]) stackCheckers(M + 6.5, M + 3.8, -1, view.bar[1], 1);
    // Borne-off checkers as stacked bars.
    drawOff(0); drawOff(1);

    // Highlight OUTLINES on target / selected points, drawn OVER the checkers so
    // the bright ring around a legal destination is never hidden by a blot.
    for (const t of hi.targets || []) {
      if (t === 'off') markOff('bg-tgt-ring');
      else markPoint(t, 'bg-tgt-ring');
    }
    if (hi.selected === 'bar') markBar('bg-sel-ring');
    else if (typeof hi.selected === 'number') markPoint(hi.selected, 'bg-sel-ring');

    // Dice for the side to move.
    drawDice();
  }

  function markPoint(i, cls) {
    const [col, row] = colRow(i);
    const cx = pointX(col), by = baseY(row), ay = by + dirY(row) * POINT_H;
    svg.appendChild(el('path', { d: `M${cx - 0.46} ${by} L${cx + 0.46} ${by} L${cx} ${ay} Z`, class: cls }));
  }
  function markBar(cls) { svg.appendChild(el('rect', { x: M + 6, y: M, width: 1, height: 10, class: cls })); }
  function markOff(cls) { svg.appendChild(el('rect', { x: OFF_X, y: M, width: 1, height: 10, class: cls })); }

  function stackCheckers(cx, startY, dir, n, seat) {
    const step = 0.82, R = 0.42;
    const shown = Math.min(n, 5);
    for (let k = 0; k < shown; k++) {
      const cy = startY + dir * k * step;
      svg.appendChild(el('circle', { cx, cy, r: R, class: `bg-checker ${seat === 0 ? 'light' : 'dark'}` }));
      svg.appendChild(el('circle', { cx, cy, r: R * 0.66, class: `bg-checker-ridge ${seat === 0 ? 'light' : 'dark'}` }));
    }
    if (n > 5) {
      const cy = startY + dir * (shown - 1) * step;
      const t = el('text', { x: cx, y: cy, class: 'bg-count', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = n; svg.appendChild(t);
    }
  }

  function drawOff(seat) {
    const n = view.off[seat]; if (!n) return;
    const dir = seat === 0 ? -1 : 1;                 // seat 0 stacks from the bottom
    const y0 = seat === 0 ? FIELD_BOT - 0.25 : FIELD_TOP + 0.25;
    for (let k = 0; k < n; k++) {
      svg.appendChild(el('rect', {
        x: OFF_X + 0.14, y: y0 + dir * (k * 0.32) - (seat === 0 ? 0.12 : 0), width: 0.72, height: 0.2, rx: 0.06,
        class: `bg-off ${seat === 0 ? 'light' : 'dark'}`,
      }));
    }
  }

  // Dice states: 'idle' (unrolled — prompt to tap), 'rolling' (tumbling faces),
  // 'landed' (just settled — plays a one-shot pop), 'done' (settled/static).
  function drawDice() {
    const dice = view.dice || [];
    if (!dice.length) return;
    const state = view.diceState || 'done';
    const n = dice.length; const s = 1.1, gap = 0.28;
    const totalW = n * s + (n - 1) * gap;
    const startX = M + 9.5 - totalW / 2;
    const y = M + 5 - s / 2;
    dice.forEach((d, i) => {
      const x = startX + i * (s + gap);
      // Each die is its own group so the shake/pop transforms pivot on the die's
      // own centre (transform-box: fill-box) and carry its pips along.
      const g = el('g', { class: `bg-die-group ${state}${d.used ? ' used' : ''}` });
      g.appendChild(el('rect', { x, y, width: s, height: s, rx: 0.2, class: 'bg-die' }));
      if (state === 'idle' || d.value == null) {
        const q = el('text', { x: x + s / 2, y: y + s / 2, class: 'bg-die-q', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        q.textContent = '?'; g.appendChild(q);
      } else {
        for (const [px, py] of pipPositions(d.value)) {
          g.appendChild(el('circle', { cx: x + px * s, cy: y + py * s, r: 0.1, class: 'bg-pip' }));
        }
      }
      svg.appendChild(g);
    });
    if (state === 'idle') {
      const label = el('text', { x: M + 9.5, y: y + s + 0.66, class: 'bg-roll-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      label.textContent = 'TAP TO ROLL'; svg.appendChild(label);
    } else if (state === 'dup') {
      const label = el('text', { x: M + 9.5, y: y + s + 0.66, class: 'bg-doubles-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      label.textContent = 'DOUBLES!'; svg.appendChild(label);
    }
  }

  // ---- Hit testing ----------------------------------------------------------
  function targetFromEvent(e) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return null;
    const x = ((e.clientX - rect.left) / rect.width) * TOTAL_W;
    const y = ((e.clientY - rect.top) / rect.height) * TOTAL_H;
    if (x >= OFF_X && x <= OFF_X + 1) return 'off';
    if (x >= M + 6 && x <= M + 7) return 'bar';
    // Which column?
    let col;
    if (x < M + 6) col = Math.floor((x - M) / PW);
    else col = 6 + Math.floor((x - M - 7) / PW);
    if (col < 0 || col > 11) return null;
    const row = y < M + 5 ? 0 : 1;             // top / bottom half
    let fcol = col, frow = row;
    if (flipped) { fcol = 11 - col; frow = 1 - row; }
    // Inverse of colRow: given (fcol, frow) find i.
    if (frow === 1) return 11 - fcol;          // bottom row: i = 11 - col (i in 0..11)
    return 12 + fcol;                          // top row: i = 12 + col
  }

  svg.addEventListener('pointerup', (e) => {
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Before the dice are rolled the whole board is one big "roll" button, so
    // tapping anywhere (not just the dice) rolls — forgiving on a phone. While
    // the dice are tumbling, ignore taps entirely.
    const ds = view.diceState;
    if (ds === 'idle') { onRoll?.(); return; }
    if (ds === 'rolling') return;
    const t = targetFromEvent(e);
    if (t != null) onPoint?.(t);
  });

  return {
    svg,
    render(v) { if (v.flipped != null) flipped = v.flipped; view = v; draw(); },
    setInteractive(val) { interactive = val; svg.classList.toggle('locked', !val); },
    get flipped() { return flipped; },
  };
}
