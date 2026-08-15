import Taro from '@tarojs/taro'
import { t } from '@/lib/i18n'
import { getPlugins } from '@/plugin'
import type { RpcResponse } from '@/plugin/types'

interface ApiSuccess<T> {
  success: true
  data: T
}

interface ApiError {
  success: false
  error: string
}

type ApiResponse<T> = ApiSuccess<T> | ApiError

/**
 * Build request headers: base Content-Type + any extra headers injected by
 * plugins (e.g. Authorization for SaaS JWT auth).
 */
export async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  for (const plugin of getPlugins()) {
    if (plugin.request?.getHeaders) {
      const extra = await plugin.request.getHeaders()
      Object.assign(headers, extra)
    }
  }
  return headers
}

/**
 * Notify plugins of a parsed RPC response. If any plugin returns true the
 * framework considers the response "handled" (e.g. plugin redirected to login).
 */
export async function notifyResponse(resp: RpcResponse): Promise<boolean> {
  for (const plugin of getPlugins()) {
    if (plugin.request?.onResponse) {
      const handled = await plugin.request.onResponse(resp)
      if (handled) return true
    }
  }
  return false
}

/**
 * RPC Client for CoEditor API — cross-platform (H5 / WeChat Mini Program).
 * All API calls use POST with JSON body.
 * Responses are always { success: true, data } or { success: false, error }.
 *
 * API_BASE_URL is injected at build time (empty = same-origin /api/*).
 */
async function rpc<T>(action: string, params: object = {}): Promise<T> {
  const headers = await buildHeaders()
  const res = await Taro.request<ApiResponse<T>>({
    url: `${API_BASE_URL}/api/${action}`,
    method: 'POST',
    data: params,
    header: headers,
    timeout: 30_000,
  })

  // HTTP 非 200：直接报错（SaaS server 的 401/403 等）
  if (res.statusCode !== 200) {
    throw new Error(t('error.server'))
  }

  const result = res.data
  if (!result) {
    throw new Error(t('error.server'))
  }

  // 将解析结果（只读）送给插件 onResponse
  const rpcResp: RpcResponse = {
    success: result.success,
    data: result.success ? result.data : undefined,
    error: result.success ? undefined : (result as ApiError).error,
    action,
  }
  const handled = await notifyResponse(rpcResp)
  if (handled) {
    // 插件已处理（如跳转登录），抛错中断调用链但不弹 toast
    const err = new Error('__plugin_handled__')
    err.name = 'PluginHandled'
    throw err
  }

  if (!result.success) {
    throw new Error((result as ApiError).error || t('error.requestFailed'))
  }
  return result.data
}

export const api = { rpc }
