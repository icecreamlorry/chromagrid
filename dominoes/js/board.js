// Dominoes rendering: the played chain and your own rack. A dumb renderer —
// main.js owns all the game logic, including the drag-and-drop gesture (see
// its "Drag and drop" section) — this file only draws what it's told and
// stamps the DOM hooks (data-idx, data-sides, data-chain-end) that gesture
// code needs to find things.
//
// Accessibility (CLAUDE.md §3): a tile's pips are drawn as actual PIP PATTERNS,
// not numerals or colours, and every tile carries an aria-label ("six-four").
// Playability is shown by a dashed outline plus a ▲ marker, never by colour
// alone; the chain's two open ends are labelled in text as well as highlighted.

const PIP_LAYOUT = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};
const WORDS = ['blank', 'one', 'two', 'three', 'four', 'five', 'six'];

function pipDots(n) {
  // Returns dot centres in a 0..1 square half-tile.
  return (PIP_LAYOUT[n] || []).map(([col, row]) => [0.25 + col * 0.25, 0.25 + row * 0.25]);
}

function halfSvg(n) {
  const dots = pipDots(n)
    .map(([x, y]) => `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="0.085" class="dm-pip"/>`)
    .join('');
  return `<svg class="dm-half" viewBox="0 0 1 1" aria-hidden="true">${dots}</svg>`;
}

// One domino. `orientation` 'h' lays it along the chain, 'v' stands it in a
// rack or turns a corner. `style` is raw inline CSS for JS-computed placement
// (chain tiles are positioned absolutely — see layoutChain).
export function tileHtml(tile, { orientation = 'v', cls = '', style = '' } = {}) {
  const [a, b] = tile;
  const klass = `dm-tile dm-${orientation}${cls ? ` ${cls}` : ''}`;
  const styleAttr = style ? ` style="${style}"` : '';
  return `<span class="${klass}"${styleAttr} role="img" aria-label="${WORDS[a]} ${WORDS[b]}">`
    + halfSvg(a)
    + '<span class="dm-divider"></span>'
    + halfSvg(b)
    + '</span>';
}

// ---- Chain layout (pure — unit-tested separately in test/chain-layout.test.mjs) --
//
// A real chain doesn't scroll off the table — it turns a corner and continues
// in the opposite direction. This lays the ordered chain array out as rows of
// straight (horizontal) tiles, boustrophedon-style (row 0 left-to-right, row 1
// right-to-left, row 2 left-to-right, …), with the LAST tile of each row that
// isn't the chain's actual end rendered as a vertical "corner" tile turning
// into the next row. `cols` is chosen from the container width, so by
// construction no tile's right edge can ever exceed `cols * cell` — the whole
// point is that this can never need horizontal scroll, at any chain length.
//
// A straight tile in a right-to-left row has its two halves visually MIRRORED
// (the caller reverses [a,b] to [b,a] before rendering) so the chain still
// reads start-to-end continuously when traced along the snake path — the
// engine's own [leftPip,rightPip] orientation only means "left/right in chain
// order," not "left/right on screen."
export function layoutChain(n, containerWidth, { tileLen = 66, tileWid = 34, gap = 4 } = {}) {
  const cell = tileLen + gap;
  const cols = Math.max(2, Math.floor((containerWidth || cell * 2) / cell));
  const positions = [];
  let row = 0;
  let col = 0;
  let dir = 1; // 1 = left-to-right, -1 = right-to-left
  for (let i = 0; i < n; i++) {
    const centerlineY = row * cell + tileLen / 2;
    const isCorner = col === cols - 1 && i < n - 1;
    if (isCorner) {
      const colX = dir === 1 ? cols - 1 : 0;
      positions.push({
        index: i, rotate: true, mirror: false,
        x: colX * cell + (cell - tileWid) / 2,
        y: centerlineY,
        w: tileWid, h: tileLen,
      });
      row += 1; col = 0; dir = -dir;
    } else {
      const colX = dir === 1 ? col : cols - 1 - col;
      positions.push({
        index: i, rotate: false, mirror: dir === -1,
        x: colX * cell + gap / 2,
        y: centerlineY - tileWid / 2,
        w: tileLen, h: tileWid,
      });
      col += 1;
    }
  }
  const height = positions.reduce((m, p) => Math.max(m, p.y + p.h), 0) + gap;
  return { cols, cell, positions, height };
}

