// chrono/js/modes.js — Chrono rendering modes and review UI

export function hidePanels($) {
  $('panel-confirm')?.classList.add('hidden');
  $('panel-options')?.classList.add('hidden');
  $('panel-typing')?.classList.add('hidden');
}

export function createMode(helpers) {
  const { $, stage, currentRound } = helpers;

  return {
    renderQuestion(round, onAction) {
      hidePanels($);
      stage.innerHTML = '';

      const container = document.createElement('div');
      container.className = 'chrono-stage';

      const prompt = document.createElement('p');
      prompt.className = 'tagline';
      prompt.textContent = 'Drag or tap cards to arrange in chronological order (earliest to latest):';
      container.appendChild(prompt);

      let currentItems = round.items.slice();

      function renderCards() {
        const existing = container.querySelector('.chrono-cards');
        if (existing) existing.remove();

        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'chrono-cards';
        cardsWrap.style.cssText = 'display:flex; flex-direction:column; gap:12px; width:100%;';

        currentItems.forEach((item, idx) => {
          const card = document.createElement('div');
          card.className = 'event-card';
          card.innerHTML = `
            <div class="event-info">
              <div class="event-title">${item.title}</div>
              <div class="event-cat">${item.category}</div>
            </div>
          `;

          card.addEventListener('click', () => {
            // Tap to move down / cycle position
            if (idx < currentItems.length - 1) {
              const tmp = currentItems[idx];
              currentItems[idx] = currentItems[idx + 1];
              currentItems[idx + 1] = tmp;
              renderCards();
            }
          });

          cardsWrap.appendChild(card);
        });

        container.appendChild(cardsWrap);
      }

      renderCards();

      stage.appendChild(container);
      $('panel-confirm')?.classList.remove('hidden');

      const btnConfirm = $('btn-confirm-order');
      if (btnConfirm) {
        btnConfirm.onclick = () => {
          const placedIds = currentItems.map((it) => it.id);
          onAction({ order: placedIds });
        };
      }
    }
  };
}

export function renderReview(round, result, helpers) {
  const { stage } = helpers;
  stage.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'chrono-stage';

  const title = document.createElement('h3');
  title.textContent = 'Correct Chronological Order:';
  wrap.appendChild(title);

  round.expected.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.innerHTML = `
      <div class="event-info">
        <div class="event-title">${item.title}</div>
        <div class="event-cat">${item.category}</div>
      </div>
      <div class="event-year">${item.year}</div>
    `;
    wrap.appendChild(card);
  });

  stage.appendChild(wrap);
}
