// Generates Draughts's PNG app icons with no external image libraries — a
// checkerboard with a single crowned draughts piece, encoded as a PNG by hand.
//   node draughts/tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
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
  const ring = (cx, cy, rad, width, col) => {
    for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
      const d = Math.hypot(x - cx, y - cy); const a = 1 - Math.max(0, Math.abs(d - rad) - width / 2);
      if (a > 0) set(x, y, col[0], col[1], col[2], Math.round(Math.min(1, a) * 255));
    }
  };
  const disc = (cx, cy, rad, col) => {
    for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
      const a = Math.max(0, Math.min(1, rad - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, col[0], col[1], col[2], Math.round(a * 255));
    }
  };
  // Checkerboard.
  const cell = size / 4, dark = [58, 74, 92], light = [214, 205, 186];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0, c = on ? light : dark;
    const v = 1 - 0.14 * (Math.hypot(x - size / 2, y - size / 2) / (size / 1.4));
    set(x, y, c[0] * v, c[1] * v, c[2] * v, 255);
  }
  // A crowned red draughts piece, centred.
  const cx = size / 2, cy = size / 2, R = size * 0.32;
  disc(cx, cy + size * 0.02, R, [20, 24, 30]);           // shadow
  disc(cx, cy, R, [178, 46, 46]);                        // body
  ring(cx, cy, R * 0.78, size * 0.03, [120, 26, 26]);    // inner ridge
  ring(cx, cy, R * 0.5, size * 0.045, [240, 196, 78]);   // gold king ring
  disc(cx, cy, R * 0.16, [240, 196, 78]);                // gold centre
  return encodePNG(size, size, buf);
}

for (const [name, sz] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = draw(sz); writeFileSync(new URL(`../icons/${name}`, import.meta.url), png);
  console.log(`wrote icons/${name} (${sz}px, ${png.length} bytes)`);
}
