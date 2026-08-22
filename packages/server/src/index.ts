
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { serve } from '@hono/node-server'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import documents from './routes/documents.js'
import chapters from './routes/chapters.js'
import paragraphs from './routes/paragraphs.js'
import paragraphDrafts from './routes/paragraph-drafts.js'
import attachments from './routes/attachments.js'
import attachmentDrafts from './routes/attachment-drafts.js'
import templates from './routes/templates.js'
import conversations from './routes/conversations.js'
import turns from './routes/turns.js'
import ai from './routes/ai.js'
import settings from './routes/settings.js'
import { repo } from './store/index.js'
import { DATA_ROOT } from './store/file-paths.js'

const app = new Hono()

// Restrict CORS to localhost origins only
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return ''
    try {
      const url = new URL(origin)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return origin
      }
    } catch { /* invalid origin */ }
    return ''
  },
}))

// Request body size limit: 8MB. Aligned with the ai.chat schema caps
// (30 messages × 50000 chars + 200000 context) — the worst case stays
// comfortably below this limit.
const BODY_LIMIT_BYTES = 8 * 1024 * 1024
app.use('*', bodyLimit({ maxSize: BODY_LIMIT_BYTES }))

// Global error handler
app.onError((err, c) => {
  // HTTPException carries a status (e.g. 413 from bodyLimit) — preserve it
  // and return a meaningful message instead of flattening to a generic 200.
  if (err instanceof HTTPException) {
    const message = err.status === 413
      ? `请求体过大（上限 ${Math.round(BODY_LIMIT_BYTES / 1024 / 1024)}MB），请减少内容后重试`
      : err.message || '请求处理失败'
    return c.json({ success: false, error: message }, err.status)
  }
  console.error('[Server Error]', err.message, err.stack)
  return c.json({ success: false, error: err.message || '服务器内部错误' })
})

app.route('/', documents)
app.route('/', chapters)
app.route('/', paragraphs)
app.route('/', paragraphDrafts)
app.route('/', attachments)
app.route('/', attachmentDrafts)
app.route('/', templates)
app.route('/', conversations)
app.route('/', turns)
app.route('/', ai)
app.route('/', settings)

// Initialize repository (user env setup)
// Log the resolved data dir first — a wrong DATA_ROOT must never be silent
// (it would look like "all data disappeared").
console.log(`[coeditor] DATA_ROOT: ${DATA_ROOT}`)

await repo.initialize()

// ---- 桌面壳静态服务（可选）----
// 设置 COEDITOR_WEB_ROOT 时，额外托管该目录（H5 产物 dist-h5）：
// GET / 返回 index.html，其余按路径返回静态文件。
// 桌面壳（desktop/）用它实现"单端口同源"：窗口直连 http://127.0.0.1:<port>/，
// 页面与 /api/* 同源，无 CORS、无跨源 localStorage。
// 未设置时行为与之前完全一致（纯 API 服务，配合 Nginx 部署）。
const WEB_ROOT = process.env.COEDITOR_WEB_ROOT
  ? path.resolve(process.env.COEDITOR_WEB_ROOT)
  : undefined

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
}

// 桌面壳 webview CSP：页面经 External loopback HTTP 加载，tauri.conf.json 的 csp
// 对 remote origin 不生效，响应头才是有效管控面。产物无内联脚本（script 只许同源文件）；
// Taro 运行时会注入内联样式，style 放开 unsafe-inline；图片允许 https（用户内容引用远端图）；
// 连接仅同源（/api 走 sidecar 代理）；禁 object/frame。
const DESKTOP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
  + " img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self';"
  + " object-src 'none'; base-uri 'self'; frame-src 'none'"

if (WEB_ROOT) {
  app.get('*', async (c) => {
    const url = new URL(c.req.url)
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')
    const filePath = path.join(WEB_ROOT, rel)
    // 路径穿越防护：解析结果必须仍在 WEB_ROOT 内
    if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + path.sep)) {
      return c.text('Not Found', 404)
    }
    try {
      const s = await stat(filePath)
      if (!s.isFile()) return c.text('Not Found', 404)
      const ext = path.extname(filePath).toLowerCase()
      c.header('Content-Type', STATIC_MIME[ext] || 'application/octet-stream')
      c.header('Content-Security-Policy', DESKTOP_CSP)
      // 桌面壳场景文件不变，html 不缓存、带 hash 的资源长缓存
      c.header('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
      return c.body(await readFile(filePath))
    } catch {
      return c.text('Not Found', 404)
    }
  })
}

export default app

// PORT parsing: unset → 3001; 0 is legal (node picks a random port);
// anything non-integer or out of 0-65535 is a startup error, never silently
// substituted.
function resolvePort(): number {
  const raw = process.env.PORT
  if (raw === undefined || raw === '') return 3001
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`[coeditor] 非法 PORT "${raw}"：必须是 0-65535 的整数`)
    process.exit(1)
  }
  return port
}

const port = resolvePort()
// Bind to loopback by default: there is no auth, so listening on all
// interfaces would expose every document (and the AI API key in settings)
// to the whole network. Override with HOST when needed.
const hostname = process.env.HOST || '127.0.0.1'

if (process.env.NODE_ENV !== 'test') {
  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.log(`Server running at http://${hostname}:${info.port}`)
  })

  // Graceful shutdown: stop accepting connections and give in-flight streams
  // up to 5s to run their final persist before forcing exit.
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[coeditor] 收到 ${signal}，正在优雅停机（最长等待 5s）...`)
    const force = setTimeout(() => process.exit(1), 5000)
    force.unref()
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
