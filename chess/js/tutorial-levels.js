// Chess tutorial curriculum — 15 lessons, from how each piece moves to
// checkmate, castling, en passant, promotion and a couple of basic tactics. The
// runner (tutorial.js) walks these steps, rebuilding each step's position from
// its FEN so the ← / → arrows can move freely and re-read.
//
// Step shape (all fields optional unless noted):
//   text                 HTML instruction shown in the panel.
//   fen                  Position when entering the step (also the reconstruction
//                        anchor). A step with no fen continues from the previous
//                        step's result.
//   marks/arrows/regions/labels/ghosts   Annotations for the board renderer.
//   task { ... }         Present ⇒ a task the player must complete before → unlocks:
//     allowFrom [[r,c]…]     Restrict which pieces may be moved (optional lock).
//     moves [{from,to}…]     Accepted solution move(s); the first is canonical.
//     replies [{from,to}…]   Opponent's scripted answer, played after a success.
//     check(pos,{from,to})   Extra success predicate on the resulting position.
//     hint / success / onWrong   Feedback lines.

import { parseFEN, genLegal, inCheck } from './engine.js';

const GOLD = '#f2c14e';
const RED = '#e8604c';
const BLUE = '#6fb1e0';
const GREEN = '#5bbf8a';

// Algebraic square → [row,col].
const S = (a) => [8 - +a[1], 'abcdefgh'.indexOf(a[0])];
const mv = (a, b) => ({ from: S(a), to: S(b) });
const ring = (a, color = GOLD) => { const [r, c] = S(a); return { r, c, shape: 'ring', color }; };
const dot = (a, color = GOLD) => { const [r, c] = S(a); return { r, c, shape: 'dot', color }; };
const arrow = (a, b, color = RED) => ({ from: S(a), to: S(b), color });

// Movement dots for the piece on `alg` in a position — computed from the engine
// so an illustration can never disagree with the rules.
const dots = (fen, alg, color = BLUE) => {
  const pos = parseFEN(fen);
  const [r, c] = S(alg);
  return genLegal(pos).filter((m) => m.from[0] === r && m.from[1] === c)
    .map((m) => ({ r: m.to[0], c: m.to[1], shape: 'dot', color }));
};

// Success predicates on the position AFTER the player's move (opponent to move).
const givesCheck = (pos) => inCheck(pos.board, pos.toMove);
const givesMate = (pos) => inCheck(pos.board, pos.toMove) && genLegal(pos).length === 0;

