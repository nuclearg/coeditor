import Taro from '@tarojs/taro'

/**
 * User-visible error feedback that works on both H5 and weapp.
 * Used for failures that have no dedicated UI surface (save failures,
 * boot failures, auto-submit failures).
 */
export function showErrorToast(message: string): void {
  try {
    const p = Taro.showToast({ title: message, icon: 'none', duration: 3000 })
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      ;(p as Promise<unknown>).catch(() => {})
    }
  } catch {
    // Toast is best-effort — never let feedback itself break the flow.
  }
}

/** 中性提示（非错误），如"已恢复未保存内容"。 */
export function showToast(message: string): void {
  try {
    const p = Taro.showToast({ title: message, icon: 'none', duration: 2000 })
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      ;(p as Promise<unknown>).catch(() => {})
    }
  } catch {
    // best-effort
  }
}
