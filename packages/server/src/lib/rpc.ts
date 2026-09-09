import type { Context } from 'hono'
import { z } from 'zod/v4'

/**
 * RPC framework for CoEditor.
 *
 * All API endpoints:
 * - Accept POST with JSON body
 * - Return 200 with { success: true, data } or { success: false, error }
 * - Validate input with Zod schemas
 * - Catch all errors and return as { success: false, error }
 */

export type RpcHandler<TInput, TOutput> = (input: TInput, c: Context) => Promise<TOutput>

export function defineRpc<TInput, TOutput>(
  schema: z.ZodType<TInput>,
  handler: RpcHandler<TInput, TOutput>,
) {
  return async (c: Context) => {
    // Distinguish "no body" from "broken JSON": an empty body is a valid
    // no-arg call (=> {}), but a non-empty body that is not valid JSON must
    // be rejected explicitly — coercing it to {} produced fake successes on
    // all-optional schemas (e.g. settings.update).
    const text = await c.req.text().catch(() => '')
    let raw: unknown
    if (text.trim() === '') {
      raw = {}
    } else {
      try {
        raw = JSON.parse(text)
      } catch {
        return c.json({ success: false, error: '请求体不是合法 JSON' })
      }
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return c.json({ success: false, error: `${path}${issue.message}` })
    }
    try {
      const data = await handler(parsed.data as TInput, c)
      return c.json({ success: true, data })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '服务器内部错误'
      console.error('[RPC Error]', msg, err)
      return c.json({ success: false, error: msg })
    }
  }
}

/**
 * Zod refinement for safe IDs (no path traversal characters).
 * Bare '.' and '..' are rejected explicitly: path.join(parent, '.') collapses
 * to the parent directory, which would let delete endpoints wipe entire
 * collection directories. The 128-char cap rejects oversized ids at the
 * validation layer instead of surfacing raw ENAMETOOLONG errors.
 */
export const safeId = z.string().min(1).max(128).refine(
  (val) => val !== '.' && val !== '..' && !/[/\\]|\.\./.test(val),
  { message: 'ID 包含非法字符' },
)

/**
 * Turn IDs live in the same directory as conversation.json, so the literal
 * 'conversation' is reserved and must never be accepted as a turnId.
 */
export const safeTurnId = safeId.refine(
  (val) => val !== 'conversation',
  { message: 'ID 包含非法字符' },
)
