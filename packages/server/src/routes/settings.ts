import { Hono } from 'hono'
import path from 'node:path'
import { z } from 'zod/v4'
import { REVIEW_STYLES } from '@coeditor/shared'
import { defineRpc } from '../lib/rpc.js'
import { USER_ID, maskApiKey } from '../lib/utils.js'
import { repo } from '../store/index.js'
import { DATA_ROOT } from '../store/file-paths.js'

const app = new Hono()

app.post('/api/settings.get', defineRpc(
  z.object({}),
  async () => {
    const settings = await repo.settings.get(USER_ID)
    return { ...settings, apiKey: maskApiKey(settings.apiKey), dataDir: DATA_ROOT }
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
    // 数据保存目录：开源版核心设置。绝对路径，运行时立即切换并持久化。
    dataDir: z.string().trim().min(1).max(4096).optional(),
  }),
  async (input) => {
    // Drop masked round-trips of the key (settings.get output sent back
    // verbatim) — but an empty string is a legitimate "clear the key" and
    // real keys containing '*' must be preserved.
    let apiKey = input.apiKey
    if (apiKey !== undefined && apiKey !== '' && isMaskedEcho(apiKey)) apiKey = undefined

    // 切换数据根目录（迁移种子 + 持久化偏好；立即生效）
    if (input.dataDir !== undefined) {
      if (!path.isAbsolute(input.dataDir)) {
        throw new Error('数据目录必须是绝对路径')
      }
      await repo.switchDataDir(input.dataDir)
    }

    const sanitized = { ...input, apiKey }
    const updated = await repo.settings.update(USER_ID, sanitized)
    return { ...updated, apiKey: maskApiKey(updated.apiKey), dataDir: DATA_ROOT }
  },
))

export default app
