// Generates public/logo-email.png — the Cribal mark for emails (clients don't
// render SVG). A cyan rounded tile with the navy "C" arc + scan line + scan dot,
// so it reads on the navy email header. 64x64, supersampled 4x for smooth edges.
//
// Run: node scripts/generate-email-logo.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZE = 64
const SS = 4 // supersampling factor
const NAVY = [12, 30, 60] // #0c1e3c
const CYAN = [6, 182, 212] // #06b6d4
const RADIUS = 14 // rounded-corner radius

function insideRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false
  const cx = x < r ? r : x > w - r ? w - r : x
  const cy = y < r ? r : y > h - r ? h - r : y
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// True where the navy mark (C arc + scan line + scan dot) is drawn.
function isMark(x, y) {
  const dx = x - 32
  const dy = y - 32
  const dist = Math.hypot(dx, dy)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI

  // C arc: a ring (R≈20, stroke 6) open on the right (a ~104° gap).
  if (dist >= 17 && dist <= 23 && Math.abs(angle) > 52) return true
  // Scan line into the opening.
  if (Math.abs(dy) <= 1.6 && x >= 20 && x <= 40) return true
  // Scan dot at the line's end.
  if (Math.hypot(x - 40, y - 32) <= 5) return true
  return false
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1)) // +1 filter byte per row
let p = 0
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let covered = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS
        const fy = y + (sy + 0.5) / SS
        if (!insideRoundedRect(fx, fy, SIZE, SIZE, RADIUS)) continue
        const [cr, cg, cb] = isMark(fx, fy) ? NAVY : CYAN
        r += cr
        g += cg
        b += cb
        covered++
      }
    }
    const total = SS * SS
    if (covered === 0) {
      raw[p++] = 0
      raw[p++] = 0
      raw[p++] = 0
      raw[p++] = 0
    } else {
      raw[p++] = Math.round(r / covered)
      raw[p++] = Math.round(g / covered)
      raw[p++] = Math.round(b / covered)
      raw[p++] = Math.round((covered / total) * 255)
    }
  }
}

// --- Minimal PNG encoder (RGBA, 8-bit) ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'logo-email.png')
writeFileSync(outPath, png)
console.log(`Wrote ${outPath} (${png.length} bytes)`)
