// dominoes/js/board.js — interactive board renderer for Dominoes

import { canPlayTile } from './engine.js';

export function createDominoesUI(chainEl, rackEl, onTileClick) {
  return {
    render(state, mySeat) {
      // Render played chain
      chainEl.innerHTML = '';
      if (!state.chain || state.chain.length === 0) {
        chainEl.innerHTML = '<div class="dash-empty">Board is empty. Play any tile from your hand.</div>';
      } else {
        for (const tile of state.chain) {
          const tileEl = document.createElement('div');
          tileEl.className = 'domino-tile';
          tileEl.innerHTML = `
            <div class="domino-half">${tile[0]}</div>
            <div class="domino-divider"></div>
            <div class="domino-half">${tile[1]}</div>
          `;
          chainEl.appendChild(tileEl);
        }
      }

      // Render player hand rack
      rackEl.innerHTML = '';
      const hand = (state.hands && state.hands[mySeat]) || [];
      const isMyTurn = state.turn === mySeat && !state.gameOver;

      hand.forEach((tile, tileIdx) => {
        const tileEl = document.createElement('div');
        const playable = isMyTurn && canPlayTile(tile, state.leftEnd, state.rightEnd);
        tileEl.className = `domino-tile ${playable ? 'playable' : ''}`;
        tileEl.innerHTML = `
          <div class="domino-half">${tile[0]}</div>
          <div class="domino-divider"></div>
          <div class="domino-half">${tile[1]}</div>
        `;

        if (playable) {
          tileEl.addEventListener('click', () => onTileClick(tileIdx, tile));
        }

        rackEl.appendChild(tileEl);
      });
    }
  };
}
