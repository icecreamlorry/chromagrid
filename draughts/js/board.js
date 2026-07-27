// Shared SVG draughts-board renderer + input. An 8×8 board with round pieces
// (kings marked with a gold ring), highlights, legal-move dots, and both
// tap-to-move and drag-and-drop — the same input pipeline as the chess board,
// so multi-jumps are built by tapping successive squares (main.js owns the path
// logic; this stays a dumb renderer).

const SVGNS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';
const DRAG_THRESHOLD = 6;

function el(name, attrs = {}) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createBoard(container, { onSquare, draggable, dragTargets, onDrop } = {}) {
  let flipped = false;
  let interactive = true;
  let lastView = { board: empty() };
  let drag = null;

  const svg = el('svg', { class: 'draughtsboard', xmlns: SVGNS, viewBox: '0 0 8 8' });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  container.innerHTML = '';
  container.appendChild(svg);

  const gSquares = el('g'); const gHighlight = el('g'); const gCoords = el('g');
  const gTargets = el('g'); const gPieces = el('g'); const gAnnot = el('g'); const gDrag = el('g', { class: 'cb-drag' });
  svg.append(gSquares, gHighlight, gCoords, gTargets, gPieces, gAnnot, gDrag);

  function empty() { return Array.from({ length: 8 }, () => Array(8).fill(null)); }
  function screenXY(r, c) { return flipped ? [7 - c, 7 - r] : [c, r]; }
  function centre(r, c) { const [x, y] = screenXY(r, c); return [x + 0.5, y + 0.5]; }
  function logical(sx, sy) { return flipped ? [7 - sy, 7 - sx] : [sy, sx]; }
  const eqp = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  const LIFT = (pt) => (pt === 'touch' ? 0.85 : 0.1);
  function landingSquare(ux, uy, pt) {
    const sx = Math.floor(ux), sy = Math.floor(uy - LIFT(pt));
    return (sx < 0 || sx > 7 || sy < 0 || sy > 7) ? null : [sx, sy];
  }

  function squares() {
    gSquares.innerHTML = '';
    for (let sy = 0; sy < 8; sy++) {
      for (let sx = 0; sx < 8; sx++) {
        gSquares.appendChild(el('rect', {
          x: sx, y: sy, width: 1, height: 1, class: `cb-sq ${(sx + sy) % 2 === 0 ? 'light' : 'dark'}`,
        }));
      }
    }
  }
  squares();

  function coords() {
    gCoords.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const file = flipped ? FILES[7 - i] : FILES[i];
      const rank = flipped ? i + 1 : 8 - i;
      const f = el('text', { x: i + 0.92, y: 7.94, class: 'cb-coord', 'text-anchor': 'end' }); f.textContent = file; gCoords.appendChild(f);
      const rk = el('text', { x: 0.06, y: i + 0.24, class: 'cb-coord' }); rk.textContent = rank; gCoords.appendChild(rk);
    }
  }

  function pieceNode(r, c, piece, cls = '', opacity = 1) {
    const [cx, cy] = centre(r, c); return discAt(cx, cy, piece, cls, opacity);
  }
  function discAt(cx, cy, piece, cls, opacity) {
    const white = piece === 'w' || piece === 'W';
    const king = piece === 'W' || piece === 'B';
    const g = el('g', { class: `cb-piece ${white ? 'white' : 'black'} ${cls}`.trim() });
    if (opacity !== 1) g.setAttribute('opacity', opacity);
    g.appendChild(el('circle', { cx, cy: cy + 0.03, r: 0.38, class: 'cb-disc-shadow' }));
    g.appendChild(el('circle', { cx, cy, r: 0.38, class: 'cb-disc' }));
    g.appendChild(el('circle', { cx, cy, r: 0.29, class: 'cb-disc-ridge' }));
    if (king) {
      g.appendChild(el('circle', { cx, cy, r: 0.19, class: 'cb-king-ring' }));
      g.appendChild(el('circle', { cx, cy, r: 0.07, class: 'cb-king-dot' }));
    }
    return g;
  }

  function squareRect(r, c, cls) { const [x, y] = screenXY(r, c); return el('rect', { x, y, width: 1, height: 1, class: cls }); }

  function render(view) {
    if (view.flipped != null) flipped = view.flipped;
    lastView = view;
    paint();
  }

  function paint() {
    const view = lastView; const board = view.board;
    squares(); coords();

    gHighlight.innerHTML = '';
    if (view.lastMove) for (const sq of view.lastMove) if (sq) gHighlight.appendChild(squareRect(sq[0], sq[1], 'cb-last'));
    const sel = drag ? drag.from : view.selected;
    if (sel) gHighlight.appendChild(squareRect(sel[0], sel[1], 'cb-sel'));

    gTargets.innerHTML = '';
    const targets = drag ? drag.targets : (view.targets || []);
    for (const t of targets) {
      const [cx, cy] = centre(t.to[0], t.to[1]);
      gTargets.appendChild(t.capture
        ? el('circle', { cx, cy, r: 0.44, class: 'cb-target-cap' })
        : el('circle', { cx, cy, r: 0.16, class: 'cb-target' }));
    }

    gPieces.innerHTML = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || (drag && eqp(drag.from, [r, c]))) continue;
      gPieces.appendChild(pieceNode(r, c, p));
    }

    gAnnot.innerHTML = '';
    for (const m of view.marks || []) {
      const [cx, cy] = centre(m.r, m.c);
      gAnnot.appendChild(el('circle', { cx, cy, r: 0.44, fill: 'none', stroke: m.color || '#f2c14e', 'stroke-width': 0.08, class: 'cb-mark' }));
    }

    gDrag.innerHTML = '';
    if (drag) {
      if (drag.moved && drag.landing) {
        gDrag.appendChild(el('circle', { cx: drag.landing[0] + 0.5, cy: drag.landing[1] + 0.5, r: 0.62, class: 'cb-drag-hover' }));
      }
      const [gx, gy] = [drag.ux, drag.uy - LIFT(drag.pointerType)];
      gDrag.appendChild(discAt(gx, gy, drag.piece, 'cb-drag-piece', 1));
    }
  }

  function rawUnits(e) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return [((e.clientX - rect.left) / rect.width) * 8, ((e.clientY - rect.top) / rect.height) * 8];
  }
  const onBoard = (u) => u && u[0] >= 0 && u[0] < 8 && u[1] >= 0 && u[1] < 8;

  svg.addEventListener('pointerdown', (e) => {
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const u = rawUnits(e); if (!onBoard(u)) return;
    const [r, c] = logical(Math.floor(u[0]), Math.floor(u[1]));
    if (!draggable || !draggable(r, c)) return;
    drag = {
      from: [r, c], piece: lastView.board[r][c], targets: (dragTargets ? dragTargets(r, c) : []),
      ux: u[0], uy: u[1], landing: landingSquare(u[0], u[1], e.pointerType),
      startX: e.clientX, startY: e.clientY, moved: false, pointerType: e.pointerType,
    };
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault(); paint();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const u = rawUnits(e);
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD) drag.moved = true;
    if (u) { drag.ux = u[0]; drag.uy = u[1]; drag.landing = landingSquare(u[0], u[1], drag.pointerType); } else drag.landing = null;
    e.preventDefault(); paint();
  });
  function endDrag(e, cancelled) {
    if (!drag) return;
    const d = drag; drag = null;
    try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    paint();
    if (cancelled) return;
    if (!d.moved) { onSquare?.(d.from[0], d.from[1]); return; }
    const u = rawUnits(e); const sq = u && landingSquare(u[0], u[1], d.pointerType);
    if (!sq) { onDrop?.(d.from, null); return; }
    const [r, c] = logical(sq[0], sq[1]); onDrop?.(d.from, [r, c]);
  }
  svg.addEventListener('pointerup', (e) => {
    if (drag) { e.preventDefault(); endDrag(e, false); return; }
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const u = rawUnits(e); if (!onBoard(u)) return;
    const [r, c] = logical(Math.floor(u[0]), Math.floor(u[1])); onSquare?.(r, c);
  });
  svg.addEventListener('pointercancel', (e) => endDrag(e, true));

  return {
    svg, render,
    setInteractive(v) { interactive = v; svg.classList.toggle('locked', !v); if (!v && drag) { drag = null; paint(); } },
    get flipped() { return flipped; },
  };
}
