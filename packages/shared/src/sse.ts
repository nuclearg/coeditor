/**
 * SSE protocol constants + line parsing helpers shared by server and client.
 *
 * Pure functions, no platform dependencies (no node:* / DOM imports) — this
 * module must stay importable from both the Node server and the Taro client.
 *
 * Two directions of the protocol:
 * - upstream (OpenAI-compatible) → coeditor server: `data: <json>` lines
 *   terminated by `[DONE]`.
 * - coeditor server → client: `data: <json>` events whose payload is one of
 *   `{ content }` / `{ thinking }` / `{ error }`.
 */

/** Sentinel the OpenAI-compatible upstream sends as its final SSE data line. */
export const SSE_DONE = '[DONE]'

/** Payload keys of coeditor → client SSE events. */
export const SSE_EVENT = {
  /** 正文增量 */
  content: 'content',
  /** 推理过程增量 */
  thinking: 'thinking',
  /** 终止错误 */
  error: 'error',
} as const

export type SseEventKey = (typeof SSE_EVENT)[keyof typeof SSE_EVENT]

/** Result of parsing a single SSE line. */
export type SseLine =
  /** Empty line or non-`data:` line — skip. */
  | { type: 'skip' }
  /** `data: [DONE]` — upstream finished. */
  | { type: 'done' }
  /** `data: <payload>` — payload still needs JSON.parse. */
  | { type: 'data'; payload: string }

/**
 * Parse one raw SSE line.
 *
 * Accepts both `data: x` (with space) and `data:x` (without) — some upstream
 * providers omit the space, and the previous space-only match silently
 * dropped whole responses.
 */
export function parseSseLine(line: string): SseLine {
  const trimmed = line.trim()
  if (!trimmed) return { type: 'skip' }
  const match = trimmed.match(/^data:\s?/)
  if (!match) return { type: 'skip' }
  const payload = trimmed.slice(match[0].length)
  if (payload === SSE_DONE) return { type: 'done' }
  return { type: 'data', payload }
}

/**
 * Safe JSON.parse for an SSE data payload: returns null on malformed JSON
 * instead of throwing (malformed upstream chunks are skipped, not fatal).
 */
export function parseSseJson<T = unknown>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T
  } catch {
    return null
  }
}
