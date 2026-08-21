/**
 * 桌面壳（Tauri）适配。
 *
 * 仅当运行在 Tauri WebView 内（window.__TAURI_INTERNALS__ 存在）时激活：
 * - window.open 外链（http/https 绝对地址）→ 系统浏览器打开（tauri-plugin-opener）
 * - window.open 相对路径（应用内路由）→ 当前窗口导航（Tauri WebView 默认不支持多窗口）
 *
 * Web 端 / 小程序端不加载任何桌面代码：检测不通过即返回，动态 import 的
 * @tauri-apps/plugin-opener 也不会被打进 Web 产物（webpack 单独 chunk，永不加载）。
 */

/** 是否运行在 Tauri 桌面壳内（非 H5 环境恒为 false） */
export async function isDesktopRuntime(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
}

export async function initDesktopAdapters(): Promise<void> {
  if (!(await isDesktopRuntime())) return

  const { openUrl } = await import('@tauri-apps/plugin-opener')

  // 覆盖 window.open：外链走系统浏览器，相对路径应用内导航
  window.open = ((url?: string | URL, target?: string, features?: string): Window | null => {
    if (!url) return null
    const raw = String(url)
    if (/^https?:\/\//i.test(raw)) {
      openUrl(raw).catch((err) => console.error('[desktop] openUrl failed', err))
      return null
    }
    window.location.assign(raw)
    return null
  }) as typeof window.open
}

/**
 * 弹出系统「选择文件夹」对话框（仅 Tauri 桌面壳可用）。
 * 非桌面环境返回 null（调用方隐藏入口即可）。
 */
export async function pickDataDirectory(): Promise<string | null> {
  if (!(await isDesktopRuntime())) return null
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({
      directory: true,
      multiple: false,
      title: '选择数据保存目录',
    })
    return typeof dir === 'string' && dir.trim() !== '' ? dir : null
  } catch (err) {
    console.error('[desktop] pickDataDirectory failed', err)
    return null
  }
}