export const LEVELS = [
  // 1 ─ Pawns ────────────────────────────────────────────────────────────────
  {
    id: 'pawn', title: 'Pawns',
    steps: [
      {
        text: 'Welcome to <b>chess</b>. Two armies face off; <b>White</b> always moves first, then players alternate. Your goal is to <b>checkmate</b> the enemy king. First, the pieces — starting with the <b>pawn</b>.',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      },
      {
        text: 'Pawns move <b>straight forward</b> one square — or <b>two</b> on their very first move — but never backward. Push the highlighted <b>e-pawn</b> forward (one or two squares).',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        marks: [ring('e4'), ring('e3')],
        task: {
          allowFrom: [S('e2')], moves: [mv('e2', 'e4'), mv('e2', 'e3')],
          hint: 'Tap the e-pawn, then one of the highlighted squares ahead of it.',
          success: 'That\'s a pawn move. Pawns are slow but they\'re the soul of the game.',
        },
      },
      {
        text: 'Pawns are the one piece that <b>captures differently</b> from how it moves: <b>diagonally forward</b>, one square. Use your pawn to capture the black pawn.',
        fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',
        marks: [ring('d5')],
        task: {
          moves: [mv('e4', 'd5')],
          hint: 'Capture diagonally forward-left onto the black pawn.',
          success: 'Captured — the pawn moves onto the square it takes.',
        },
      },
    ],
  },

  // 2 ─ Rook ──────────────────────────────────────────────────────────────────
  {
    id: 'rook', title: 'The rook',
    steps: [
      {
        text: 'The <b>rook</b> moves in <b>straight lines</b> — any number of empty squares along a rank or file. The blue dots show everywhere this rook can go.',
        fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
        marks: dots('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1'),
      },
      {
        text: 'Rooks are worth <b>5 points</b> — powerful on open lines. Slide your rook up the a-file to <b>capture the bishop</b>.',
        fen: '4k3/8/8/b7/8/8/8/R3K3 w - - 0 1',
        marks: [ring('a5')],
        task: {
          moves: [mv('a1', 'a5')],
          hint: 'Move the rook straight up its own file onto the bishop.',
          success: 'The rook sweeps the whole file — keep them on open lines.',
        },
      },
    ],
  },

  // 3 ─ Bishop ─────────────────────────────────────────────────────────────────
  {
    id: 'bishop', title: 'The bishop',
    steps: [
      {
        text: 'The <b>bishop</b> moves <b>diagonally</b>, any distance. Each bishop stays on <b>one colour</b> of square forever — this one lives on the light squares.',
        fen: '4k3/8/8/8/8/8/8/2B1K3 w - - 0 1',
        marks: dots('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', 'c1'),
      },
      {
        text: 'A bishop is worth about <b>3 points</b>. Take the black knight along the diagonal.',
        fen: '4k3/8/7n/8/8/8/8/2B1K3 w - - 0 1',
        marks: [ring('h6')],
        task: {
          moves: [mv('c1', 'h6')],
          hint: 'Slide the bishop up its long diagonal onto the knight.',
          success: 'Bishops love long, open diagonals like that one.',
        },
      },
    ],
  },

  // 4 ─ Queen ──────────────────────────────────────────────────────────────────
  {
    id: 'queen', title: 'The queen',
    steps: [
      {
        text: 'The <b>queen</b> combines rook and bishop: she moves any distance in a <b>straight line or a diagonal</b>. She\'s the strongest piece — about <b>9 points</b>.',
        fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1',
        marks: dots('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'd1'),
      },
      {
        text: 'Use the queen\'s reach to capture the black rook.',
        fen: '4k3/3r4/8/8/8/8/8/3QK3 w - - 0 1',
        marks: [ring('d7')],
        task: {
          moves: [mv('d1', 'd7')],
          hint: 'Send the queen straight up the file onto the rook.',
          success: 'Because she\'s so valuable, keep her safe from smaller attackers.',
        },
      },
    ],
  },

  // 5 ─ Knight ─────────────────────────────────────────────────────────────────
  {
    id: 'knight', title: 'The knight',
    steps: [
      {
        text: 'The <b>knight</b> moves in an <b>L-shape</b>: two squares one way, then one square across. It\'s the only piece that <b>jumps over</b> others — nothing blocks it.',
        fen: '4k3/8/8/4N3/8/8/8/4K3 w - - 0 1',
        marks: dots('4k3/8/8/4N3/8/8/8/4K3 w - - 0 1', 'e5'),
      },
      {
        text: 'Knights are worth about <b>3 points</b> and are deadly in tight spots. Hop the knight onto the black pawn.',
        fen: '4k3/8/2p5/4N3/8/8/8/4K3 w - - 0 1',
        marks: [ring('c6')],
        task: {
          moves: [mv('e5', 'c6')],
          hint: 'Make an L-shaped jump to the pawn on c6.',
          success: 'Knights are tricky — their attacks are easy to overlook.',
        },
      },
    ],
  },

  // 6 ─ King ───────────────────────────────────────────────────────────────────
  {
    id: 'king', title: 'The king',
    steps: [
      {
        text: 'The <b>king</b> moves <b>one square</b> in any direction. He\'s the piece you must protect — if he can\'t escape capture, you lose. He can also capture, but may never move into danger.',
        fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
        marks: dots('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1'),
      },
      {
        text: 'Capture the loose black pawn sitting next to your king.',
        fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
        marks: [ring('e2')],
        task: {
          moves: [mv('e1', 'e2')],
          hint: 'Step the king one square onto the pawn.',
          success: 'The king is a useful attacker in the endgame — just keep him safe early on.',
        },
      },
    ],
  },

  // 7 ─ Capturing ──────────────────────────────────────────────────────────────
  {
    id: 'capture', title: 'Winning material',
    steps: [
      {
        text: 'A <b>capture</b> replaces an enemy piece with yours on its square. You can never land on your <b>own</b> pieces, and grabbing an <b>undefended</b> enemy piece for free is one of the simplest ways to win.',
        fen: '4k3/8/8/4q3/8/5N2/8/4K3 w - - 0 1',
        marks: [ring('e5')],
      },
      {
        text: 'That black queen is undefended and your knight attacks it. <b>Take it</b> — winning a queen for a knight is a huge gain.',
        fen: '4k3/8/8/4q3/8/5N2/8/4K3 w - - 0 1',
        marks: [ring('e5')],
        task: {
          moves: [mv('f3', 'e5')],
          hint: 'Jump the knight onto the queen.',
          success: 'Always scan for free captures like that before every move.',
        },
      },
    ],
  },

  // 8 ─ Check ──────────────────────────────────────────────────────────────────
  {
    id: 'check', title: 'Check',
    steps: [
      {
        text: 'When a piece attacks the enemy <b>king</b>, that\'s <b>check</b>. The opponent <b>must</b> get out of it immediately — they can\'t ignore it or do anything else.',
        fen: '4k3/8/8/8/8/8/8/R4K2 w - - 0 1',
      },
      {
        text: 'Swing your rook onto the <b>e-file</b> to put the black king in check.',
        fen: '4k3/8/8/8/8/8/8/R4K2 w - - 0 1',
        marks: [ring('e1')], arrows: [arrow('e1', 'e8')],
        task: {
          moves: [mv('a1', 'e1')], check: givesCheck,
          hint: 'Line the rook up on the same file as the enemy king.',
          success: 'Check! The rook attacks straight down the open e-file.',
        },
      },
    ],
  },

  // 9 ─ Escaping check ─────────────────────────────────────────────────────────
  {
    id: 'escape', title: 'Getting out of check',
    steps: [
      {
        text: 'There are <b>three</b> ways out of check: <b>move</b> the king to safety, <b>block</b> the attack with another piece, or <b>capture</b> the checking piece. Here the rook checks your king down the e-file.',
        fen: '4r3/8/8/8/8/8/k7/4K3 w - - 0 1',
        marks: [ring('e1', RED)], arrows: [arrow('e8', 'e1')],
      },
      {
        text: 'Nothing can block or capture that rook, so <b>move your king</b> off the e-file to a safe square.',
        fen: '4r3/8/8/8/8/8/k7/4K3 w - - 0 1',
        marks: [ring('d1', GREEN), ring('d2', GREEN), ring('f1', GREEN), ring('f2', GREEN)],
        task: {
          allowFrom: [S('e1')],
          moves: [mv('e1', 'f1'), mv('e1', 'd1'), mv('e1', 'f2'), mv('e1', 'd2')],
          hint: 'Step the king sideways off the e-file — it can\'t stay in check.',
          success: 'Safe. Notice the king can never step onto a square that\'s still attacked.',
        },
      },
    ],
  },

  // 10 ─ Checkmate ─────────────────────────────────────────────────────────────
  {
    id: 'mate', title: 'Checkmate',
    steps: [
      {
        text: 'If a king is in check and has <b>no legal way out</b>, it\'s <b>checkmate</b> — the game is over and you\'ve won. Your king (g6) already traps the black king\'s escape squares.',
        fen: '6k1/8/6K1/8/8/8/8/1Q6 w - - 0 1',
      },
      {
        text: 'Deliver checkmate in one move: bring the queen to the <b>back rank</b> where your king covers every escape.',
        fen: '6k1/8/6K1/8/8/8/8/1Q6 w - - 0 1',
        marks: [ring('b8')],
        task: {
          moves: [mv('b1', 'b8')], check: givesMate,
          hint: 'Queen to the 8th rank — the king has nowhere to run.',
          success: 'Checkmate! The king is attacked and every square is covered.',
        },
      },
    ],
  },

  // 11 ─ Castling ──────────────────────────────────────────────────────────────
  {
    id: 'castle', title: 'Castling',
    steps: [
      {
        text: '<b>Castling</b> is a special move that tucks your king to safety and brings a rook into play — the king steps <b>two squares</b> toward a rook and the rook hops to its other side. You may castle only if neither piece has moved, the squares between are empty, and the king isn\'t moving through check.',
        fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
      },
      {
        text: 'Castle <b>kingside</b>: tap your king and move it two squares toward the rook on h1.',
        fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
        marks: [ring('g1')],
        task: {
          allowFrom: [S('e1')], moves: [mv('e1', 'g1')],
          hint: 'Move the king from e1 to g1 — the rook jumps over automatically.',
          success: 'Castled! The king is safe and the rook springs to f1. Do this early in most games.',
        },
      },
    ],
  },

  // 12 ─ En passant ────────────────────────────────────────────────────────────
  {
    id: 'enpassant', title: 'En passant',
    steps: [
      {
        text: 'One more special rule: <b>en passant</b> ("in passing"). If an enemy pawn uses its two-square jump to skip <b>past</b> your pawn\'s capture, you may capture it <b>as if it had moved only one square</b> — but only on the very next move.',
        fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
        marks: [ring('d6')],
      },
      {
        text: 'Black\'s pawn just rushed to d5, right beside your e5-pawn. Capture it <b>en passant</b> by moving onto d6.',
        fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
        marks: [ring('d6')],
        task: {
          moves: [mv('e5', 'd6')],
          hint: 'Move your e5-pawn diagonally to the empty d6 square.',
          success: 'The passing pawn is captured — the only capture that lands on an empty square.',
        },
      },
    ],
  },

  // 13 ─ Promotion ─────────────────────────────────────────────────────────────
  {
    id: 'promote', title: 'Promotion',
    steps: [
      {
        text: 'When a pawn reaches the <b>far side</b> of the board, it <b>promotes</b> — you swap it for any piece you like (almost always a <b>queen</b>). This is why a single passed pawn can decide a game.',
        fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
        marks: [ring('a8')],
      },
      {
        text: 'March the pawn home: push it to the 8th rank to make a new queen.',
        fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
        marks: [ring('a8')],
        task: {
          moves: [mv('a7', 'a8')],
          hint: 'Advance the a-pawn one square to the end of the board.',
          success: 'A brand-new queen! Suddenly you\'re winning by a mile.',
        },
      },
    ],
  },

  // 14 ─ The fork ──────────────────────────────────────────────────────────────
  {
    id: 'fork', title: 'The fork',
    steps: [
      {
        text: 'A <b>fork</b> attacks two pieces at once so your opponent can only save one. The <b>knight</b> is the great forker because nothing it hits can attack it back the same way.',
        fen: '2q1k3/8/8/8/4N3/8/8/6K1 w - - 0 1',
        marks: [ring('d6')],
      },
      {
        text: 'Jump the knight to <b>d6</b>: it gives <b>check</b> to the king and attacks the queen at the same time.',
        fen: '2q1k3/8/8/8/4N3/8/8/6K1 w - - 0 1',
        marks: [ring('d6')],
        task: {
          moves: [mv('e4', 'd6')], replies: [mv('e8', 'f8')], check: givesCheck,
          hint: 'Knight to d6 — a check the king must answer.',
          success: 'Check! The king must move, leaving the queen hanging.',
        },
      },
      {
        text: 'The king stepped aside. Now collect your prize — <b>take the queen</b>.',
        marks: [ring('c8')],
        task: {
          moves: [mv('d6', 'c8')],
          hint: 'Capture the queen on c8 with your knight.',
          success: 'Won a queen for nothing — that\'s the power of a fork.',
        },
      },
    ],
  },

  // 15 ─ Back-rank mate ────────────────────────────────────────────────────────
  {
    id: 'backrank', title: 'Back-rank mate',
    steps: [
      {
        text: 'A king castled behind its own pawns can be <b>trapped on the back rank</b>: the pawns that shelter it also block its escape. A rook or queen arriving on that rank can be <b>checkmate</b>.',
        fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',
        marks: [ring('e8')], arrows: [arrow('e1', 'e8')],
      },
      {
        text: 'The black king is boxed in by its own f7, g7 and h7 pawns. Slam your rook onto the back rank for mate.',
        fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',
        marks: [ring('e8')],
        task: {
          moves: [mv('e1', 'e8')], check: givesMate,
          hint: 'Rook to the 8th rank — the pawns leave the king no escape.',
          success: 'Back-rank mate! Give your own king a "luft" escape square to avoid suffering this yourself.',
        },
      },
    ],
  },
];
