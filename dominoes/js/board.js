// Dominoes rendering: the played chain and your own rack. A dumb renderer —
// main.js owns all the game logic.
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

function pipDots(n, vertical) {
  // Returns dot centres in a 0..1 square half-tile.
  return (PIP_LAYOUT[n] || []).map(([col, row]) => {
    const x = 0.25 + col * 0.25;
    const y = 0.25 + row * 0.25;
    return vertical ? [x, y] : [x, y];
  });
}

function halfSvg(n, vertical) {
  const dots = pipDots(n, vertical)
    .map(([x, y]) => `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="0.085" class="dm-pip"/>`)
    .join('');
  return `<svg class="dm-half" viewBox="0 0 1 1" aria-hidden="true">${dots}</svg>`;
}

// One domino. `orientation` 'h' lays it along the chain, 'v' stands it in a rack.
export function tileHtml(tile, { orientation = 'v', cls = '' } = {}) {
  const [a, b] = tile;
  const klass = `dm-tile dm-${orientation}${cls ? ` ${cls}` : ''}`;
  const vertical = orientation === 'v';
  return `<span class="${klass}" role="img" aria-label="${WORDS[a]} ${WORDS[b]}">`
    + halfSvg(a, vertical)
    + '<span class="dm-divider"></span>'
    + halfSvg(b, vertical)
    + '</span>';
}

export function createDominoesUI(chainEl, rackEl, { onTile, onEnd } = {}) {
  function renderChain(state) {
    if (!chainEl) return;
    if (!state.chain.length) {
      chainEl.innerHTML = '<p class="dm-empty muted">No tiles played yet.</p>';
      return;
    }
    const tiles = state.chain.map((t) => tileHtml(t, { orientation: 'h' })).join('');
    chainEl.innerHTML = `<div class="dm-chain-inner">${tiles}</div>`;
    // Keep the most recent end in view on a long chain.
    chainEl.scrollLeft = chainEl.scrollWidth;
  }

  function renderRack(state, seat, { playableSides = new Map(), selected = null, interactive = false } = {}) {
    if (!rackEl) return;
    const hand = state.hands?.[seat] || [];
    rackEl.innerHTML = '';
    hand.forEach((tile, i) => {
      const key = `${tile[0]},${tile[1]}`;
      const sides = playableSides.get(key) || [];
      const playable = sides.length > 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `dm-rack-tile${playable ? ' playable' : ''}${selected === i ? ' selected' : ''}`;
      btn.disabled = !interactive || !playable;
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
