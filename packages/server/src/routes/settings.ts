import { Hono } from 'hono'
import { z } from 'zod/v4'
import { REVIEW_STYLES } from '@coeditor/shared'
import { defineRpc } from '../lib/rpc.js'
import { USER_ID, maskApiKey } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/settings.get', defineRpc(
  z.object({}),
  async () => {
    const settings = await repo.settings.get(USER_ID)
    return { ...settings, apiKey: maskApiKey(settings.apiKey) }
  },
))

/**
 * True iff the value matches a mask shape that settings.get actually emits:
 * '****' (keys ≤ 4 chars) or `<asterisks>` + last 4 chars (longer keys).
 * Exact-shape matching (instead of includes('*')) means a REAL key that
 * happens to contain '*' is saved normally.
 */
function isMaskedEcho(value: string): boolean {
  return value === '****' || /^\*+.{4}$/.test(value)
}

app.post('/api/settings.update', defineRpc(
  z.object({
    apiKey: z.string().max(512).optional(),
    apiBaseUrl: z.string().url().max(2048).optional(),
    model: z.string().max(200).optional(),
    style: z.enum(REVIEW_STYLES).optional(),
  }),
  async (input) => {
    // Drop masked round-trips of the key (settings.get output sent back
    // verbatim) — but an empty string is a legitimate "clear the key" and
    // real keys containing '*' must be preserved.
    let apiKey = input.apiKey
    if (apiKey !== undefined && apiKey !== '' && isMaskedEcho(apiKey)) apiKey = undefined
    const sanitized = { ...input, apiKey }
    const updated = await repo.settings.update(USER_ID, sanitized)
    return { ...updated, apiKey: maskApiKey(updated.apiKey) }
  },
))

export default app
