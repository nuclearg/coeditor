import { Hono } from 'hono'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod/v4'
import type { AiAnswer } from '@coeditor/shared'
import { generateId, REVIEW_TYPES } from '@coeditor/shared'
import { parseSseLine, parseSseJson, SSE_EVENT } from '@coeditor/shared/sse'
import { defineRpc, safeId, safeTurnId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'

// === Simple in-memory rate limiter for ai.chat ===
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 20 // max requests per window
const rateLimitBuckets = new Map<string, number[]>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const timestamps = rateLimitBuckets.get(ip) || []
  // Remove expired entries
  const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (valid.length >= RATE_LIMIT_MAX) return false
  valid.push(now)
  rateLimitBuckets.set(ip, valid)
  return true
}

// Periodic cleanup of rate limit buckets (every 5 minutes)
const rlCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [ip, timestamps] of rateLimitBuckets) {
    const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    if (valid.length === 0) rateLimitBuckets.delete(ip)
    else rateLimitBuckets.set(ip, valid)
  }
}, 5 * 60_000)
if (rlCleanupTimer.unref) rlCleanupTimer.unref()

/**
 * Real TCP peer address from @hono/node-server. Forwarding headers
 * (x-forwarded-for / x-real-ip) are client-controlled and must NOT be trusted
 * for rate limiting. Falls back to 'local' outside a real socket (e.g.
 * in-process app.request tests).
 */
function getClientAddress(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress || 'local'
}

const app = new Hono()

// Zod schema for ai.chat request body.
// Caps are aligned with the 8MB bodyLimit: worst case
// 30 messages × 50000 chars + 200000 context ≈ 1.7M chars (< 8MB UTF-8).
const aiChatSchema = z.object({
  docId: safeId,
  convId: safeId,
  turnId: safeTurnId,
  answerId: safeId.optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(50000),
  })).min(1).max(30),
  reviewType: z.enum(REVIEW_TYPES).optional(),
  reviewFocus: z.enum(['plot', 'character']).optional(),
  contentContext: z.string().max(200000).optional(),
})

// === Explicit cancellation registry ===
// Streaming persists to the turn on the server regardless of client
// disconnects; only an explicit cancel request stops it. Each stream gets a
// unique streamId: the same turn can have two concurrent streams (stop →
// retry while the old stream is still draining), so keying by turnId alone
// would let the old stream's finally-block wipe the new stream's
// registration, making the new stream uncancellable.
const latestStreams = new Map<string, string>() // turnId -> streamId of the latest active stream
const cancelledStreams = new Set<string>() // cancelled streamIds
let streamCounter = 0
function newStreamId(): string {
  streamCounter += 1
  return `${Date.now().toString(36)}_${streamCounter.toString(36)}`
}

// Cancels that arrive while the turn has NO active stream are remembered
// briefly: in the Stop→Retry race the cancel can beat the retry stream's
// registration, and without this it would be dropped — leaving the new
// stream uncancellable. A stream registering within the TTL is cancelled
// immediately; entries are pruned lazily on access.
const pendingCancel = new Map<string, number>() // turnId -> expiry timestamp
let pendingCancelTtlMs = 10_000
function prunePendingCancel(): void {
  const now = Date.now()
  for (const [turnId, expiresAt] of pendingCancel) {
    if (expiresAt <= now) pendingCancel.delete(turnId)
  }
}

app.post('/api/ai.cancel', defineRpc(
  z.object({ docId: safeId, convId: safeId, turnId: safeTurnId }),
  async (input) => {
    const streamId = latestStreams.get(input.turnId)
    if (streamId) {
      // Cancel only the latest stream for the turn. Cancelling a turn
      // with no active stream never touches cancelledStreams directly, so
      // stale ids cannot accumulate there and silently cancel a later retry.
      cancelledStreams.add(streamId)
    } else {
      // No active stream — remember the cancel briefly for the Stop→Retry
      // race (see pendingCancel above).
      prunePendingCancel()
      pendingCancel.set(input.turnId, Date.now() + pendingCancelTtlMs)
    }
    return null
  },
))

