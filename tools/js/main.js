// Tools — a home for handy utilities. Screen routing is the URL hash
// (#anagram), so the browser back button returns to the tool list, and each
// tool keeps its own state in localStorage so a refresh doesn't lose it.

import {
  parseLengths, parseLetters, resizeLocked, lockLetter, unlockLetter,
  reshuffle, view, MAX_TOTAL,
} from './anagram.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'tools.anagram';

// ---- Screens ---------------------------------------------------------------

const TOOLS = new Set(['anagram']);

function currentTool() {
  const h = location.hash.replace(/^#/, '');
  return TOOLS.has(h) ? h : null;
}

function showScreen() {
  const tool = currentTool();
  $('screen-landing').classList.toggle('hidden', !!tool);
  $('screen-anagram').classList.toggle('hidden', tool !== 'anagram');
  if (tool === 'anagram') anagram.onShow();
}

$('btn-back').addEventListener('click', (e) => {
  e.preventDefault();
  // Drop the hash without leaving a stray "#" or a history entry behind.
  history.replaceState(null, '', location.pathname + location.search);
  showScreen();
});
window.addEventListener('hashchange', showScreen);

// ---- Anagram helper ---------------------------------------------------------

const anagram = (() => {
  const model = {
    lengths: [9],
    locked: new Array(9).fill(null),
    poolText: '',
    order: [],
  };
  let cells = [];        // <input> per box, in reading order
  let builtShape = '';   // lengths the boxes were last built for

  function total() { return model.lengths.reduce((a, b) => a + b, 0); }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); } catch (e) {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      const lengths = Array.isArray(s.lengths) ? parseLengths(s.lengths.join(',')) : [];
      if (!lengths.length) return;
      model.lengths = lengths;
      model.locked = resizeLocked(Array.isArray(s.locked) ? s.locked.map((l) => (typeof l === 'string' && /^[A-Z]$/.test(l) ? l : null)) : [], total());
      model.poolText = typeof s.poolText === 'string' ? s.poolText.slice(0, 60) : '';
      model.order = Array.isArray(s.order) ? s.order.filter((l) => /^[A-Z]$/.test(l)) : [];
    } catch (e) {}
  }

  // Build one <input> per box, grouped by word. Only re-run when the shape
  // changes — otherwise typing would lose focus on every keystroke.
  function buildCells() {
    const shape = model.lengths.join(',');
    if (shape === builtShape) return;
    builtShape = shape;
    const host = $('ana-words');
    host.innerHTML = '';
    // Cell-widths the shape needs on one line (a word gap counts as one cell).
    host.style.setProperty('--n', String(total() + model.lengths.length - 1));
    cells = [];
    let idx = 0;
    model.lengths.forEach((len, w) => {
      const word = document.createElement('div');
      word.className = 'ana-word';
      word.setAttribute('aria-label', `Word ${w + 1}, ${len} letters`);
      for (let i = 0; i < len; i++) {
        const wrap = document.createElement('span');
        wrap.className = 'ana-cellwrap';
        const inp = document.createElement('input');
        inp.className = 'ana-cell';
        inp.type = 'text';
        // No maxlength: typing over a box that already shows a letter must
        // still register (iOS doesn't always honour select() on focus), so the
        // input handler simply takes the LAST letter typed.
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.setAttribute('autocapitalize', 'characters');
        inp.setAttribute('inputmode', 'text');
        inp.setAttribute('aria-label', `Letter ${i + 1} of ${len}${model.lengths.length > 1 ? `, word ${w + 1}` : ''}`);
        inp.dataset.slot = String(idx);
        wireCell(inp, idx);
        wrap.appendChild(inp);
        word.appendChild(wrap);
        cells.push(inp);
        idx++;
      }
      host.appendChild(word);
    });
  }

  function wireCell(inp, slot) {
    // Always select on focus so a keystroke REPLACES the box's letter (maxlength 1
    // would otherwise swallow typing over a locked letter).
    inp.addEventListener('focus', () => {
      inp.select();
      setTimeout(() => { try { inp.setSelectionRange(0, inp.value.length); } catch (e) {} }, 0);
    });
    inp.addEventListener('input', () => {
      const letters = parseLetters(inp.value);
      const letter = letters.length ? letters[letters.length - 1] : null;
      if (letter) {
        Object.assign(model, lockLetter(model, slot, letter));
        render();
        focusCell(slot + 1);
      } else if (model.locked[slot]) {
        Object.assign(model, unlockLetter(model, slot));
        render();
      } else {
        render();   // restore the shuffled letter the keystroke wiped
      }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); focusCell(slot - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(slot + 1); }
      else if (e.key === 'Backspace' && !model.locked[slot]) {
        // Crossword feel: backspace on an empty/shuffled box steps back and
        // clears the letter there, ready to retype.
        e.preventDefault();
        if (slot > 0) {
          if (model.locked[slot - 1]) { Object.assign(model, unlockLetter(model, slot - 1)); render(); }
          focusCell(slot - 1);
        }
      } else if (e.key === 'Delete' && model.locked[slot]) {
        e.preventDefault();
        Object.assign(model, unlockLetter(model, slot));
        render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        shuffleNow();
      }
    });
  }

  function focusCell(slot) {
    const c = cells[Math.max(0, Math.min(cells.length - 1, slot))];
    if (!c) return;
    c.focus();
    c.select();
  }

  function shuffleNow() {
    model.order = reshuffle(view(model).order);
    render();
  }

  function setLengths(lengths, { keepInput = false } = {}) {
    if (!lengths.length) return;
    model.lengths = lengths;
    model.locked = resizeLocked(model.locked, total());
    if (!keepInput) $('ana-length').value = lengths.join(',');
    render();
  }

  function render() {
    buildCells();
    const v = view(model);
    model.order = v.order;

    cells.forEach((inp, i) => {
      const locked = model.locked[i];
      const value = locked || v.fill[i] || '';
      if (inp.value !== value) inp.value = value;
      inp.classList.toggle('locked', !!locked && !v.missing[i]);
      inp.classList.toggle('missing', !!locked && v.missing[i]);
      inp.classList.toggle('jumbled', !locked && !!v.fill[i]);
      inp.parentElement.classList.toggle('missing', !!locked && v.missing[i]);
      inp.title = locked
        ? (v.missing[i] ? `${locked} isn't in your letters` : `${locked} — locked in by you (Backspace to clear)`)
        : (v.fill[i] ? 'Shuffled from your letters — type over it to lock a letter' : 'Type a letter you know');
    });

    // Status: does the fodder match the answer length?
    const st = $('ana-status');
    st.classList.remove('ok', 'warn');
    if (!v.pool.length) {
      st.textContent = `${v.total} boxes · type the anagram's letters below to fill them`;
    } else if (v.balance === 0 && !v.missing.some(Boolean)) {
      st.textContent = `✓ ${v.pool.length} letters for ${v.total} boxes`;
      st.classList.add('ok');
    } else if (v.missing.some(Boolean)) {
      const bad = [...new Set(model.locked.filter((l, i) => l && v.missing[i]))].join(', ');
      st.textContent = `✕ ${bad} ${bad.length > 1 ? "aren't" : "isn't"} in your letters — check the fodder or the box`;
      st.classList.add('warn');
    } else if (v.balance > 0) {
      st.textContent = `▲ ${v.pool.length} letters but only ${v.total} boxes — ${v.balance} spare`;
      st.classList.add('warn');
    } else {
      st.textContent = `▼ ${v.pool.length} letters for ${v.total} boxes — ${-v.balance} short`;
      st.classList.add('warn');
    }

    const lo = $('ana-leftover');
    lo.classList.toggle('hidden', !v.leftover.length);
    lo.innerHTML = v.leftover.length
      ? 'SPARE: ' + v.leftover.map((l) => `<i class="lg">${l}</i>`).join('')
      : '';

    $('btn-shuffle').disabled = new Set(v.order).size < 2;
    $('btn-unlock').disabled = !v.lockedCount;
    $('btn-len-minus').disabled = model.lengths[model.lengths.length - 1] <= 1;
    $('btn-len-plus').disabled = v.total >= MAX_TOTAL;
    save();
  }

  function wire() {
    const lenInput = $('ana-length');
    lenInput.addEventListener('input', () => {
      const lengths = parseLengths(lenInput.value);
      if (lengths.length) setLengths(lengths, { keepInput: true });
    });
    lenInput.addEventListener('blur', () => { lenInput.value = model.lengths.join(','); });
    lenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusCell(0); } });

    // +/- adjust the last word (the only word, for a single-word answer).
    $('btn-len-minus').addEventListener('click', () => {
      const l = model.lengths.slice();
      if (l[l.length - 1] > 1) { l[l.length - 1]--; setLengths(l); }
    });
    $('btn-len-plus').addEventListener('click', () => {
      const l = model.lengths.slice();
      if (total() < MAX_TOTAL) { l[l.length - 1]++; setLengths(l); }
    });

    const pool = $('ana-pool');
    pool.addEventListener('input', () => {
      model.poolText = pool.value;
      // Fresh letters always land shuffled — never in the order they were typed.
      model.order = reshuffle(view(model).order);
      render();
    });
    pool.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); shuffleNow(); } });

    $('btn-shuffle').addEventListener('click', shuffleNow);
    $('btn-unlock').addEventListener('click', () => {
      model.locked = model.locked.map(() => null);
      model.order = reshuffle(view(model).order);
      render();
    });
    $('btn-reset').addEventListener('click', () => {
      model.locked = model.locked.map(() => null);
      model.poolText = '';
      model.order = [];
      pool.value = '';
      render();
      focusCell(0);
    });
  }

  let wired = false;
  function onShow() {
    if (!wired) {
      wired = true;
      load();
      wire();
      $('ana-length').value = model.lengths.join(',');
      $('ana-pool').value = model.poolText;
    }
    render();
  }

  return { onShow };
})();

// ---- Boot -------------------------------------------------------------------

showScreen();
window.LBBoot?.done();
