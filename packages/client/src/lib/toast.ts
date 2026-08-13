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
