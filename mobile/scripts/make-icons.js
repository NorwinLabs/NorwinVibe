// Generates the Android launcher icons (a vinyl record on a dark tile) with no dependencies.
//   node scripts/make-icons.js
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(N, px) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((N * 4 + 1) * N);
  for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// shape: 'tile' (rounded square, legacy), 'round' (circle), 'fg' (record only, transparent: adaptive foreground)
function render(N, shape) {
  const SS = 3, px = Buffer.alloc(N * N * 4);
  const recordR = shape === 'fg' ? 0.30 : 0.38; // fraction of N (adaptive icons keep ~66% of the canvas safe)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const fx = x + (sx + .5) / SS, fy = y + (sy + .5) / SS, dx = fx - N / 2, dy = fy - N / 2, d = Math.hypot(dx, dy);
      let c = [0, 0, 0, 0];
      let inside = true;
      if (shape === 'round') inside = d <= N / 2;
      if (shape === 'tile') { const r = N * 0.22, ax = Math.abs(dx) - (N / 2 - r), ay = Math.abs(dy) - (N / 2 - r); inside = !(ax > 0 && ay > 0 && Math.hypot(ax, ay) > r); }
      if (inside && shape !== 'fg') c = [...mix([20, 14, 40], [60, 20, 70], (dx + dy) / (2 * N) + .5), 255];
      const r = d / (N * recordR); // 1.0 = record edge
      if (r <= 1) {
        if (r < .07) c = shape === 'fg' ? [0, 0, 0, 0] : [20, 14, 40, 255];
        else if (r < .36) c = [...mix([139, 92, 246], [236, 72, 153], Math.min(1, Math.max(0, (dx + dy) / (N * recordR * 1.4) + .5))), 255];
        else { const g = 12 + (Math.floor(r * 70) % 2) * 7; c = [g, g, g + 3, 255]; if (Math.max(0, Math.cos(2 * Math.atan2(dy, dx) - 1)) ** 14 > .3) c = [c[0] + 30, c[1] + 30, c[2] + 34, 255]; }
      } else if (r <= 1.04) c = [255, 255, 255, 60]; // faint rim
      acc = acc.map((v, i) => v + c[i] * (i === 3 ? 1 : c[3] / 255));
    }
    const a = acc[3] / (SS * SS), o = (y * N + x) * 4;
    for (let k = 0; k < 3; k++) px[o + k] = a ? Math.min(255, acc[k] / (SS * SS) / (a / 255)) : 0;
    px[o + 3] = a;
  }
  return png(N, px);
}

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(dens)) {
  const dir = path.join(res, `mipmap-${name}`);
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), render(Math.round(48 * k), 'tile'));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), render(Math.round(48 * k), 'round'));
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), render(Math.round(108 * k), 'fg'));
}
fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1A0F2E</color>\n</resources>\n');
console.log('launcher icons written');
