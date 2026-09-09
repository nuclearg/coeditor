// 生成 1024x1024 应用图标（纯 Node，无第三方依赖）：深蓝底 + 白色"文稿"圆角矩形 + 三行文字线。
// 用法：node scripts/gen-icon.mjs [输出路径]，默认 ./icon-src.png
import zlib from 'node:zlib'
import { writeFileSync } from 'node:fs'

const W = 1024
const H = 1024
const BG = [30, 58, 138] // #1E3A8A
const WHITE = [255, 255, 255]

// 白色圆角矩形（文稿）
const PAGE = { x0: 0.30 * W, y0: 0.28 * H, x1: 0.70 * W, y1: 0.66 * H, r: 44 }
// 文字行（用底色画在白色矩形内）
const LINES = [
  { y: 0.38 * H, x: 0.38 * W, w: 0.24 * W },
  { y: 0.47 * H, x: 0.38 * W, w: 0.24 * W },
  { y: 0.56 * H, x: 0.38 * W, w: 0.14 * W },
]
const LINE_H = 0.016 * H

function inRoundedRect(x, y, p) {
  if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) return false
  const cx = Math.max(p.x0 + p.r, Math.min(x, p.x1 - p.r))
  const cy = Math.max(p.y0 + p.r, Math.min(y, p.y1 - p.r))
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= p.r * p.r
}

const raw = Buffer.alloc(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 4)
  raw[rowStart] = 0 // filter: none
  for (let x = 0; x < W; x++) {
    let [r, g, b] = BG
    if (inRoundedRect(x, y, PAGE)) {
      ;[r, g, b] = WHITE
      for (const l of LINES) {
        if (y >= l.y - LINE_H / 2 && y <= l.y + LINE_H / 2 && x >= l.x && x <= l.x + l.w) {
          ;[r, g, b] = BG
          break
        }
      }
    }
    const o = rowStart + 1 + x * 4
    raw[o] = r
    raw[o + 1] = g
    raw[o + 2] = b
    raw[o + 3] = 255
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0)
  return Buffer.concat([len, t, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
// compression/filter/interlace = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2] || 'icon-src.png'
writeFileSync(out, png)
console.log(`icon written: ${out} (${png.length} bytes)`)
