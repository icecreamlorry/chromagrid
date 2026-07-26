// "Confirm moves" preference, shared by the turn-based table games. When on, a
// chosen move is staged as a preview and only played once the player confirms
// (a Confirm button, or re-tapping the destination); when off, moves play
// instantly. Stored per game slug in localStorage and toggled from the burger
// menu. Weiqi has always confirmed (default on); Chess offers it too.

import { addMenuToggle } from './menu-toggle.js';

const KEY = (slug) => `${slug}.confirmMoves`;

export function confirmEnabled(slug, dflt = true) {
  try {
    const v = localStorage.getItem(KEY(slug));
    return v == null ? dflt : v === '1';
  } catch { return dflt; }
}

export function setConfirm(slug, on) {
  try { localStorage.setItem(KEY(slug), on ? '1' : '0'); } catch { /* storage blocked */ }
}

const ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.5 3.2h11a1 1 0 0 1 1 1v7.6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1Z"/>
    <path d="M5 8.2 7.2 10.3 11.2 5.9"/>
  </svg>`;

// Inject the toggle and return its handle ({ set, get }), or null.
export function injectConfirmToggle(slug, dflt = true, onChange) {
  return addMenuToggle({
    id: 'menu-confirm',
    labelOn: 'Confirm moves: on',
    labelOff: 'Confirm moves: off',
    svg: ICON,
    initial: confirmEnabled(slug, dflt),
    onToggle: (on) => { setConfirm(slug, on); onChange?.(on); },
  });
}
