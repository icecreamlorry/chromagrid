// shared/quiz-engine.js — pure, deterministic helpers shared by the quiz games
// (Atlaz, Flagz, Atomyx, Buffz). No DOM, no network. Everything here is either
// seeded randomness or comparison/grading logic, so it's fully unit-tested via
// each game's test/engine.test.mjs.
//
// THE DETERMINISM CONTRACT (why these live together): every seat in a room must
// derive identical rounds from the room seed, so any randomness a quiz game uses
// must flow through this seeded RNG — never Date/Math.random. Each game keeps its
// own round BUILDER (the questions differ wildly), but the RNG, ordering-grade,
// answer-matching and ranking primitives are identical and belong here once.

// ---- Seeded RNG --------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates with an already-seeded rand (share one rand across a build so the
// whole round set is one deterministic stream).
export function shuffleWith(rand, array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Convenience for one-shot shuffles straight from a seed (Atlaz's question order).
export function seededShuffle(array, seed) {
  return shuffleWith(mulberry32(seed), array);
}

// ---- Ordering keys + grading (the "sort these" modes) ------------------------
// orderKey: (item) => a sortable value (ascending; equal values are ties). The
// caller binds its own mode → key (name / population / mass / year / rating …).

// The expected arrangement for a round: ids sorted ascending by key.
export function expectedOrder(orderKey, ids, data) {
  return ids.slice().sort((a, b) => {
    const ka = orderKey(data[a]), kb = orderKey(data[b]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// Grade a player's arrangement slot-by-slot. A slot is correct when its key
// equals the key expected at that slot — so equal values (ties) are
// interchangeable rather than punished.
export function gradeOrder(orderKey, placed, data) {
  const expected = expectedOrder(orderKey, placed, data);
  return placed.map((id, i) => orderKey(data[id]) === orderKey(data[expected[i]]));
}

// ---- Answer matching (the "type the name" modes) -----------------------------
// Games differ only in a few normalization toggles, so build a matcher per game:
//   amp     — "&" ↔ " and " (São Tomé & Príncipe == "sao tome and principe")
//   saint   — "st" ↔ "saint" (St Kitts == Saint Kitts)
//   dropThe — a leading "the " is ignored ("The Bahamas" == "Bahamas")
//   packed  — also index a space-stripped key so dotted/abbreviated typing
//             matches ("U.S.A." → "u s a" → "usa")
export function makeAnswerMatcher({ amp = false, saint = false, dropThe = false, packed = false } = {}) {
  function normalizeAnswer(s) {
    let t = String(s ?? '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip diacritics
      .replace(/['’]/g, '');                        // d'Ivoire → divoire
    if (amp) t = t.replace(/&/g, ' and ');
    t = t.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
    if (saint) t = t.replace(/^st /, 'saint ').replace(/ st /g, ' saint ');
    if (dropThe) t = t.replace(/^the /, '');
    return t;
  }

  // entries: [{ id, name, alt }] → normalized key -> id (first wins).
  function buildAnswerIndex(entries) {
    const idx = new Map();
    const packedMap = packed ? new Map() : null;
    for (const it of entries) {
      for (const cand of [it.name, ...(it.alt || [])]) {
        const key = normalizeAnswer(cand);
        if (!key) continue;
        if (!idx.has(key)) idx.set(key, it.id);
        if (packedMap) { const p = key.replace(/ /g, ''); if (!packedMap.has(p)) packedMap.set(p, it.id); }
      }
    }
    if (packedMap) idx.packed = packedMap;
    return idx;
  }

  function matchAnswer(index, input) {
    const key = normalizeAnswer(input);
    if (index.get(key) != null) return index.get(key);
    if (packed) return index.packed?.get(key.replace(/ /g, '')) ?? null;
    return null;
  }

  return { normalizeAnswer, buildAnswerIndex, matchAnswer };
}

// ---- Results / ranking -------------------------------------------------------
// result: { outcomes, score, total, ms }. Score desc, then time asc, all modes.
// (Atlaz keeps its own sweep-aware ranking; the other three share this verbatim.)

export function scoreOf(result) { return result ? (Number(result.score) || 0) : 0; }

export function compareResults(a, b) {
  const missing = (x) => (x ? 0 : 1);
  if (missing(a) || missing(b)) return missing(a) - missing(b);
  return (scoreOf(b) - scoreOf(a)) || (a.ms - b.ms);
}

// results: sparse seat -> result. Returns seats best-first.
export function rankSeats(results, seats) {
  const list = [];
  for (let s = 0; s < seats; s++) list.push(s);
  return list.sort((a, b) => compareResults(results[a], results[b]) || a - b);
}

// Winner seat for finishRoom: top of the ranking, 'tie' when the runner-up has
// an equal SCORE (time only orders the list, it never decides a draw) or nobody
// submitted anything.
export function winnerSeat(results, seats) {
  if (seats <= 1) return 0;
  const ranked = rankSeats(results, seats);
  const top = ranked[0];
  if (!results[top]) return 'tie';
  const next = ranked[1];
  if (next != null && results[next] && scoreOf(results[top]) === scoreOf(results[next])) return 'tie';
  return top;
}
