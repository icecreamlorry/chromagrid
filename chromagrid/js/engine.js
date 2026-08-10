// chromagrid/js/engine.js — pure, deterministic primitives for Chromagrid

export const COLORS = [
  { name: 'PLASMA',  hex: '#DD6600', shape: 6 },  // burnt orange  — lightning bolt
  { name: 'HOLO',    hex: '#00AACC', shape: 1 },  // teal-cyan     — diamond
  { name: 'SYNTH',   hex: '#CC0066', shape: 10 }, // raspberry     — pennant
  { name: 'MATRIX',  hex: '#22CC55', shape: 12 }, // lime green    — gem
  { name: 'VOID',    hex: '#662299', shape: 11 }, // dark purple   — chevron
];

export const SHAPES = [
  'polygon(29% 0%, 71% 0%, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0% 71%, 0% 29%)',
  'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  'polygon(33% 0%, 67% 0%, 67% 33%, 100% 33%, 100% 67%, 67% 67%, 67% 100%, 33% 100%, 33% 67%, 0% 67%, 0% 33%, 33% 33%)',
  'polygon(0% 0%, 68% 0%, 100% 50%, 68% 100%, 0% 100%, 32% 50%)',
  'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  'polygon(50% 0%, 100% 22%, 82% 100%, 18% 100%, 0% 22%)',
  'polygon(38% 0%, 100% 0%, 72% 36%, 100% 36%, 30% 100%, 48% 52%, 0% 52%)',
  'polygon(0% 0%, 62% 0%, 62% 19%, 100% 19%, 100% 100%, 38% 100%, 38% 81%, 0% 81%)',
  'polygon(18% 0%, 100% 0%, 82% 100%, 0% 100%)',
  'polygon(50% 0%, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0% 50%, 37% 37%)',
  'polygon(12% 0%, 88% 0%, 100% 12%, 100% 65%, 50% 100%, 0% 65%, 0% 12%)',
  'polygon(0% 0%, 56% 0%, 100% 50%, 56% 100%, 0% 100%, 44% 50%)',
  'polygon(50% 0%, 85% 20%, 100% 58%, 70% 100%, 30% 100%, 0% 58%, 15% 20%)',
];

export const SHAPE_PTS = SHAPES.map(str =>
  str.match(/[\d.]+%\s+[\d.]+%/g).map(pair => {
    const [x, y] = pair.match(/[\d.]+/g).map(Number);
    return [x / 100, y / 100];
  })
);

export const colorShapeMap = new Map(COLORS.map(c => [c.hex, c.shape]));

export const BOMB_ICON_SHAPE_PTS = {
  6: [[0.38,0],[1,0],[0.72,0.36],[1,0.36],[0.40,1],[0.22,1],[0.48,0.52],[0,0.52]],
};
export const BOMB_ICON_X_SHIFTS = { 11: 0.12 };

export const BOMB_SPAWN_THRESHOLD = 6;
export const BOMB_TYPES = ['bomb', 'bombCross', 'bombX', 'bombH', 'bombV'];

export function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function idx(r, c, cols = 8) { return r * cols + c; }
export function rowOf(i, cols = 8) { return Math.floor(i / cols); }
export function colOf(i, cols = 8) { return i % cols; }
export function visColor(s) { return s.flipped ? s.backColor : s.frontColor; }
export function calcScore(n) { return Math.round(n * n * 6.25); }

export function pick(arr, exclude, rng = Math.random) {
  let v;
  do { v = arr[Math.floor(rng() * arr.length)]; }
  while (v === exclude);
  return v;
}

export function newCell(rng = Math.random) {
  const frontColor = pick(COLORS, null, rng);
  const backColor  = pick(COLORS, frontColor, rng);
  const shape = Math.floor(rng() * SHAPES.length);
  return { frontColor, backColor, shape, flipped: false, special: null };
}

export function newBombCell(color, type = 'bomb') {
  return { frontColor: color, backColor: color, shape: 0, flipped: false, special: { type } };
}

export const SPECIALS = {
  bomb: {
    expandPop(bombIdx, poppedSet, rows = 12, cols = 8) {
      const added = [];
      const r = rowOf(bombIdx, cols), c = colOf(bombIdx, cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const ni = idx(nr, nc, cols);
            if (!poppedSet.has(ni)) { poppedSet.add(ni); added.push(ni); }
          }
        }
      }
      return added;
    },
  },
  bombCross: {
    expandPop(bombIdx, poppedSet, rows = 12, cols = 8) {
      const added = [], r = rowOf(bombIdx, cols), c = colOf(bombIdx, cols);
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        for (let d = 1; d <= 2; d++) {
          const nr = r + dr*d, nc = c + dc*d;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const ni = idx(nr, nc, cols);
            if (!poppedSet.has(ni)) { poppedSet.add(ni); added.push(ni); }
          }
        }
      }
      return added;
    },
  },
  bombX: {
    expandPop(bombIdx, poppedSet, rows = 12, cols = 8) {
      const added = [], r = rowOf(bombIdx, cols), c = colOf(bombIdx, cols);
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        for (let d = 1; d <= 2; d++) {
          const nr = r + dr*d, nc = c + dc*d;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const ni = idx(nr, nc, cols);
            if (!poppedSet.has(ni)) { poppedSet.add(ni); added.push(ni); }
          }
        }
      }
      return added;
    },
  },
  bombH: {
    expandPop(bombIdx, poppedSet, rows = 12, cols = 8) {
      const added = [], r = rowOf(bombIdx, cols), c = colOf(bombIdx, cols);
      for (let dc = -4; dc <= 4; dc++) {
        if (dc === 0) continue;
        const nc = c + dc;
        if (nc >= 0 && nc < cols) {
          const ni = idx(r, nc, cols);
          if (!poppedSet.has(ni)) { poppedSet.add(ni); added.push(ni); }
        }
      }
      return added;
    },
  },
  bombV: {
    expandPop(bombIdx, poppedSet, rows = 12, cols = 8) {
      const added = [], r = rowOf(bombIdx, cols), c = colOf(bombIdx, cols);
      for (let dr = -4; dr <= 4; dr++) {
        if (dr === 0) continue;
        const nr = r + dr;
        if (nr >= 0 && nr < rows) {
          const ni = idx(nr, c, cols);
          if (!poppedSet.has(ni)) { poppedSet.add(ni); added.push(ni); }
        }
      }
      return added;
    },
  },
};

export function floodFill(state, startIdx, rows = 12, cols = 8) {
  const target  = visColor(state[startIdx]);
  const visited = new Set([startIdx]);
  const queue   = [startIdx];
  while (queue.length) {
    const cur = queue.shift();
    const r = rowOf(cur, cols), c = colOf(cur, cols);
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const ni = idx(nr, nc, cols);
      if (!visited.has(ni) && visColor(state[ni]) === target) {
        visited.add(ni);
        queue.push(ni);
      }
    }
  }
  return [...visited];
}

export function buildBoardForSeed(seed, rows = 12, cols = 8) {
  const rng = mulberry32(seed);
  return Array.from({ length: rows * cols }, () => {
    const c = newCell(rng);
    return { f: c.frontColor.hex, b: c.backColor.hex, s: c.shape };
  });
}

export function dailySeed() {
  const d = new Date();
  return ((d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()) >>> 0);
}

export function dailySlug() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `chromagrid-daily-${y}${m}${day}`;
}

export function dailyDateLabel() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
