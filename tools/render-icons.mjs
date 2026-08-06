// Render every game's PWA icons from its source SVG.
//
// The source of truth for each game icon is `<game>/icons/icon.svg`; the PNGs
// (apple-touch-icon 180, icon-192, icon-512) are generated from it so they never
// drift. Re-run this whenever you tweak an icon.svg:
//
//   npm i -D playwright   # once (any headless-Chromium SVG rasteriser works)
//   node tools/render-icons.mjs
//
// Rendering goes through headless Chromium so gradients, clip-paths and rounded
// corners come out exactly as the browser shows them; omitBackground keeps the
// corners outside the rounded rect transparent.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = [
  'chromagrid', 'wurdz', 'scramblr', 'splitz', 'lexicorp', 'atlaz', 'flagz',
  'atomyx', 'buffz', 'chess', 'weiqi', 'draughts', 'backgammon', 'rummikub',
];
const SIZES = [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]];

const browser = await chromium.launch();
try {
  for (const game of GAMES) {
    const svgPath = join(ROOT, game, 'icons', 'icon.svg');
    if (!existsSync(svgPath)) { console.log('skip (no icon.svg):', game); continue; }
    const svg = readFileSync(svgPath, 'utf8');
    for (const [name, size] of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(
        `<style>*{margin:0;padding:0}html,body{background:transparent}` +
        `svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      const png = await page.locator('svg').screenshot({ omitBackground: true });
      writeFileSync(join(ROOT, game, 'icons', name), png);
      await page.close();
    }
    console.log('rendered', game);
  }
} finally {
  await browser.close();
}
console.log('done');