// Tile pitch mirrors the @media (max-width: 420px) breakpoint in
// dominoes/css/style.css's .dm-tile.dm-h/.dm-v rules — keep the two in sync.
function tileMetrics() {
  const small = typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(max-width: 420px)').matches;
  return small ? { tileLen: 58, tileWid: 30 } : { tileLen: 66, tileWid: 34 };
}

export function createDominoesUI(chainEl, rackEl, { onTile, onEnd } = {}) {
  let lastChainState = null;

  function renderChain(state) {
    if (!chainEl) return;
    lastChainState = state;
    if (!state.chain.length) {
      chainEl.innerHTML = '<p class="dm-empty muted">No tiles played yet.</p>';
      return;
    }
    let inner = chainEl.querySelector('.dm-chain-inner');
    if (!inner) { chainEl.innerHTML = '<div class="dm-chain-inner"></div>'; inner = chainEl.querySelector('.dm-chain-inner'); }

    const { tileLen, tileWid } = tileMetrics();
    const containerWidth = inner.clientWidth || chainEl.clientWidth || 300;
    const { positions, height } = layoutChain(state.chain.length, containerWidth, { tileLen, tileWid });
    inner.style.height = `${height}px`;
    inner.innerHTML = positions.map((p) => {
      const raw = state.chain[p.index];
      const tile = p.mirror ? [raw[1], raw[0]] : raw;
      const orientation = p.rotate ? 'v' : 'h';
      // A one-tile chain is BOTH ends at once — mark it "both" rather than
      // just "left" (an if/else-if here would silently drop the "right"
      // marker and make that side undroppable by drag for a fresh chain).
      const isLeft = p.index === 0, isRight = p.index === state.chain.length - 1;
      const end = isLeft && isRight ? ' data-chain-end="both"'
        : isLeft ? ' data-chain-end="left"'
        : isRight ? ' data-chain-end="right"' : '';
      const html = tileHtml(tile, { orientation, cls: 'dm-chain-tile', style: `left:${p.x}px;top:${p.y}px` });
      return end ? html.replace('<span ', `<span${end} `) : html;
    }).join('');

    // Keep the newest tile in view — #screen-game owns the scroll (CLAUDE.md),
    // this chain box never scrolls internally.
    inner.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Re-lay-out on width changes (orientation flip, window resize, sidebar) —
  // cols depends on measured width, so it can silently go stale otherwise.
  if (typeof ResizeObserver !== 'undefined' && chainEl) {
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (lastChainState) renderChain(lastChainState); });
    });
    ro.observe(chainEl);
  }

  function renderRack(state, seat, { playableSides = new Map(), selected = null, interactive = false, draggingIdx = null } = {}) {
    if (!rackEl) return;
    const hand = state.hands?.[seat] || [];
    rackEl.innerHTML = '';
    hand.forEach((tile, i) => {
      if (i === draggingIdx) {
        const ph = document.createElement('span');
        ph.className = 'dm-rack-tile dm-rack-placeholder';
        ph.setAttribute('aria-hidden', 'true');
        rackEl.appendChild(ph);
        return;
      }
      const key = `${tile[0]},${tile[1]}`;
      const sides = playableSides.get(key) || [];
      const playable = sides.length > 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `dm-rack-tile${playable ? ' playable' : ''}${selected === i ? ' selected' : ''}`;
      btn.disabled = !interactive || !playable;
      btn.dataset.idx = String(i);
      btn.dataset.sides = sides.join(',');
      btn.innerHTML = tileHtml(tile, { orientation: 'v' })
        + (playable ? '<span class="dm-playable-mark" aria-hidden="true">▲</span>' : '');
      btn.setAttribute('aria-label',
        `${WORDS[tile[0]]} ${WORDS[tile[1]]}${playable ? ', playable' : ', not playable'}`);
      btn.addEventListener('click', () => onTile?.(i, tile, sides));
      rackEl.appendChild(btn);
    });
    if (!hand.length) rackEl.innerHTML = '<p class="dm-empty muted">Your rack is empty.</p>';
  }

  function renderEnds(state, { choosing = false } = {}) {
    const wrap = document.getElementById('dm-ends');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !choosing);
    if (!choosing) return;
    document.getElementById('dm-end-left').textContent = `◀ ${WORDS[state.leftEnd]}`;
    document.getElementById('dm-end-right').textContent = `${WORDS[state.rightEnd]} ▶`;
  }

  document.getElementById('dm-end-left')?.addEventListener('click', () => onEnd?.('left'));
  document.getElementById('dm-end-right')?.addEventListener('click', () => onEnd?.('right'));

  return { renderChain, renderRack, renderEnds };
}
