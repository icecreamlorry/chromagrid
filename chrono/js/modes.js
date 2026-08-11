// chrono/js/modes.js — Chrono rendering modes and review UI

import { gradeOrder } from './engine.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function hidePanels() {
  $('panel-confirm')?.classList.add('hidden');
}

function setPrompt(main, sub = '') {
  const line = $('prompt-line');
  const subEl = $('prompt-sub');
  if (line) line.textContent = main || '';
  if (subEl) subEl.textContent = sub || '';
}

function stage() {
  return $('chrono-stage');
}

export function createMode(modeId, ctx) {
  const ac = new AbortController();
  const ctl = orderMode(ctx, ac.signal);
  return {
    start: ctl.start,
    destroy() {
      ac.abort();
      ctl.destroy?.();
      hidePanels();
      setPrompt('');
      const st = stage();
      if (st) st.innerHTML = '';
    },
  };
}

function orderMode(ctx, signal) {
  const { data, rounds } = ctx;
  const dataMap = {};
  if (Array.isArray(data)) {
    data.forEach((item) => { dataMap[item.id] = item; });
  } else if (data && typeof data === 'object') {
    Object.assign(dataMap, data);
  }

  const st = { idx: 0, outcomes: [], revealed: false, done: false };
  if (Array.isArray(ctx.restore?.outcomes)) {
    st.outcomes = ctx.restore.outcomes;
    st.idx = st.outcomes.length;
  }

  const btn = $('btn-confirm-order');
  let drag = null;

  function currentIds() {
    const stEl = stage();
    if (!stEl) return [];
    return [...stEl.querySelectorAll('.order-row')].map((r) => r.dataset.id);
  }

  function ask() {
    st.revealed = false;
    const round = rounds[st.idx];
    if (!round) return;

    setPrompt('Sort events chronologically (earliest to latest):', `Round ${st.idx + 1} / ${rounds.length}`);
    hidePanels();
    $('panel-confirm')?.classList.remove('hidden');
    if (btn) {
      btn.textContent = 'CONFIRM ORDER';
      btn.disabled = false;
    }

    const items = round.items || round.ids?.map((id) => dataMap[id]) || [];

    const stEl = stage();
    if (!stEl) return;

    stEl.innerHTML = '<div class="order-list">'
      + items.map((item) => `<div class="order-row event-card" data-id="${item.id}">`
        + `<span class="order-grip">⠿</span>`
        + `<span class="order-text"><span class="order-name event-title">${esc(item.title)}</span><span class="order-val event-cat">${esc(item.category || '')}</span></span>`
        + `<span class="order-year-slot"></span>`
        + `</div>`).join('')
      + '</div>';

    for (const row of stEl.querySelectorAll('.order-row')) {
      row.addEventListener('pointerdown', (e) => beginDrag(e, row), { signal });
    }
  }

  function beginDrag(e, row) {
    if (st.revealed || st.done || drag) return;
    if (e.button !== undefined && e.button !== 0) return;
    const startY = e.clientY;
    e.preventDefault();
    row.setPointerCapture?.(e.pointerId);
    const rect0 = row.getBoundingClientRect();
    drag = { row, grabOffset: e.clientY - rect0.top, lastY: e.clientY, startY, raf: 0 };
    row.classList.add('dragging');
    const stEl = stage();
    const list = stEl?.querySelector('.order-list');
    if (!list || !stEl) return;

    const place = (y) => {
      if (!drag || !list) return;
      const others = [...list.querySelectorAll('.order-row')].filter((r) => r !== row);
      let before = null;
      for (const other of others) {
        const r = other.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = other; break; }
      }
      if (before) {
        if (row.nextElementSibling !== before) list.insertBefore(row, before);
      } else if (list.lastElementChild !== row) {
        list.appendChild(row);
      }
      row.style.transform = 'none';
      const slotTop = row.getBoundingClientRect().top;
      row.style.transform = `translateY(${y - drag.grabOffset - slotTop}px)`;
    };

    const EDGE = 56, SPEED = 12;
    const tick = () => {
      if (!drag) return;
      const rect = stEl.getBoundingClientRect();
      let dv = 0;
      if (drag.lastY < rect.top + EDGE) dv = -SPEED;
      else if (drag.lastY > rect.bottom - EDGE) dv = SPEED;
      if (dv) {
        const before = stEl.scrollTop;
        stEl.scrollTop += dv;
        if (stEl.scrollTop !== before) place(drag.lastY);
      }
      drag.raf = requestAnimationFrame(tick);
    };

    const move = (ev) => { if (drag) { drag.lastY = ev.clientY; place(ev.clientY); } };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (drag) {
        cancelAnimationFrame(drag.raf);
        drag.row.style.transform = '';
        drag.row.classList.remove('dragging');
        const dist = Math.abs((ev.clientY || drag.lastY) - drag.startY);
        if (dist < 6 && list) {
          const next = drag.row.nextElementSibling;
          if (next) list.insertBefore(next, drag.row);
          else if (list.firstElementChild && list.firstElementChild !== drag.row) list.insertBefore(drag.row, list.firstElementChild);
        }
        drag = null;
      }
    };
    drag.raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', move, { signal });
    window.addEventListener('pointerup', up, { signal });
    window.addEventListener('pointercancel', up, { signal });
  }

  function reveal() {
    const placed = currentIds();
    const round = rounds[st.idx];
    const ok = gradeOrder(placed, dataMap);
    st.outcomes.push({ ids: placed, ok });
    ctx.onProgress({ outcomes: st.outcomes });
    st.revealed = true;

    const stEl = stage();
    const rows = stEl ? stEl.querySelectorAll('.order-row') : [];
    placed.forEach((id, i) => {
      const row = rows[i];
      if (!row) return;
      const isOk = ok[i];
      row.classList.add(isOk ? 'good' : 'wrong');
      const grip = row.querySelector('.order-grip');
      if (grip) grip.textContent = isOk ? '✓' : '✗';

      const yearSlot = row.querySelector('.order-year-slot');
      if (yearSlot && dataMap[id]) {
        yearSlot.innerHTML = `<span class="event-year">${dataMap[id].year}</span>`;
      }
    });

    const expectedOrder = round.expected || round.items.slice().sort((a, b) => a.year - b.year);
    const expectedIds = expectedOrder.map((it) => it.id);

    const got = ok.filter(Boolean).length;
    ctx.onStatus(got === ok.length ? `Perfect round! ${got}/${ok.length}` : `${got}/${ok.length} in correct position`);

    if (got !== ok.length) {
      placed.forEach((id, i) => {
        const want = expectedIds.indexOf(id);
        const tag = document.createElement('span');
        tag.className = 'order-want';
        tag.textContent = `#${want + 1}`;
        if (rows[i]) rows[i].appendChild(tag);
      });
    }

    if (btn) {
      btn.textContent = st.idx + 1 >= rounds.length ? 'FINISH' : 'NEXT';
    }
  }

  function advance() {
    if (st.done) return;
    if (!st.revealed) { reveal(); return; }
    st.idx++;
    ctx.onStatus('');
    if (st.idx >= rounds.length) {
      st.done = true;
      const score = st.outcomes.reduce((s, o) => s + o.ok.filter(Boolean).length, 0);
      const total = st.outcomes.reduce((s, o) => s + o.ok.length, 0);
      ctx.onFinish({ outcomes: st.outcomes, score, total, ms: Date.now() - ctx.startedAt });
      return;
    }
    ask();
  }

  if (btn) {
    btn.onclick = advance;
  }

  return {
    start() {
      if (st.idx >= rounds.length) { st.idx = rounds.length; advance(); return; }
      ask();
    },
    destroy() {
      if (drag) cancelAnimationFrame(drag.raf);
      drag = null;
      if (btn) btn.onclick = null;
    },
  };
}

export function renderReview(data, mode, result) {
  hidePanels();
  setPrompt('');
  const dataMap = {};
  if (Array.isArray(data)) {
    data.forEach((item) => { dataMap[item.id] = item; });
  } else if (data && typeof data === 'object') {
    Object.assign(dataMap, data);
  }

  const el = stage();
  if (!el || !result || !result.outcomes) {
    if (el) el.innerHTML = '';
    return;
  }

  el.innerHTML = '<div class="review-list">' + result.outcomes.map((o, r) => {
    const rows = (o.ids || []).map((id, i) => {
      const item = dataMap[id];
      const isOk = o.ok?.[i];
      return `<div class="review-row ${isOk ? 'good' : 'wrong'}">`
        + `<span class="review-name">${esc(item?.title || id)} (${item?.year ?? '?'})</span>`
        + `<span class="review-mark">${isOk ? '✓' : '✗'}</span>`
        + `</div>`;
    }).join('');
    return `<div class="review-round"><div class="review-round-label">Round ${r + 1}</div>${rows}</div>`;
  }).join('') + '</div>';
}

