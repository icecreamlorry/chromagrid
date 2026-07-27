// Generates Backgammon's PNG app icons with no external image libraries — a
// stylised board (felt + points), a couple of checkers and a die, encoded by
// hand.  node backgammon/tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0); return Buffer.concat([len, td, crc]); }
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (Math.round(y) * size + Math.round(x)) * 4, ia = a / 255, ib = 1 - ia;
    buf[i] = Math.round(r * ia + buf[i] * ib); buf[i + 1] = Math.round(g * ia + buf[i + 1] * ib);
    buf[i + 2] = Math.round(b * ia + buf[i + 2] * ib); buf[i + 3] = Math.max(buf[i + 3], a);
  };
  const rect = (x0, y0, x1, y1, col) => { for (let y = Math.round(y0); y < y1; y++) for (let x = Math.round(x0); x < x1; x++) set(x, y, col[0], col[1], col[2]); };
  const disc = (cx, cy, rad, col) => { for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) { const a = Math.max(0, Math.min(1, rad - Math.hypot(x - cx, y - cy) + 0.5)); if (a > 0) set(x, y, col[0], col[1], col[2], Math.round(a * 255)); } };
  // Triangle with apex pointing up/down.
  const tri = (cx, baseY, apexY, halfW, col) => {
    const y0 = Math.min(baseY, apexY), y1 = Math.max(baseY, apexY);
    for (let y = Math.round(y0); y <= y1; y++) { const tpos = (apexY > baseY) ? (y - baseY) / (apexY - baseY) : (baseY - y) / (baseY - apexY); const hw = halfW * (1 - tpos); for (let x = Math.round(cx - hw); x <= cx + hw; x++) set(x, y, col[0], col[1], col[2]); }
  };

  rect(0, 0, size, size, [90, 61, 34]);                       // wood frame
  const m = size * 0.1; rect(m, m, size - m, size - m, [46, 97, 82]);   // felt
  rect(size * 0.47, m, size * 0.53, size - m, [64, 42, 23]);  // bar

  const light = [217, 183, 132], dark = [156, 107, 63];
  const cols = 5; const x0 = m + size * 0.02; const w = (size * 0.37 - size * 0.02) / cols;
  for (let c = 0; c < cols; c++) {
    const cx = x0 + w * c + w / 2;
    tri(cx, m, m + size * 0.34, w * 0.42, c % 2 ? light : dark);          // top row (apex down)
    tri(cx, size - m, size - m - size * 0.34, w * 0.42, c % 2 ? dark : light); // bottom row (apex up)
  }
  // Two checkers + a die.
  disc(size * 0.24, size * 0.72, size * 0.09, [242, 230, 200]);
  disc(size * 0.24, size * 0.72, size * 0.09 * 0.6, [46, 97, 82]);
  disc(size * 0.68, size * 0.30, size * 0.09, [43, 52, 64]);
  const ds = size * 0.2, dx = size * 0.6, dy = size * 0.55;
  rect(dx, dy, dx + ds, dy + ds, [244, 241, 232]);
  for (const [px, py] of [[0.3, 0.3], [0.7, 0.7], [0.5, 0.5]]) disc(dx + px * ds, dy + py * ds, size * 0.016, [26, 31, 38]);
  return encodePNG(size, size, buf);
}
for (const [name, sz] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = draw(sz); writeFileSync(new URL(`../icons/${name}`, import.meta.url), png);
  console.log(`wrote icons/${name} (${sz}px, ${png.length} bytes)`);
}
