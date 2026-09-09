// SVG → PNG 转换（基于 sharp，由 logo-to-png.sh 保证依赖可用）
// 用法: node svg-to-png.js <src.svg> <out.png> [size] [--trim]
//   size  输出边长（默认 1024）
//   --trim 先裁掉透明边缘再缩放（用于前端紧凑版 logo）
const sharp = require('sharp')

async function main() {
  const [src, out, sizeArg, trimFlag] = process.argv.slice(2)
  if (!src || !out) {
    console.error('usage: svg-to-png <src.svg> <out.png> [size] [--trim]')
    process.exit(1)
  }
  const size = sizeArg ? parseInt(sizeArg, 10) : 1024
  if (!Number.isInteger(size) || size <= 0) {
    console.error(`invalid size: ${sizeArg}`)
    process.exit(1)
  }
  let pipeline = sharp(src)
  if (trimFlag === '--trim') pipeline = pipeline.trim()
  await pipeline.resize(size, size).png().toFile(out)
  console.log(`done: ${out} (${size}x${size})${trimFlag === '--trim' ? ', trimmed' : ''}`)
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
