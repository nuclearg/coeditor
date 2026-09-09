import type { AppSettings } from '@coeditor/shared'

/**
 * 非流式 AI 完整响应（documents.import 分章用）：BYOK 调用 OpenAI 兼容 /chat/completions。
 * 与 ai.chat 错误文案对齐（401/403→Key 无效、404→地址或模型不存在、网络→连接失败）。
 * 连接超时 30s；body 读取不受限（信任上游）。不传 thinking 参数（BYOK 兼容性优先）。
 */
export async function aiComplete(settings: AppSettings, systemContent: string, userContent: string): Promise<string> {
  const upstreamBody = {
    model: settings.model,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    stream: false,
  }
  const controller = new AbortController()
  const connectTimer = setTimeout(() => controller.abort(), 30_000)
  let response: Response
  try {
    response = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    })
  } catch (err: unknown) {
    clearTimeout(connectTimer)
    const msg = controller.signal.aborted
      ? '连接 API 服务器超时'
      : `无法连接到 API 服务器: ${err instanceof Error ? err.message : String(err)}`
    throw new Error(msg)
  }
  clearTimeout(connectTimer)

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    const msg = response.status === 401 || response.status === 403
      ? 'API Key 无效或已过期'
      : response.status === 404
        ? 'API 地址或模型不存在'
        : `API 返回错误 (${response.status}): ${errText.slice(0, 200)}`
    throw new Error(msg)
  }

  const data = await response.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('上游未返回有效内容')
  }
  return content
}
