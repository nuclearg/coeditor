import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import type { AiTurn } from '@coeditor/shared'
import { parseSseLine, parseSseJson } from '@coeditor/shared/sse'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { __resetRateLimitForTesting, __setPendingCancelTtlForTesting } from '../src/routes/ai.js'

setupTestEnv()

const { rpcOk } = createRpcHelpers(app)

// === fetch stubbing ===

const realFetch = globalThis.fetch

function restoreFetch() {
  globalThis.fetch = realFetch
}

/** Build one OpenAI-compatible SSE chunk line. */
function chunk(content?: string, reasoning?: string, spaced = true): string {
  const delta: Record<string, string> = {}
  if (content !== undefined) delta.content = content
  if (reasoning !== undefined) delta.reasoning_content = reasoning
  const prefix = spaced ? 'data: ' : 'data:'
  return `${prefix}${JSON.stringify({ choices: [{ delta }] })}\n\n`
}

/** A 200 SSE response assembled from raw chunk strings. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/**
 * A never-ending SSE stream that emits one chunk every `intervalMs`.
 * Cancellation tests need a stream that keeps the server's read loop waking
 * up — the loop only checks isCancelled() at the top of each iteration, so a
 * completely silent stream would deadlock the test.
 */
function intervalStream(build: (n: number) => string, intervalMs = 5): Response {
  const encoder = new TextEncoder()
  let n = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        n += 1
        controller.enqueue(encoder.encode(build(n)))
      }, intervalMs)
    },
    cancel() {
      if (timer) clearInterval(timer)
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** Collect the coeditor→client SSE events from a finished ai.chat response. */
async function readSseEvents(res: Response): Promise<Array<Record<string, string>>> {
  const text = await res.text()
  const events: Array<Record<string, string>> = []
  for (const line of text.split('\n')) {
    const parsed = parseSseLine(line)
    if (parsed.type !== 'data') continue
    const obj = parseSseJson<Record<string, string>>(parsed.payload)
    if (obj) events.push(obj)
  }
  return events
}

function chatParams(turnId: string) {
  return {
    docId: 'doc_ai_stream',
    convId,
    turnId,
    messages: [{ role: 'user', content: '你好' }],
  }
}

async function chatRequest(turnId: string): Promise<Response> {
  return app.request('/api/ai.chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chatParams(turnId)),
  })
}

async function createTurn(question: string): Promise<string> {
  const turn = await rpcOk<AiTurn>('turns.create', {
    docId: 'doc_ai_stream', convId, question,
  })
  return turn.id
}

