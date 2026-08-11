// SVG Reversi board renderer + input. An 8×8 grid of discs with legal-move
// hints, a last-move marker and flip highlights. A dumb renderer — main.js owns
// all the game logic.
//
// Accessibility (CLAUDE.md §3): dark and light discs already differ in
// lightness, but colour is never the ONLY cue — every disc also carries a shape
// glyph (● filled ring for dark, ○ open ring for light) and each square gets an
// aria-label naming its contents, so the board reads correctly in greyscale and
// to a screen reader. Legal-move hints are a dashed open circle, visibly
// different in form from a played disc rather than merely a different colour.

const SVGNS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';

function el(name, attrs = {}) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createBoard(container, { onSquare } = {}) {
  let flipped = false;
  let interactive = true;
  let lastView = { board: empty() };

  const svg = el('svg', { class: 'reversiboard', xmlns: SVGNS, viewBox: '0 0 8 8', role: 'img' });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  container.innerHTML = '';
  container.appendChild(svg);

  const gSquares = el('g');
  const gGrid = el('g');
  const gHighlight = el('g');
  const gTargets = el('g');
  const gPieces = el('g');
  const gCoords = el('g');
  svg.append(gSquares, gGrid, gHighlight, gTargets, gPieces, gCoords);

  function empty() { return Array.from({ length: 8 }, () => Array(8).fill(null)); }
  function screenXY(r, c) { return flipped ? [7 - c, 7 - r] : [c, r]; }
  function centre(r, c) { const [x, y] = screenXY(r, c); return [x + 0.5, y + 0.5]; }
  function logical(sx, sy) { return flipped ? [7 - sy, 7 - sx] : [sy, sx]; }

  function squares() {
    gSquares.innerHTML = '';
    gGrid.innerHTML = '';
    for (let sy = 0; sy < 8; sy++) {
      for (let sx = 0; sx < 8; sx++) {
        gSquares.appendChild(el('rect', { x: sx, y: sy, width: 1, height: 1, class: 'rv-sq' }));
      }
    }
    for (let i = 0; i <= 8; i++) {
      gGrid.appendChild(el('line', { x1: i, y1: 0, x2: i, y2: 8, class: 'rv-grid' }));
      gGrid.appendChild(el('line', { x1: 0, y1: i, x2: 8, y2: i, class: 'rv-grid' }));
    }
  }

  function coords() {
    gCoords.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const file = flipped ? FILES[7 - i] : FILES[i];
      const rank = flipped ? i + 1 : 8 - i;
      const f = el('text', { x: i + 0.92, y: 7.94, class: 'rv-coord', 'text-anchor': 'end' });
      f.textContent = file; gCoords.appendChild(f);
      const rk = el('text', { x: 0.06, y: i + 0.24, class: 'rv-coord' });
      rk.textContent = rank; gCoords.appendChild(rk);
    }
  }

  // A disc: body + a shape glyph that survives greyscale (dark = filled centre,
  // light = open ring), plus a label for assistive tech.
  function discNode(r, c, colour, cls = '') {
    const [cx, cy] = centre(r, c);
    const dark = colour === 'd';
    const g = el('g', { class: `rv-piece ${dark ? 'dark' : 'light'} ${cls}`.trim(), role: 'img' });
    const label = el('title');
    label.textContent = `${FILES[c]}${8 - r}: ${dark ? 'dark ●' : 'light ○'}`;
    g.appendChild(label);
    g.appendChild(el('circle', { cx, cy: cy + 0.03, r: 0.4, class: 'rv-disc-shadow' }));
    g.appendChild(el('circle', { cx, cy, r: 0.4, class: 'rv-disc' }));
    g.appendChild(el('circle', { cx, cy, r: dark ? 0.15 : 0.22, class: 'rv-disc-glyph' }));
    return g;
  }

  function render(view) {
    if (view.flipped != null) flipped = view.flipped;
    lastView = view;
    paint();
  }

  function paint() {
    const view = lastView;
    const board = view.board;
    squares(); coords();

    gHighlight.innerHTML = '';
    if (view.lastMove) {
      const [x, y] = screenXY(view.lastMove[0], view.lastMove[1]);
      gHighlight.appendChild(el('rect', { x, y, width: 1, height: 1, class: 'rv-last' }));
    }

    gTargets.innerHTML = '';
    for (const t of view.targets || []) {
      const [cx, cy] = centre(t[0], t[1]);
      gTargets.appendChild(el('circle', { cx, cy, r: 0.33, class: 'rv-target' }));
    }

    gPieces.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        const justFlipped = (view.flips || []).some(([fr, fc]) => fr === r && fc === c);
        gPieces.appendChild(discNode(r, c, p, justFlipped ? 'flipped' : ''));
      }
    }

    const counts = view.counts;
    if (counts) {
      svg.setAttribute('aria-label',
        `Reversi board, ${counts.dark} dark and ${counts.light} light discs.`);
    }
  }

  function rawUnits(e) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return [((e.clientX - rect.left) / rect.width) * 8, ((e.clientY - rect.top) / rect.height) * 8];
  }
  const onBoard = (u) => u && u[0] >= 0 && u[0] < 8 && u[1] >= 0 && u[1] < 8;

  svg.addEventListener('pointerup', (e) => {
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const u = rawUnits(e);
    if (!onBoard(u)) return;
    const [r, c] = logical(Math.floor(u[0]), Math.floor(u[1]));
    onSquare?.(r, c);
  });

  return {
    svg, render,
    setInteractive(v) { interactive = v; svg.classList.toggle('locked', !v); },
    get flipped() { return flipped; },
  };
}
