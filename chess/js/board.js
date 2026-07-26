// Shared SVG chess-board renderer + input, used by both the live game and the
// tutorial. One component draws the 8×8 board, coordinate labels, pieces,
// highlights (last move, selection, check), legal-move dots, and a tutorial
// annotation layer (rings, arrows, region outlines, ghost pieces, labels).
//
// The board is drawn in a fixed 8×8 unit viewBox. A `flipped` flag swaps the
// mapping between logical squares (row 0 = rank 8) and screen squares so each
// player can view the board from their own side. Input is a single pointerup
// handler that maps the click back to a logical square — no per-cell listeners,
// no pointer capture, which sidesteps the usual hit-test pitfalls.

const SVGNS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';

// Filled Unicode chess glyphs used for BOTH colours (coloured via fill/stroke)
// so the two sides are clean, matching silhouettes rather than the mismatched
// outline/solid pair Unicode ships.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function el(name, attrs = {}) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createBoard(container, { onSquare } = {}) {
  let flipped = false;
  let interactive = true;

  const svg = el('svg', { class: 'chessboard', xmlns: SVGNS, viewBox: '0 0 8 8' });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  container.innerHTML = '';
  container.appendChild(svg);

  const gSquares = el('g', { class: 'cb-squares' });
  const gHighlight = el('g', { class: 'cb-highlight' });
  const gCoords = el('g', { class: 'cb-coords' });
  const gPieces = el('g', { class: 'cb-pieces' });
  const gTargets = el('g', { class: 'cb-targets' });
  const gAnnot = el('g', { class: 'cb-annot' });
  svg.append(gSquares, gHighlight, gCoords, gPieces, gTargets, gAnnot);

  buildSquares();

  // Logical (r,c) → screen (top-left x,y) of its square.
  function screenXY(r, c) {
    return flipped ? [7 - c, 7 - r] : [c, r];
  }
  function centre(r, c) {
    const [x, y] = screenXY(r, c);
    return [x + 0.5, y + 0.5];
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

  function renderCoords() {
    gCoords.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      // File letters along the bottom rank, rank numbers up the left file.
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

  // Draw the board from a view model + optional tutorial annotations.
  //   view: { board, flipped?, lastMove?, check?, selected?, targets? }
  //   annotations: { marks, arrows, regions, labels, ghosts }
  function render(view, annotations = {}) {
    if (view.flipped != null && view.flipped !== flipped) { flipped = view.flipped; }
    buildSquares();
    renderCoords();
    const board = view.board;

    // Highlights (under the pieces).
    gHighlight.innerHTML = '';
    if (view.lastMove) {
      for (const sq of [view.lastMove.from, view.lastMove.to]) {
        if (sq) gHighlight.appendChild(squareRect(sq[0], sq[1], 'cb-last'));
      }
    }
    if (view.selected) gHighlight.appendChild(squareRect(view.selected[0], view.selected[1], 'cb-sel'));
    if (view.check) gHighlight.appendChild(squareRect(view.check[0], view.check[1], 'cb-check'));

    // Pieces.
    gPieces.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p) gPieces.appendChild(pieceNode(r, c, p));
      }
    }

    // Legal-move targets: a dot on empty squares, a ring on captures.
    gTargets.innerHTML = '';
    for (const tgt of view.targets || []) {
      const [cx, cy] = centre(tgt.to[0], tgt.to[1]);
      if (tgt.capture) {
        gTargets.appendChild(el('circle', { cx, cy, r: 0.46, class: 'cb-target-cap' }));
      } else {
        gTargets.appendChild(el('circle', { cx, cy, r: 0.16, class: 'cb-target' }));
      }
    }

    renderAnnotations(annotations);
  }

  function renderAnnotations({ marks = [], arrows = [], regions = [], labels = [], ghosts = [] } = {}) {
    gAnnot.innerHTML = '';

    // Region outline around a set of squares — "draw around a formation".
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

    // Ghost pieces — translucent, showing a suggested move/placement.
    for (const gh of ghosts) {
      gAnnot.appendChild(pieceNode(gh.r, gh.c, gh.piece, 'cb-ghost', gh.opacity ?? 0.45));
    }

    // Point marks (ring / dot / cross / square).
    for (const m of marks) {
      const [cx, cy] = centre(m.r, m.c);
      const color = m.color || '#f2c14e';
      if (m.shape === 'dot') {
        gAnnot.appendChild(el('circle', { cx, cy, r: 0.16, fill: color, class: 'cb-mark' }));
      } else if (m.shape === 'square') {
        gAnnot.appendChild(el('rect', { x: cx - 0.42, y: cy - 0.42, width: 0.84, height: 0.84, fill: 'none', stroke: color, 'stroke-width': 0.07, class: 'cb-mark' }));
      } else if (m.shape === 'cross') {
        gAnnot.appendChild(el('path', { d: `M${cx - 0.3} ${cy - 0.3} L${cx + 0.3} ${cy + 0.3} M${cx + 0.3} ${cy - 0.3} L${cx - 0.3} ${cy + 0.3}`, stroke: color, 'stroke-width': 0.08, class: 'cb-mark' }));
      } else { // ring
        gAnnot.appendChild(el('circle', { cx, cy, r: 0.44, fill: 'none', stroke: color, 'stroke-width': 0.08, class: 'cb-mark' }));
      }
    }

    // Arrows between square centres.
    for (const a of arrows) {
      const [x1, y1] = centre(a.from[0], a.from[1]);
      const [x2, y2] = centre(a.to[0], a.to[1]);
      const line = el('line', {
        x1, y1, x2, y2, class: 'cb-arrow', 'stroke-width': 0.14,
        stroke: a.color || '#e8604c', 'marker-end': 'url(#cb-arrow-head)',
      });
      gAnnot.appendChild(line);
    }

    // Text labels centred on squares.
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

  // Arrow-head marker (defined once).
  const defs = el('defs');
  defs.innerHTML = `<marker id="cb-arrow-head" viewBox="0 0 10 10" refX="7" refY="5"
      markerWidth="4" markerHeight="4" orient="auto-start-reverse">
      <path d="M0 1 L9 5 L0 9 z" fill="context-stroke"/></marker>`;
  svg.insertBefore(defs, gSquares);

  function squareFromEvent(e) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const sx = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const sy = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (sx < 0 || sx > 7 || sy < 0 || sy > 7) return null;
    // Reverse the flip to recover the logical square.
    return flipped ? [7 - sy, 7 - sx] : [sy, sx];
  }

  svg.addEventListener('pointerup', (e) => {
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sq = squareFromEvent(e);
    if (sq) onSquare?.(sq[0], sq[1]);
  });

  return {
    svg,
    render,
    setFlipped(v) { flipped = v; },
    setInteractive(v) { interactive = v; svg.classList.toggle('locked', !v); },
    get flipped() { return flipped; },
  };
}
