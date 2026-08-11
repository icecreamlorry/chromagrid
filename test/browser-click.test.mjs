// test/browser-click.test.mjs — Static & Dynamic DOM Binding Auditor for LB Games

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const games = [
  'reversi', 'dominoes', 'chrono', 'chess', 'backgammon', 'weiqi',
  'flagz', 'atlaz', 'atomyx', 'buffz', 'draughts', 'rummikub',
  'scramblr', 'splitz', 'chromagrid', 'lexicorp', 'wurdz', 'framez'
];

// Standard DOM IDs injected dynamically by shared scripts (lobby-ui.js, account-ui.js, quiz-game.js, table-game.css)
const INJECTED_DYNAMIC_IDS = new Set([
  'account-bar', 'landing-name-input', 'account-line', 'btn-login', 'btn-logout',
  'btn-go-lobby', 'btn-lobby-new', 'btn-lobby-join', 'btn-lobby-join-go',
  'btn-lobby-daily', 'btn-lobby-refresh', 'btn-lobby-challenge', 'btn-lobby-history',
  'btn-notify-lobby', 'btn-logout-lobby', 'lobby-name', 'lobby-error', 'lobby-list',
  'lobby-join-box', 'lobby-code-input', 'menu-btn', 'burger-menu', 'modal-confirm',
  'help-modal', 'prestart-overlay', 'countdown-overlay', 'results-overlay', 'panel-confirm',
  'panel-options', 'panel-typing', 'status-line', 'players-strip', 'spectate-hint',
  'prompt-line', 'prompt-sub', 'btn-confirm-order', 'btn-start', 'btn-cfg-back',
  'btn-results-close', 'btn-results-look', 'btn-results-done'
]);

let totalErrors = 0;

console.log('Running DOM ID & Button Click Binding Auditor...\n');

games.forEach((game) => {
  const htmlPath = path.join(rootDir, game, 'index.html');
  const mainJsPath = path.join(rootDir, game, 'js', 'main.js');

  if (!fs.existsSync(htmlPath)) return;

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Extract all static IDs present in the HTML file
  const staticIds = new Set();
  const idRegex = /id=["']([^"']+)["']/g;
  let match;
  while ((match = idRegex.exec(htmlContent)) !== null) {
    staticIds.add(match[1]);
  }

  // Combined set of valid IDs in HTML or injected dynamically
  const validIds = new Set([...staticIds, ...INJECTED_DYNAMIC_IDS]);

  if (fs.existsSync(mainJsPath)) {
    const jsContent = fs.readFileSync(mainJsPath, 'utf8');

    // Find all unsafe property accesses on $(id) without optional chaining or null checks:
    // e.g. $('missing-id').textContent or $('missing-id').classList or $('missing-id').disabled
    const unsafePropRegex = /\$\(['"]([^'"]+)['"]\)\.(textContent|innerText|innerHTML|classList|style|disabled|value|focus|addEventListener)/g;
    let propMatch;

    while ((propMatch = unsafePropRegex.exec(jsContent)) !== null) {
      const targetId = propMatch[1];
      const prop = propMatch[2];
      if (!validIds.has(targetId)) {
        console.error(`❌ [${game}/js/main.js] Unsafe access .${prop} on non-existent DOM ID '#${targetId}'`);
        totalErrors++;
      }
    }
  }
});

if (totalErrors > 0) {
  console.error(`\n❌ DOM Auditor found ${totalErrors} unsafe DOM binding errors!`);
  process.exit(1);
} else {
  console.log('✅ All games pass DOM ID & Button Click Binding Audit cleanly (0 unsafe DOM bindings)!');
}
