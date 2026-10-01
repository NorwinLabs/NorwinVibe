// Generates assets/icon.png (a vinyl record) with no dependencies.
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const N = 256, SS = 3;
const px = Buffer.alloc(N * N * 4);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let acc = [0, 0, 0, 0];
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const dx = x + (sx + .5) / SS - N / 2, dy = y + (sy + .5) / SS - N / 2, r = Math.hypot(dx, dy) / (N / 2);
    let c = [0, 0, 0, 0];
    if (r <= .97) {
      if (r < .04) c = [0, 0, 0, 0];
      else if (r < .38) { const t = (dx + dy) / N + .5; c = [...mix([139, 92, 246], [236, 72, 153], Math.min(1, Math.max(0, t))), 255]; }
      else { const g = 14 + (Math.floor(r * 90) % 2) * 6; c = [g, g, g + 3, 255]; }
      const ang = Math.atan2(dy, dx); // soft sheen
      if (r > .4 && Math.max(0, Math.cos(2 * ang - 1)) ** 12 > .3) c = [c[0] + 28, c[1] + 28, c[2] + 30, 255];
    }
    acc = acc.map((v, i) => v + c[i] * (i === 3 ? 1 : c[3] / 255));
  }
  const a = acc[3] / (SS * SS), o = (y * N + x) * 4;
  px[o] = a ? acc[0] / (SS * SS) / (a / 255) : 0; px[o + 1] = a ? acc[1] / (SS * SS) / (a / 255) : 0; px[o + 2] = a ? acc[2] / (SS * SS) / (a / 255) : 0; px[o + 3] = a;
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