async function getTurn(turnId: string): Promise<AiTurn> {
  return rpcOk<AiTurn>('turns.get', { docId: 'doc_ai_stream', convId, turnId })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// === Suite setup ===

let convId: string

beforeAll(async () => {
  await rpcOk('settings.update', { apiKey: 'test-key', apiBaseUrl: 'https://upstream.test/v1' })
  await rpcOk('documents.create', { id: 'doc_ai_stream', title: 'AI流式测试' })
  const conv = await rpcOk<{ id: string }>('conversations.create', {
    docId: 'doc_ai_stream', type: 'casual', parentId: 'doc_ai_stream',
  })
  convId = conv.id
})

// app.request funnels every test through the single 'local' rate-limit bucket.
beforeEach(() => {
  __resetRateLimitForTesting()
})

afterEach(() => {
  restoreFetch()
  __setPendingCancelTtlForTesting(10_000)
})

// ==================== T1: streaming pipeline ====================

describe('ai.chat streaming pipeline (T1)', () => {
  it('streams split chunks (incl. reasoning) and persists the merged answer', async () => {
    const turnId = await createTurn('正常流式')
    globalThis.fetch = (async () => sseResponse([
      'data: {"choices":[{"delt',
      'a":{"reasoning_content":"先想"}}]}\n\n',
      chunk('你好'),
      chunk('，世界'),
      'data: [DONE]\n\n',
    ])) as typeof fetch

    const res = await chatRequest(turnId)
    const events = await readSseEvents(res)

    expect(events).toEqual([
      { thinking: '先想' },
      { content: '你好' },
      { content: '，世界' },
    ])

    const turn = await getTurn(turnId)
    expect(turn.answers).toHaveLength(1)
    expect(turn.answers[0].content).toBe('你好，世界')
    expect(turn.answers[0].thinking).toBe('先想')
  })

  it('parses upstream `data:` lines without the space after the colon', async () => {
    const turnId = await createTurn('无空格data')
    globalThis.fetch = (async () => sseResponse([chunk('ns', undefined, false)])) as typeof fetch

    const res = await chatRequest(turnId)
    const events = await readSseEvents(res)

    expect(events).toEqual([{ content: 'ns' }])
    const turn = await getTurn(turnId)
    expect(turn.answers[0].content).toBe('ns')
  })

  it('ai.cancel mid-stream stops the stream and persists the partial answer', async () => {
    const turnId = await createTurn('中途取消')
    globalThis.fetch = (async () => intervalStream((n) => chunk(`part${n}-`))) as typeof fetch

    const res = await chatRequest(turnId)
    await sleep(50) // let a few chunks accumulate
    await rpcOk('ai.cancel', { docId: 'doc_ai_stream', convId, turnId })

    const events = await readSseEvents(res)
    const streamed = events.filter((e) => e.content).map((e) => e.content).join('')
    expect(streamed.startsWith('part1-')).toBe(true)

    const turn = await getTurn(turnId)
    expect(turn.answers).toHaveLength(1)
    expect(turn.answers[0].content.startsWith('part1-')).toBe(true)
  })

  it('upstream 401 surfaces a clear error and persists nothing', async () => {
    const turnId = await createTurn('401错误')
    globalThis.fetch = (async () => new Response('{"error":"unauthorized"}', {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

    const res = await chatRequest(turnId)
    const events = await readSseEvents(res)

    expect(events).toEqual([{ error: 'API Key 无效或已过期' }])
    const turn = await getTurn(turnId)
    expect(turn.answers).toHaveLength(0)
  })

  it('upstream 200 with a non-SSE body reports 上游未返回有效内容 and persists nothing (B26/B28)', async () => {
    const turnId = await createTurn('JSON错误体')
    globalThis.fetch = (async () => new Response('{"error":{"message":"bad request"}}', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

    const res = await chatRequest(turnId)
    const events = await readSseEvents(res)

    expect(events).toEqual([{ error: '上游未返回有效内容' }])
    const turn = await getTurn(turnId)
    expect(turn.answers).toHaveLength(0)
  })

  it('rate limiting kicks in after 20 requests per minute', async () => {
    for (let i = 0; i < 20; i++) {
      // Invalid bodies are fine — the rate check runs before schema parsing.
      const res = await app.request('/api/ai.chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(false)
    }
    const res = await app.request('/api/ai.chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const body = await res.json() as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('请求过于频繁')
  })
})

// ==================== F6: pendingCancel race ====================

describe('ai.cancel before the stream starts (F6 pendingCancel)', () => {
  it('a cancel with no active stream kills the next stream within the TTL', async () => {
    const turnId = await createTurn('先取消再请求')
    let fetchCalled = false
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true
      return realFetch(...args)
    }) as typeof fetch

    // No active stream for this turn — the cancel must be remembered.
    await rpcOk('ai.cancel', { docId: 'doc_ai_stream', convId, turnId })

    const res = await chatRequest(turnId)
    const events = await readSseEvents(res)

    expect(events).toEqual([])
    expect(fetchCalled).toBe(false) // upstream never called, no tokens spent
    const turn = await getTurn(turnId)
    expect(turn.answers).toHaveLength(0)
  })

  it('a stale pendingCancel expires and does not affect later streams', async () => {
    __setPendingCancelTtlForTesting(30)
    const turnId = await createTurn('过期取消')
    await rpcOk('ai.cancel', { docId: 'doc_ai_stream', convId, turnId })
    await sleep(60) // let the pending cancel expire

    globalThis.fetch = (async () => sseResponse([chunk('正常运行')])) as typeof fetch

    const res = await chatRequest(turnId)
    const events = await readSseEvents(res)

    expect(events).toEqual([{ content: '正常运行' }])
    const turn = await getTurn(turnId)
    expect(turn.answers[0].content).toBe('正常运行')
  })
})
