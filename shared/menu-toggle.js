// Injects an on/off toggle item into the shared account menu (#app-menu),
// matching the look of the built-in items (used e.g. for the "Confirm moves"
// preference). State is conveyed by the label text, like the turn-alerts item.
//
// Returns { set(on), get() } or null if the menu isn't present yet.

export function addMenuToggle({ id, labelOn, labelOff, svg = '', initial = false, onToggle }) {
  const menu = document.getElementById('app-menu');
  if (!menu || document.getElementById(id)) return null;

  const item = document.createElement('button');
  item.className = 'menu-item';
  item.id = id;
  item.innerHTML = `${svg}<span class="menu-toggle-label"></span>`;
  // Sit above the theme picker / "More games" separator, like the other items.
  const anchor = menu.querySelector('.theme-picker-section') || menu.querySelector('a.menu-sep');
  menu.insertBefore(item, anchor || null);

  const labelEl = item.querySelector('.menu-toggle-label');
  let state = initial;
  function paint() {
    item.classList.toggle('on', state);
    labelEl.textContent = state ? labelOn : labelOff;
  }
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    state = !state;
    paint();
    onToggle?.(state);
  });
  paint();

  return { set(on) { state = on; paint(); }, get() { return state; } };
}
