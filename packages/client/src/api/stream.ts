import Taro from '@tarojs/taro'
import { isH5 } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { buildHeaders } from './client'

// === SSE streaming helper — dual-platform ===

export interface StreamCallbacks {
  onThinking: (text: string) => void
  onContent: (text: string) => void
  onError: (error: string) => void
}

interface StreamParams {
  docId: string
  convId: string
  turnId: string
  answerId?: string
  messages: Array<{ role: string; content: string }>
  reviewType?: string
  /** 审阅维度（plot/character/...），后端注入维度指令 */
  reviewFocus?: string
  contentContext?: string
}

/**
 * Line-based SSE parser shared by both platforms.
 * Returns false when the stream should stop (error / [DONE]).
 */
function handleSseLine(line: string, state: { content: string; thinking: string }, callbacks: StreamCallbacks): boolean {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('data: ')) return true
  const data = trimmed.slice(6)
  if (data === '[DONE]') return false
  try {
    const parsed = JSON.parse(data)
    if (parsed.error) {
      callbacks.onError(parsed.error)
      return false
    }
    if (parsed.thinking) {
      state.thinking += parsed.thinking
      callbacks.onThinking(state.thinking)
    }
    if (parsed.content) {
      state.content += parsed.content
      callbacks.onContent(state.content)
    }
  } catch {
    // skip invalid JSON lines
  }
  return true
}

/** H5: fetch + ReadableStream. */
async function streamH5(
  params: StreamParams,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<{ content: string; thinking: string }> {
  const headers = await buildHeaders()
  const res = await fetch(`${API_BASE_URL}/api/ai.chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    signal,
  })

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const result = await res.json()
    if (!result.success) {
      callbacks.onError(result.error || t('error.requestFailed'))
    }
    return { content: '', thinking: '' }
  }

  if (!res.ok) {
    callbacks.onError(`${t('error.requestFailed')} (${res.status})`)
    return { content: '', thinking: '' }
  }

  const reader = res.body?.getReader()
  if (!reader) {
    callbacks.onError(t('error.readStream'))
    return { content: '', thinking: '' }
  }

  const decoder = new TextDecoder()
  const state = { content: '', thinking: '' }
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!handleSseLine(line, state, callbacks)) {
        await reader.cancel().catch(() => {})
        return { content: state.content, thinking: state.thinking }
      }
    }
  }

  return { content: state.content, thinking: state.thinking }
}

/** WeChat Mini Program: wx.request with enableChunked. */
async function streamWeapp(
  params: StreamParams,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<{ content: string; thinking: string }> {
  const headers = await buildHeaders()
  return new Promise((resolve) => {
    const state = { content: '', thinking: '' }
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false
    let userAborted = false
    // Set when WE terminate the request (e.g. after a server error event).
    // task.abort() then triggers the fail callback, which must not report a
    // second error on top of the one handleSseLine already emitted.
    let terminated = false
    // eslint-disable-next-line prefer-const
    let task: { abort: () => void }

    const finish = (content: string, thinking: string) => {
      if (finished) return
      finished = true
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve({ content, thinking })
    }

    const onAbort = () => {
      userAborted = true
      task.abort()
      finish(state.content, state.thinking)
    }

    task = Taro.request({
      url: `${API_BASE_URL}/api/ai.chat`,
      method: 'POST',
      data: params,
      header: headers,
      enableChunked: true,
      success: (res: { data: unknown; statusCode?: number }) => {
        // 非 200 状态码（限流/500 等）
        if (res.statusCode && res.statusCode !== 200) {
          callbacks.onError(`${t('error.requestFailed')} (${res.statusCode})`)
          finish(state.content, state.thinking)
          return
        }
        // Non-streaming JSON error responses (rate limit, validation, no API key)
        if (res.data && typeof res.data === 'object' && !ArrayBuffer.isView(res.data)) {
          const body = res.data as { success?: boolean; error?: string }
          if (body.success === false) callbacks.onError(body.error || t('error.requestFailed'))
        }
        finish(state.content, state.thinking)
      },
      fail: (err: { errMsg?: string }) => {
        // User-initiated abort (stop button) and self-termination (server error
        // event already reported via onError) are not new errors — no banner.
        if (!userAborted && !terminated) {
          callbacks.onError(err.errMsg || t('error.network'))
        }
        finish(state.content, state.thinking)
      },
      onChunkReceived: (chunkRes: { data: ArrayBuffer }) => {
        const text = decoder.decode(new Uint8Array(chunkRes.data), { stream: true })
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!handleSseLine(line, state, callbacks)) {
            terminated = true
            task.abort()
            finish(state.content, state.thinking)
            return
          }
        }
      },
    } as unknown as Taro.request.Option<never> & {
      enableChunked: boolean
      onChunkReceived: (res: { data: ArrayBuffer }) => void
    })

    if (signal) {
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }
  })
}

export function streamAiResponse(
  params: StreamParams,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<{ content: string; thinking: string }> {
  if (isH5()) {
    return streamH5(params, callbacks, signal)
  }
  return streamWeapp(params, callbacks, signal)
}
