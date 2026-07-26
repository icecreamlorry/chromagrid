// Shared SVG chess-board renderer + input, used by both the live game and the
// tutorial. One component draws the 8×8 board, coordinate labels, pieces,
// highlights (last move, selection, check), legal-move dots, and a tutorial
// annotation layer (rings, arrows, region outlines, ghost pieces, labels).
//
// The board is drawn in a fixed 8×8 unit viewBox. A `flipped` flag swaps the
// mapping between logical squares (row 0 = rank 8) and screen squares so each
// player can view the board from their own side.
//
// Input supports BOTH tap-to-move and drag-and-drop from a single pointer
// pipeline:
//   • tap a piece then tap a destination (via onSquare), or
//   • press-and-drag a piece to a square (via onDrop). While dragging, the piece
//     floats slightly above the finger so it isn't hidden, the square under the
//     pointer is highlighted (legal or not), and the piece's legal-move dots stay
//     visible.
// The controller supplies draggable()/dragTargets() so the board knows which
// pieces may be picked up and where their legal dots go, without owning game
// state itself.

const SVGNS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';

// Filled Unicode chess glyphs used for BOTH colours (coloured via fill/stroke)
// so the two sides are clean, matching silhouettes rather than the mismatched
// outline/solid pair Unicode ships.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag

