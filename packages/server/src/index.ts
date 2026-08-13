
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { serve } from '@hono/node-server'
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