// Shape of one upstream (OpenAI-compatible) streaming chunk.
interface UpstreamChunk {
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>
}

// ai.chat is a special SSE streaming endpoint — does not follow the standard { success, data } response format
app.post('/api/ai.chat', async (c) => {
  // Rate limiting — keyed by the real connection address
  const clientIp = getClientAddress(c)
  if (!checkRateLimit(clientIp)) {
    return c.json({ success: false, error: '请求过于频繁，请稍后再试（限制: 20次/分钟）' })
  }

  const raw = await c.req.json().catch(() => null)

  const parsed = aiChatSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    return c.json({ success: false, error: `${path}${issue.message}` })
  }
  const body = parsed.data

  const settings = await repo.settings.get(USER_ID)
  if (!settings.apiKey) {
    return c.json({ success: false, error: '未配置 API Key，请先在设置页面配置' })
  }

  // Pre-flight: the turn must exist BEFORE spending upstream tokens on it —
  // a stale turnId/convId would otherwise burn a whole generation (real
  // token cost) whose persists all silently fail.
  const existingTurn = await repo.turns.get(USER_ID, body.docId, body.convId, body.turnId)
  if (!existingTurn) {
    return c.json({ success: false, error: 'Turn 不存在' })
  }

  const prompts = await repo.loadPrompt(settings.style || 'gentle')

  // Build system prompt based on review type
  let systemContent = prompts.casual
  if (body.reviewType === 'paragraph') {
    systemContent = prompts.paragraphReview + (body.contentContext ? `\n\n${body.contentContext}` : '')
  } else if (body.reviewType === 'attachment') {
    systemContent = prompts.attachmentReview + (body.contentContext ? `\n\n${body.contentContext}` : '')
  } else if (body.reviewType === 'chapter') {
    systemContent = prompts.chapterReview + (body.contentContext ? `\n\n${body.contentContext}` : '')
  } else if (body.reviewType === 'fulltext') {
    systemContent = prompts.fulltextReview + (body.contentContext ? `\n\n${body.contentContext}` : '')
  }

  // 审阅维度：与 Java 后端对齐，注入聚焦指令
  if (body.reviewFocus === 'plot') {
    systemContent += '\n\n请重点审阅剧情逻辑、伏笔、节奏和结构。'
  } else if (body.reviewFocus === 'character') {
    systemContent += '\n\n请重点审阅人物弧光、动机、行为一致性和成长线。'
  }

  // Build messages array WITHOUT mutating the original.
  // The server injects its own system prompt — drop any client-supplied
  // system messages (prevents prompt-injection via mid-array system roles).
  const userMessages = body.messages.filter((m) => m.role !== 'system')
  const messages = [{ role: 'system', content: systemContent }, ...userMessages]

  const model = settings.model

  // No longer tied to the client's abort signal: the response is persisted
  // server-side even if the browser disconnects mid-stream. The only way to
  // stop it is an explicit /api/ai.cancel request.
  const streamId = newStreamId()
  return streamSSE(c, async (stream) => {
    // Register — and honor a cancel that beat this stream's registration
    // (Stop→Retry race, see pendingCancel).
    prunePendingCancel()
    if (pendingCancel.has(body.turnId)) {
      pendingCancel.delete(body.turnId)
      cancelledStreams.add(streamId)
    }
    latestStreams.set(body.turnId, streamId)
    // Deregister this stream (cancelled set + latestStreams). Must run on EVERY
    // exit path — including the early returns for connect failure / non-ok /
    // missing body — otherwise the registries leak a dead entry per failed call.
    const unregister = () => {
      cancelledStreams.delete(streamId)
      if (latestStreams.get(body.turnId) === streamId) {
        latestStreams.delete(body.turnId)
      }
    }
    const isCancelled = () => cancelledStreams.has(streamId)

    // Cancelled before we even connected (pendingCancel hit) — skip the
    // upstream call entirely, no tokens spent, nothing to persist.
    if (isCancelled()) {
      unregister()
      return
    }

    // Client-disconnect detection: hono's StreamingApi.write swallows write
    // errors, so a try/catch around writeSSE can never observe a disconnect.
    // The request's AbortSignal is the reliable source instead.
    let clientGone = c.req.raw.signal.aborted
    if (!clientGone) {
      c.req.raw.signal.addEventListener('abort', () => { clientGone = true }, { once: true })
    }
    const sendToClient = async (payload: Record<string, string>) => {
      if (clientGone) return
      try {
        await stream.writeSSE({ data: JSON.stringify(payload) })
      } catch {
        // Defensive — hono currently never rejects here; the abort-signal
        // listener above is the real disconnect path.
        clientGone = true
      }
    }

    let response: Response

    // Connect-only timeout: abort if the response has not arrived yet. The
    // timer is cleared the moment the response is received, so body streaming
    // is never truncated — healthy long generations may run for many minutes
    // (the idle watchdog below guards against stalls instead).
    const CONNECT_TIMEOUT_MS = 30_000
    const connectController = new AbortController()
    const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS)
    try {
      response = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal: connectController.signal,
      })
    } catch (err: unknown) {
      clearTimeout(connectTimer)
      const msg = connectController.signal.aborted
        ? '连接 API 服务器超时'
        : err instanceof Error ? err.message : String(err)
      await sendToClient({ [SSE_EVENT.error]: `无法连接到 API 服务器: ${msg}` })
      unregister()
      return
    }
    // Response received — body streaming must not be affected by the timeout.
    clearTimeout(connectTimer)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      const msg = response.status === 401 || response.status === 403
        ? 'API Key 无效或已过期'
        : response.status === 404
          ? 'API 地址或模型不存在'
          : `API 返回错误 (${response.status}): ${errText.slice(0, 200)}`
      await sendToClient({ [SSE_EVENT.error]: msg })
      unregister()
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      await sendToClient({ [SSE_EVENT.error]: 'No response body' })
      unregister()
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let thinking = ''
    // Number of successfully parsed upstream data chunks — zero at stream
    // end means a 200 response that never carried usable SSE data (e.g. a
    // JSON error body), which must not persist as an empty answer.
    let parsedChunks = 0

    // Idle watchdog: if the upstream stalls (no data at all), cancel the
    // reader so we don't hang forever and the accumulated content is persisted.
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let upstreamTimedOut = false
    const IDLE_TIMEOUT_MS = 120_000
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        upstreamTimedOut = true
        void reader.cancel().catch(() => {})
      }, IDLE_TIMEOUT_MS)
    }

    // Persist the accumulated answer to the turn, throttled to once per
    // second. A single stable answerId is used for the whole stream so every
    // write updates the SAME answer in place — otherwise each throttled write
    // would push a brand-new answer (dozens of bubbles for one response).
    let answerId = body.answerId
    let lastPersist = 0
    const PERSIST_INTERVAL_MS = 1000
    const persist = async (final = false, makeCurrent = true) => {
      // Skip throttled writes after a cancel, but still allow the final flush
      // so the last accumulated content is never lost on cancel.
      if (isCancelled() && !final) return
      const now = Date.now()
      if (!final && now - lastPersist < PERSIST_INTERVAL_MS) return
      lastPersist = now
      if (!answerId) answerId = generateId()
      const answer: AiAnswer = {
        id: answerId,
        content,
        thinking,
        model,
        createdAt: new Date().toISOString(),
      }
      const write = () => repo.turns.addAnswer(USER_ID, body.docId, body.convId, body.turnId, answer, answerId, makeCurrent)
      try {
        await write()
      } catch (err) {
        if (!final) {
          // A throttled write will be retried within a second.
          console.warn('[ai.chat] persist failed:', err)
          return
        }
        // Final flush failure loses the whole answer — retry once. (This is
        // exactly the client-disconnected scenario the endpoint is built for,
        // so a single transient fs hiccup must not drop the response.)
        try {
          await write()
        } catch (retryErr) {
          console.error('[ai.chat] final persist failed twice:', retryErr)
          await sendToClient({ [SSE_EVENT.error]: '回答保存失败，请重试' })
        }
      }
    }

    // Parse one complete SSE line and fold it into the accumulated answer.
    // Parsing uses the shared @coeditor/shared/sse module (handles `data:`
    // with or without the space after the colon).
    const processLine = async (line: string) => {
      const parsedLine = parseSseLine(line)
      if (parsedLine.type !== 'data') return
      const chunk = parseSseJson<UpstreamChunk>(parsedLine.payload)
      if (!chunk) {
        // Skip malformed JSON chunks from upstream
        console.warn('[ai.chat] Skipped malformed SSE chunk:', parsedLine.payload.slice(0, 100))
        return
      }
      parsedChunks += 1
      const delta = chunk.choices?.[0]?.delta
      if (delta?.reasoning_content) {
        thinking += delta.reasoning_content
        await sendToClient({ [SSE_EVENT.thinking]: delta.reasoning_content })
      }
      if (delta?.content) {
        content += delta.content
        await sendToClient({ [SSE_EVENT.content]: delta.content })
      }
      await persist()
    }

    // Flush whatever is left in the decoder + buffer (final event without a
    // trailing newline is recovered; incomplete JSON is dropped).
    const flushBuffer = async () => {
      buffer += decoder.decode()
      if (buffer.trim()) await processLine(buffer)
      buffer = ''
    }

    try {
      resetIdle()
      while (true) {
        // Explicit cancel from the client — stop and finalize what we have.
        if (isCancelled()) {
          await reader.cancel().catch(() => {})
          await flushBuffer()
          // A cancelled stream must not hijack the selected answer: with
          // nothing accumulated there is nothing to persist, and a late
          // push must not move currentAnswerIndex (the retry stream may
          // already own it).
          if (content || thinking) await persist(true, false)
          return
        }

        const { done, value } = await reader.read()
        if (done) {
          await flushBuffer()
          break
        }

        resetIdle()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          await processLine(line)
        }
      }

      if (parsedChunks === 0 && !content && !thinking) {
        // Upstream returned 200 but never sent a single parseable data
        // chunk (e.g. a JSON error body) — report it instead of persisting
        // an empty answer.
        await sendToClient({ [SSE_EVENT.error]: '上游未返回有效内容' })
        return
      }

      // Persist BEFORE any error event: clients re-fetch on error and must
      // not see a snapshot missing the tail (also applies to the idle
      // timeout path).
      await persist(true)
      if (upstreamTimedOut && !clientGone) {
        await sendToClient({ [SSE_EVENT.error]: '上游响应超时，已停止接收并保存已生成内容' })
      }
    } catch (err) {
      // Upstream read failed mid-way — persist what we have.
      await persist(true)
      if (!clientGone) {
        if (upstreamTimedOut) {
          await sendToClient({ [SSE_EVENT.error]: '上游响应超时，已停止接收并保存已生成内容' })
        } else {
          await sendToClient({ [SSE_EVENT.error]: err instanceof Error ? err.message : 'Unknown error' })
        }
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      unregister()
    }
  })
})

// === Test-only hooks ===
// app.request runs every test through the single 'local' rate-limit bucket
// and cancel-race tests need a short pendingCancel TTL.

/** Test-only: clear all rate-limit buckets. */
export function __resetRateLimitForTesting(): void {
  rateLimitBuckets.clear()
}

/** Test-only: override the pendingCancel TTL (ms). */
export function __setPendingCancelTtlForTesting(ms: number): void {
  pendingCancelTtlMs = ms
}

export default app
