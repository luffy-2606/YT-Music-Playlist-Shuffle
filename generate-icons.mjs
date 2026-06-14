/**
 * Generates PNG icon files for the Chrome extension.
 * Uses pure Node.js to write minimal valid PNG files with a shuffle symbol.
 * Run: node generate-icons.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { createCanvas } from 'canvas';

const SIZES = [16, 48, 128];

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size;

  // Dark rounded background
  ctx.beginPath();
  const r = s * 0.18;
  ctx.moveTo(r, 0);
  ctx.lineTo(s - r, 0);
  ctx.quadraticCurveTo(s, 0, s, r);
  ctx.lineTo(s, s - r);
  ctx.quadraticCurveTo(s, s, s - r, s);
  ctx.lineTo(r, s);
  ctx.quadraticCurveTo(0, s, 0, s - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#1a1a2e');
  grad.addColorStop(1, '#16213e');
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw shuffle icon (two crossing arrows)
  ctx.strokeStyle = '#ff4444';
  ctx.lineWidth = s * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const p = s * 0.18; // padding
  const m = s * 0.5;  // midpoint

  // Top path: straight arrow top-left to top-right
  ctx.beginPath();
  ctx.moveTo(p, p + s * 0.12);
  ctx.lineTo(s - p - s * 0.15, p + s * 0.12);
  ctx.stroke();

  // Bottom path: straight arrow bottom-left to bottom-right  
  ctx.beginPath();
  ctx.moveTo(p, s - p - s * 0.12);
  ctx.lineTo(s - p - s * 0.15, s - p - s * 0.12);
  ctx.stroke();

  // Crossing curve (X in the middle)
  ctx.beginPath();
  ctx.moveTo(p, s - p - s * 0.12);
  ctx.bezierCurveTo(m * 0.8, s - p - s * 0.12, m * 1.2, p + s * 0.12, s - p - s * 0.15, p + s * 0.12);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(p, p + s * 0.12);
  ctx.bezierCurveTo(m * 0.8, p + s * 0.12, m * 1.2, s - p - s * 0.12, s - p - s * 0.15, s - p - s * 0.12);
  ctx.stroke();

  // Arrowhead top-right
  ctx.beginPath();
  ctx.moveTo(s - p - s * 0.15, p + s * 0.12);
  ctx.lineTo(s - p, p + s * 0.12 - s * 0.1);
  ctx.moveTo(s - p - s * 0.15, p + s * 0.12);
  ctx.lineTo(s - p, p + s * 0.12 + s * 0.1);
  ctx.stroke();

  // Arrowhead bottom-right
  ctx.beginPath();
  ctx.moveTo(s - p - s * 0.15, s - p - s * 0.12);
  ctx.lineTo(s - p, s - p - s * 0.12 - s * 0.1);
  ctx.moveTo(s - p - s * 0.15, s - p - s * 0.12);
  ctx.lineTo(s - p, s - p - s * 0.12 + s * 0.1);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// Fallback: create minimal valid PNG using raw bytes if canvas is not available
function createMinimalPNG(size) {
  // A minimal 1x1 red pixel PNG scaled to the requested size via a simple approach
  // We'll create a simple colored square PNG
  
  function crc32(buf) {
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table.push(c);
    }
    let crc = 0xFFFFFFFF;
    for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function deflate(data) {
    // Simple uncompressed deflate block
    const len = data.length;
    const buf = Buffer.allocUnsafe(5 + len + 6);
    buf[0] = 0x78; buf[1] = 0x01; // zlib header
    buf[2] = 0x01; // BFINAL=1, BTYPE=00 (uncompressed)
    buf[3] = len & 0xFF; buf[4] = (len >> 8) & 0xFF;
    buf[5] = (~len) & 0xFF; buf[6] = ((~len) >> 8) & 0xFF;
    data.copy(buf, 7);
    // Adler32
    let s1 = 1, s2 = 0;
    for (const b of data) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
    const adler = (s2 << 16) | s1;
    buf.writeUInt32BE(adler, buf.length - 4);
    return buf;
  }

  // Build raw image data (RGBA)
  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0; // filter type
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      // Dark background with red center
      const cx = x - size / 2, cy = y - size / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      const isIcon = dist < size * 0.4;
      rawData[offset] = isIcon ? 0xFF : 0x1a;     // R
      rawData[offset + 1] = isIcon ? 0x44 : 0x1a; // G
      rawData[offset + 2] = isIcon ? 0x44 : 0x2e; // B
      rawData[offset + 3] = 0xFF;                  // A
    }
  }

  const compressed = deflate(rawData);

  function chunk(type, data) {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(data.length);
    const typeBytes = Buffer.from(type);
    const crc = Buffer.allocUnsafe(4);
    const crcData = Buffer.concat([typeBytes, data]);
    crc.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeBytes, data, crc]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('./icons', { recursive: true });

for (const size of SIZES) {
  let pngData;
  try {
    pngData = drawIcon(size);
    console.log(`✅ Generated icon${size}.png using canvas`);
  } catch (e) {
    console.warn(`⚠️  canvas not available, using fallback for icon${size}.png`);
    pngData = createMinimalPNG(size);
  }
  writeFileSync(`./icons/icon${size}.png`, pngData);
}

console.log('🎨 Icons generated in ./icons/');
