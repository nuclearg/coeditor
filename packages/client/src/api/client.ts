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
 * Notify plugins of a parsed RPC response. If any plugin handles it (returns
 * true or an object), the framework considers the response "handled" (e.g.
 * plugin redirected to login). `retry` is true when a plugin asks the caller
 * to retry the request once (e.g. a silent token refresh just rotated the
 * token — the original request's data must be re-fetched with the fresh token).
 */
export async function notifyResponse(resp: RpcResponse): Promise<{ handled: boolean; retry: boolean }> {
  let retry = false
  for (const plugin of getPlugins()) {
    if (plugin.request?.onResponse) {
      const out = await plugin.request.onResponse(resp)
      if (out && typeof out === 'object') {
        return { handled: true, retry: !!out.retry }
      }
      if (out === true) return { handled: true, retry }
    }
  }
  return { handled: false, retry }
}

/**
 * RPC Client for CoEditor API — cross-platform (H5 / WeChat Mini Program).
 * All API calls use POST with JSON body.
 * Responses are always { success: true, data } or { success: false, error }.
 *
 * API_BASE_URL is injected at build time (empty = same-origin /api/*).
 */
async function rpc<T>(action: string, params: object = {}, retried = false): Promise<T> {
  const headers = await buildHeaders()

  // 网络不通/超时/请求被拒：前端兜底文案（业务文案一律由后端给出）
  let res: Taro.request.SuccessCallbackResult<ApiResponse<T>>
  try {
    res = await Taro.request<ApiResponse<T>>({
      url: `${API_BASE_URL}/api/${action}`,
      method: 'POST',
      data: params,
      header: headers,
      timeout: 30_000,
      // 跨域携带 cookie（H5/Tauri WebView 生效；SaaS 版 token 认证走 httpOnly cookie 时必需。
      // 开源版本地无后端登录，此设置无副作用；weapp 端忽略）
      credentials: 'include',
    })
  } catch {
    throw new Error(t('error.network'))
  }

  // HTTP 非 200：优先读 body 里的后端文案（404/5xx 也可能带 Result 包络），没有再兜底
  if (res.statusCode !== 200) {
    const body = res.data as { error?: string } | undefined
    throw new Error((body && typeof body.error === 'string' && body.error) || t('error.server'))
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
  const { handled, retry } = await notifyResponse(rpcResp)
  if (handled) {
    if (retry && !retried) {
      // 插件静默续期成功（token 已轮换）：用新 token 重试一次原请求，
      // 否则首次加载时过期 token 401 续期后，原请求的数据（如文档列表）会静默丢失。
      return rpc(action, params, true)
    }
    // 插件已处理（如跳转登录），抛错中断调用链但不弹 toast
    const err = new Error('__plugin_handled__')
    err.name = 'PluginHandled'
    throw err
  }

  if (!result.success) {
    // 业务文案一律由后端给出；空 error 视为后端契约异常，走服务器异常兜底
    throw new Error((result as ApiError).error || t('error.server'))
  }
  return result.data
}

export const api = { rpc }