function el(name, attrs = {}) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createBoard(container, {
  onSquare, draggable, dragTargets, onDrop,
} = {}) {
  let flipped = false;
  let interactive = true;
  let lastView = { board: emptyBoard() };
  let lastAnn = {};
  // Active drag, or null. { from:[r,c], piece, targets, sx, sy(px), hoverScreen,
  //   startX, startY, moved, pointerType }
  let drag = null;

  const svg = el('svg', { class: 'chessboard', xmlns: SVGNS, viewBox: '0 0 8 8' });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  container.innerHTML = '';
  container.appendChild(svg);

  const defs = el('defs');
  defs.innerHTML = `<marker id="cb-arrow-head" viewBox="0 0 10 10" refX="7" refY="5"
      markerWidth="4" markerHeight="4" orient="auto-start-reverse">
      <path d="M0 1 L9 5 L0 9 z" fill="context-stroke"/></marker>`;
  const gSquares = el('g', { class: 'cb-squares' });
  const gHighlight = el('g', { class: 'cb-highlight' });
  const gCoords = el('g', { class: 'cb-coords' });
  const gTargets = el('g', { class: 'cb-targets' });
  const gPieces = el('g', { class: 'cb-pieces' });
  const gAnnot = el('g', { class: 'cb-annot' });
  const gDrag = el('g', { class: 'cb-drag' });
  svg.append(defs, gSquares, gHighlight, gCoords, gTargets, gPieces, gAnnot, gDrag);

  function emptyBoard() { return Array.from({ length: 8 }, () => Array(8).fill(null)); }

  // Logical (r,c) → screen top-left (x,y).
  function screenXY(r, c) { return flipped ? [7 - c, 7 - r] : [c, r]; }
  function centre(r, c) { const [x, y] = screenXY(r, c); return [x + 0.5, y + 0.5]; }
  // Screen square (sx,sy) → logical (r,c).
  function logical(sx, sy) { return flipped ? [7 - sy, 7 - sx] : [sy, sx]; }
  const eqp = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

  // How far the dragged piece floats above the finger (board units) — a big lift
  // on touch so the finger doesn't hide it, a small one for a mouse cursor.
  const LIFT = (pt) => (pt === 'touch' ? 0.85 : 0.1);
  // The screen square under the floating piece's CENTRE (not the finger), so the
  // landing indicator sits where the piece visibly is. null if that's off-board.
  function landingSquare(ux, uy, pt) {
    const sx = Math.floor(ux), sy = Math.floor(uy - LIFT(pt));
    return (sx < 0 || sx > 7 || sy < 0 || sy > 7) ? null : [sx, sy];
  }

  function buildSquares() {
    gSquares.innerHTML = '';
    for (let sy = 0; sy < 8; sy++) {
      for (let sx = 0; sx < 8; sx++) {
        gSquares.appendChild(el('rect', {
          x: sx, y: sy, width: 1, height: 1,
          class: `cb-sq ${(sx + sy) % 2 === 0 ? 'light' : 'dark'}`,
        }));
      }
    }
  }
  buildSquares();

  function renderCoords() {
    gCoords.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const file = flipped ? FILES[7 - i] : FILES[i];
      const rank = flipped ? i + 1 : 8 - i;
      const fT = el('text', { x: i + 0.92, y: 7.94, class: 'cb-coord', 'text-anchor': 'end' });
      fT.textContent = file;
      gCoords.appendChild(fT);
      const rT = el('text', { x: 0.06, y: i + 0.24, class: 'cb-coord' });
      rT.textContent = rank;
      gCoords.appendChild(rT);
    }
  }

  function pieceNode(r, c, piece, cls = '', opacity = 1) {
    const [cx, cy] = centre(r, c);
    return glyphAt(cx, cy, piece, cls, opacity);
  }
  function glyphAt(cx, cy, piece, cls = '', opacity = 1) {
    const t = el('text', {
      x: cx, y: cy, class: `cb-piece ${piece[0] === 'w' ? 'white' : 'black'} ${cls}`.trim(),
      'text-anchor': 'middle', 'dominant-baseline': 'central',
    });
    if (opacity !== 1) t.setAttribute('opacity', opacity);
    t.textContent = GLYPH[piece[1]];
    return t;
  }

  function squareRect(r, c, cls) {
    const [x, y] = screenXY(r, c);
    return el('rect', { x, y, width: 1, height: 1, class: cls });
  }

  function dotAt(r, c, capture) {
    const [cx, cy] = centre(r, c);
    return capture
      ? el('circle', { cx, cy, r: 0.46, class: 'cb-target-cap' })
      : el('circle', { cx, cy, r: 0.16, class: 'cb-target' });
  }

  // Public entry: set the view model + tutorial annotations, then paint.
  function render(view, annotations = {}) {
    if (view.flipped != null) flipped = view.flipped;
    lastView = view;
    lastAnn = annotations || {};
    paint();
  }

  // Draw everything from lastView/lastAnn plus any live drag state.
  function paint() {
    const view = lastView;
    const board = view.board;
    renderCoords();

    // Highlights (under pieces): last move, selection, check, and — during a
    // drag — the origin square and the hovered square (legal or not).
    gHighlight.innerHTML = '';
    if (view.lastMove) {
      for (const sq of [view.lastMove.from, view.lastMove.to]) {
        if (sq) gHighlight.appendChild(squareRect(sq[0], sq[1], 'cb-last'));
      }
    }
    if (view.staged) {
      for (const sq of [view.staged.from, view.staged.to]) {
        if (sq) gHighlight.appendChild(squareRect(sq[0], sq[1], 'cb-staged'));
      }
    }
    const sel = drag ? drag.from : view.selected;
    if (sel) gHighlight.appendChild(squareRect(sel[0], sel[1], 'cb-sel'));
    if (view.check) gHighlight.appendChild(squareRect(view.check[0], view.check[1], 'cb-check'));

    // Legal-move dots — the dragged piece's during a drag, else the selection's.
    gTargets.innerHTML = '';
    const targets = drag ? drag.targets : (view.targets || []);
    for (const tgt of targets) gTargets.appendChild(dotAt(tgt.to[0], tgt.to[1], tgt.capture));

    // Pieces (skip the one being dragged — it's drawn lifted in gDrag).
    gPieces.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        if (drag && eqp(drag.from, [r, c])) continue;
        gPieces.appendChild(pieceNode(r, c, p));
      }
    }

    renderAnnotations(lastAnn);

    // Drop indicator (a translucent circle a touch bigger than a square, so it's
    // unmistakable) under the floating piece, then the lifted piece on top.
    gDrag.innerHTML = '';
    if (drag) {
      if (drag.moved && drag.landing) {
        gDrag.appendChild(el('circle', {
          cx: drag.landing[0] + 0.5, cy: drag.landing[1] + 0.5, r: 0.62, class: 'cb-drag-hover',
        }));
      }
      gDrag.appendChild(glyphAt(drag.ux, drag.uy - LIFT(drag.pointerType), drag.piece, 'cb-drag-piece'));
    }
  }

  function renderAnnotations({ marks = [], arrows = [], regions = [], labels = [], ghosts = [] } = {}) {
    gAnnot.innerHTML = '';
    for (const rg of regions) {
      const xs = rg.points.map((p) => screenXY(p[0], p[1])[0]);
      const ys = rg.points.map((p) => screenXY(p[0], p[1])[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      const w = Math.max(...xs) - x + 1, h = Math.max(...ys) - y + 1;
      gAnnot.appendChild(el('rect', {
        x: x + 0.06, y: y + 0.06, width: w - 0.12, height: h - 0.12, rx: 0.12,
        class: 'cb-region', stroke: rg.color || '#f2c14e',
        'stroke-dasharray': rg.dashed === false ? 'none' : '0.22 0.16',
      }));
    }
    for (const gh of ghosts) gAnnot.appendChild(pieceNode(gh.r, gh.c, gh.piece, 'cb-ghost', gh.opacity ?? 0.45));
    for (const m of marks) {
      const [cx, cy] = centre(m.r, m.c);
      const color = m.color || '#f2c14e';
      if (m.shape === 'dot') {
        gAnnot.appendChild(el('circle', { cx, cy, r: 0.16, fill: color, class: 'cb-mark' }));
      } else if (m.shape === 'square') {
        gAnnot.appendChild(el('rect', { x: cx - 0.42, y: cy - 0.42, width: 0.84, height: 0.84, fill: 'none', stroke: color, 'stroke-width': 0.07, class: 'cb-mark' }));
      } else if (m.shape === 'cross') {
        gAnnot.appendChild(el('path', { d: `M${cx - 0.3} ${cy - 0.3} L${cx + 0.3} ${cy + 0.3} M${cx + 0.3} ${cy - 0.3} L${cx - 0.3} ${cy + 0.3}`, stroke: color, 'stroke-width': 0.08, class: 'cb-mark' }));
      } else {
        gAnnot.appendChild(el('circle', { cx, cy, r: 0.44, fill: 'none', stroke: color, 'stroke-width': 0.08, class: 'cb-mark' }));
      }
    }
    for (const a of arrows) {
      const [x1, y1] = centre(a.from[0], a.from[1]);
      const [x2, y2] = centre(a.to[0], a.to[1]);
      gAnnot.appendChild(el('line', {
        x1, y1, x2, y2, class: 'cb-arrow', 'stroke-width': 0.14,
        stroke: a.color || '#e8604c', 'marker-end': 'url(#cb-arrow-head)',
      }));
    }
    for (const l of labels) {
      const [cx, cy] = centre(l.r, l.c);
      const t = el('text', {
        x: cx, y: cy, class: 'cb-label', 'text-anchor': 'middle',
        'dominant-baseline': 'central', fill: l.color || '#f2c14e',
      });
      t.textContent = l.text;
      gAnnot.appendChild(t);
    }
  }

  // Continuous screen units from a pointer event (unclamped), or null if the SVG
  // isn't laid out yet.
  function rawUnits(e) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return [((e.clientX - rect.left) / rect.width) * 8, ((e.clientY - rect.top) / rect.height) * 8];
  }
  const onBoard = (u) => u && u[0] >= 0 && u[0] < 8 && u[1] >= 0 && u[1] < 8;

  svg.addEventListener('pointerdown', (e) => {
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const u = rawUnits(e);
    if (!onBoard(u)) return;
    const [r, c] = logical(Math.floor(u[0]), Math.floor(u[1]));
    if (!draggable || !draggable(r, c)) return; // let it fall through to a tap
    drag = {
      from: [r, c], piece: lastView.board[r][c],
      targets: (dragTargets ? dragTargets(r, c) : []),
      ux: u[0], uy: u[1], landing: landingSquare(u[0], u[1], e.pointerType),
      startX: e.clientX, startY: e.clientY, moved: false,
      pointerType: e.pointerType,
    };
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
    paint();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const u = rawUnits(e);
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD) drag.moved = true;
    if (u) { drag.ux = u[0]; drag.uy = u[1]; drag.landing = landingSquare(u[0], u[1], drag.pointerType); }
    else drag.landing = null;
    e.preventDefault();
    paint();
  });

  function endDrag(e, cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    paint(); // restore the (undragged) board first
    if (cancelled) return;
    if (!d.moved) { onSquare?.(d.from[0], d.from[1]); return; } // a tap, not a drag
    const u = rawUnits(e);
    const sq = u && landingSquare(u[0], u[1], d.pointerType);
    if (!sq) { onDrop?.(d.from, null); return; } // dropped off-board
    const [r, c] = logical(sq[0], sq[1]);
    onDrop?.(d.from, [r, c]);
  }

  svg.addEventListener('pointerup', (e) => {
    if (drag) { e.preventDefault(); endDrag(e, false); return; }
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const u = rawUnits(e);
    if (!onBoard(u)) return;
    const [r, c] = logical(Math.floor(u[0]), Math.floor(u[1]));
    onSquare?.(r, c);
  });
  svg.addEventListener('pointercancel', (e) => endDrag(e, true));

  return {
    svg,
    render,
    setFlipped(v) { flipped = v; },
    setInteractive(v) { interactive = v; svg.classList.toggle('locked', !v); if (!v && drag) { drag = null; paint(); } },
    get flipped() { return flipped; },
  };
}
