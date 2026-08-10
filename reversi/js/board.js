// reversi/js/board.js — interactive 8x8 Reversi board UI renderer

import { BOARD_SIZE, CELL_COUNT, DARK, LIGHT, legalMoves, rcToIdx } from './engine.js';

export function createReversiBoard(containerEl, onCellClick) {
  containerEl.innerHTML = '';
  const cells = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const idx = rcToIdx(r, c);
      const cell = document.createElement('div');
      cell.className = 'reversi-cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.dataset.idx = idx;

      cell.addEventListener('click', () => {
        onCellClick(r, c, idx);
      });

      containerEl.appendChild(cell);
      cells.push(cell);
    }
  }

  return {
    render(state, mySeat) {
      const valid = state.turn === mySeat && !state.gameOver ? legalMoves(state.board, mySeat) : new Map();

      for (let i = 0; i < CELL_COUNT; i++) {
        const cell = cells[i];
        const val = state.board[i];

        cell.classList.toggle('valid', valid.has(i));

        let disc = cell.querySelector('.disc');
        if (val === 0) {
          if (disc) disc.remove();
        } else {
          const isDark = val === DARK;
          const discClass = isDark ? 'dark' : 'light';
          if (!disc) {
            disc = document.createElement('div');
            disc.className = `disc ${discClass}`;
            cell.appendChild(disc);
          } else if (!disc.classList.contains(discClass)) {
            disc.className = `disc ${discClass} flip-anim`;
            setTimeout(() => disc.classList.remove('flip-anim'), 350);
          }
        }
      }
    }
  };
}
