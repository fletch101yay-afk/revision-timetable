// Run once: node scripts/generate-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function makePNG(size, bgR, bgG, bgB, accentR, accentG, accentB) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.concat([t, data]);
    let c = 0xffffffff;
    for (const b of crcBuf) { c ^= b; for (let j=0;j<8;j++) c = (c&1)?(0xedb88320^(c>>>1)):(c>>>1); }
    c ^= 0xffffffff;
    const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(c >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8]=8; ihdr[9]=2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

  const cx = size / 2, cy = size / 2;
  const raw = Buffer.allocUnsafe(size * (size * 3 + 1));
  let pos = 0;
  for (let y = 0; y < size; y++) {
    raw[pos++] = 0; // filter type
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const r2 = dx*dx + dy*dy;
      // rounded-rect background: 20% corner radius
      const pad = size * 0.20;
      const inRect = x >= pad && x <= size-pad && y >= pad && y <= size-pad;
      const corner = (() => {
        const corners = [[pad,pad],[size-pad,pad],[pad,size-pad],[size-pad,size-pad]];
        for (const [cx2,cy2] of corners) {
          const d = Math.hypot(x-cx2, y-cy2);
          if (x < cx2 && y < cy2 && d > pad) return false; // outside corner
          if (x > size-pad && y < pad && Math.hypot(x-(size-pad),y-pad)>pad) return false;
        }
        return true;
      })();
      const inBg = x>=pad&&x<=size-pad&&y>=pad&&y<=size-pad;

      // draw simple calendar icon
      const s = size;
      const L = s*0.23, R = s*0.77, T = s*0.27, B = s*0.73;
      const headerY = T + s*0.11;
      const notchW = s*0.055, notchH = s*0.12;
      const n1x = L + s*0.11, n2x = R - s*0.11 - notchW;

      let pr = bgR, pg = bgG, pb = bgB;

      const inOuter = x>=L&&x<=R&&y>=T&&y<=B;
      if (inOuter) {
        pr = Math.min(255, bgR + 30); pg = Math.min(255, bgG + 30); pb = Math.min(255, bgB + 30);
        const brd = 3;
        if (x<=L+brd||x>=R-brd||y<=T+brd||y>=B-brd) { pr=accentR; pg=accentG; pb=accentB; }
        if (y>=headerY-brd&&y<=headerY+brd) { pr=accentR; pg=accentG; pb=accentB; }
        // notch 1
        if (x>=n1x&&x<=n1x+notchW&&y>=T-notchH*0.4&&y<=T+notchH*0.7) { pr=accentR; pg=accentG; pb=accentB; }
        // notch 2
        if (x>=n2x&&x<=n2x+notchW&&y>=T-notchH*0.4&&y<=T+notchH*0.7) { pr=accentR; pg=accentG; pb=accentB; }
        // grid lines (3 rows of dots)
        if (y > headerY + brd) {
          const cellH = (B - headerY - brd) / 3;
          const cellW = (R - L) / 4;
          for (let row=0;row<3;row++) {
            for (let col=0;col<3;col++) {
              const bx = L + cellW*(col+0.5) - s*0.04, by2 = headerY + brd + cellH*(row+0.5) - s*0.015;
              if (x>=bx&&x<=bx+s*0.09&&y>=by2&&y<=by2+s*0.03) {
                if (col===1&&row===1) { pr=accentR; pg=accentG; pb=accentB; }
                else { pr=220; pg=220; pb=225; }
              }
            }
          }
        }
      }
      raw[pos++] = pr; raw[pos++] = pg; raw[pos++] = pb;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, chunk('IHDR', ihdr), idat, iend]);
}

const outDir = path.join(__dirname, '..', 'client', 'public');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const buf = makePNG(size, 0x11, 0x11, 0x13, 0xc0, 0x88, 0x28);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buf);
  console.log(`✓ icon-${size}.png`);
}

// apple-touch-icon (180x180)
const apple = makePNG(180, 0x11, 0x11, 0x13, 0xc0, 0x88, 0x28);
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), apple);
console.log('✓ apple-touch-icon.png');
