// Generates the extension's PNG icons (green rounded square with a white ring) using only Node built-ins.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size) {
  const green = [0x16, 0x65, 0x34];
  const white = [255, 255, 255];
  const ss = 4; // supersampling for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size; // 0..1
          const v = (y + (sy + 0.5) / ss) / size;
          // rounded square mask
          const rad = 0.22;
          const dx = Math.max(Math.abs(u - 0.5) - (0.5 - rad), 0);
          const dy = Math.max(Math.abs(v - 0.5) - (0.5 - rad), 0);
          if (Math.hypot(dx, dy) > rad) continue;
          const d = Math.hypot(u - 0.5, v - 0.5);
          const ring = d > 0.27 && d < 0.37;
          const dot = d < 0.11;
          const col = ring || dot ? white : green;
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = ss * ss;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const covered = a / 255;
      raw[i] = covered ? Math.round(r / covered) : 0;
      raw[i + 1] = covered ? Math.round(g / covered) : 0;
      raw[i + 2] = covered ? Math.round(b / covered) : 0;
      raw[i + 3] = Math.round(a / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(path.join(outDir, `icon${size}.png`), render(size));
  console.log(`wrote icon${size}.png`);
}
