import { Hono } from 'hono'

/**
 * opencode zen 模型目录代理（设置页“AI 接口配置”数据源）。
 *
 * 模型列表由 opencode.ai/zen/v1/models 在线提供；这里在服务端做一次带缓存的
 * 转发，原因：
 *  - 浏览器直连会被 opencode.ai 的 CORS 拦截（H5），桌面壳 CSP connect-src 'self'
 *    更不允许跨域请求，只能由同源 /api 代理；
 *  - 加 6 小时内存缓存，避免每次打开设置页都打到上游。
 * 失败时返回 502 + error 文案，前端可退化为“自定义模型 ID”手填。
 */

const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

let cache: { at: number; ids: string[] } | undefined

const app = new Hono()

app.get('/api/models', async (c) => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return c.json({ success: true, data: { models: cache.ids } })
  }
  try {
    const res = await fetch(ZEN_MODELS_URL, {
      headers: { accept: 'application/json', 'user-agent': 'coeditor/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`zen upstream HTTP ${res.status}`)
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> }
    const ids = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) throw new Error('zen upstream returned empty model list')
    cache = { at: Date.now(), ids }
    return c.json({ success: true, data: { models: ids } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    console.warn('[zen models] fetch failed:', msg)
    return c.json({ success: false, error: '模型列表加载失败，请稍后重试' }, 502)
  }
})

export default app
