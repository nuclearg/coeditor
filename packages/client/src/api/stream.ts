import Taro from '@tarojs/taro'
import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { isH5 } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { buildHeaders, notifyResponse } from './client'

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
}

/**
 * Shared SSE event dispatch for both platforms. SSE 语法解析（data: 有无空格的差异、
 * 跨 chunk 的粘包/半包、\r\n 等）已由 eventsource-parser 处理，这里只关心业务载荷。
 * Returns false when the stream should stop (error / [DONE]).
 */
function dispatchEvent(event: EventSourceMessage, state: { content: string; thinking: string }, callbacks: StreamCallbacks): boolean {
  const data = event.data.trim()
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
    // 非 JSON 的 data（心跳/注释等）直接跳过，不断流
  }
  return true
}

/** H5: fetch + ReadableStream. */
async function streamH5(
  params: StreamParams,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  retried = false,
): Promise<{ content: string; thinking: string }> {
  const headers = await buildHeaders()
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/ai.chat`, {
      method: 'POST',
      credentials: 'include',   // 跨域携带 cookie（SaaS 版 token 认证走 httpOnly cookie 时必需；开源版无副作用）
      headers,
      body: JSON.stringify(params),
      signal,
    })
  } catch {
    // 网络不通/超时/连接被拒：前端兜底（业务文案由后端 SSE 事件给出）
    callbacks.onError(t('error.network'))
    return { content: '', thinking: '' }
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const result = await res.json() as { success?: boolean; error?: string }
    if (result.success === false) {
      const { handled, retry } = await notifyResponse({ success: false, error: result.error, action: 'ai.chat' })
      if (handled) {
        // 插件静默续期成功：用新 token 重试一次流（否则过期 token 会静默丢掉这次提问）
        if (retry && !retried) return streamH5(params, callbacks, signal, true)
        return { content: '', thinking: '' }
      }
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
  let stopped = false
  const parser = createParser({
    onEvent: (event) => {
      if (stopped) return
      if (!dispatchEvent(event, state, callbacks)) stopped = true
    },
  })

  while (!stopped) {
    const { done, value } = await reader.read()
    if (done) break
    parser.feed(decoder.decode(value, { stream: true }))
  }

  if (stopped) {
    await reader.cancel().catch(() => {})
  }
  return { content: state.content, thinking: state.thinking }
}

/** WeChat Mini Program: wx.request with enableChunked. */
async function streamWeapp(
  params: StreamParams,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  retried = false,
): Promise<{ content: string; thinking: string }> {
  const headers = await buildHeaders()
  return new Promise((resolve) => {
    const state = { content: '', thinking: '' }
    const decoder = new TextDecoder()
    let stopped = false
    let finished = false
    let userAborted = false
    // Set when WE terminate the request (e.g. after a server error event).
    // task.abort() then triggers the fail callback, which must not report a
    // second error on top of the one dispatchEvent already emitted.
    let terminated = false
    // eslint-disable-next-line prefer-const
    let task: { abort: () => void }
    const parser = createParser({
      onEvent: (event) => {
        if (stopped) return
        if (!dispatchEvent(event, state, callbacks)) stopped = true
      },
    })

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
      success: async (res: { data: unknown; statusCode?: number }) => {
        // 非 200 状态码（限流/500 等）
        if (res.statusCode && res.statusCode !== 200) {
          callbacks.onError(`${t('error.requestFailed')} (${res.statusCode})`)
          finish(state.content, state.thinking)
          return
        }
        // Non-streaming JSON error responses (rate limit, validation, no API key)
        if (res.data && typeof res.data === 'object' && !ArrayBuffer.isView(res.data)) {
          const body = res.data as { success?: boolean; error?: string }
          if (body.success === false) {
            const { handled, retry } = await notifyResponse({ success: false, error: body.error, action: 'ai.chat' })
            if (handled) {
              // 插件静默续期成功：用新 token 重试一次流（否则过期 token 会静默丢掉这次提问）
              if (retry && !retried) {
                const r = await streamWeapp(params, callbacks, signal, true)
                finish(r.content, r.thinking)
                return
              }
              finish(state.content, state.thinking)
              return
            }
            callbacks.onError(body.error || t('error.requestFailed'))
          }
        }
        finish(state.content, state.thinking)
      },
      fail: (err: { errMsg?: string }) => {
        // User-initiated abort (stop button) and self-termination (server error
        // event already reported via onError) are not new errors — no banner.
        if (!userAborted && !terminated) {
          // 网络不通/超时：前端兜底文案（业务文案由后端 SSE 事件给出）
          callbacks.onError(t('error.network'))
        }
        finish(state.content, state.thinking)
      },
      onChunkReceived: (chunkRes: { data: ArrayBuffer }) => {
        if (stopped) return
        const text = decoder.decode(new Uint8Array(chunkRes.data), { stream: true })
        parser.feed(text)
        if (stopped) {
          terminated = true
          task.abort()
          finish(state.content, state.thinking)
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
