export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** Count characters, excluding whitespace — the conventional "字数" measure. */
export function charCount(text: string): number {
  return text.replace(/\s/g, '').length
}

/**
 * 是否运行在**非小程序的 WebView 构建**里。
 *
 * 它不是"H5 浏览器"的意思：Taro 只有 h5 / weapp 两个构建目标，而桌面壳（Tauri）
 * 加载的**也是 dist-h5**（见 desktop/src-tauri/tauri.conf.json 的 frontendDist），
 * 所以「浏览器 / 手机浏览器 / macOS 桌面版」三者都为 true。
 *
 * - 判断「是不是 PC / 宽屏」→ 用 useIsMobile()（视口媒体查询）
 * - 判断「是不是桌面壳」→ 用 isDesktop()（lib/desktop.ts，探 __TAURI_INTERNALS__）
 * - 判断「有没有 DOM」→ 用本函数（小程序端无 DOM）
 */
export function isWebView(): boolean {
  return process.env.TARO_ENV === 'h5'
}

/** 格式化时间戳为 yyyy-MM-dd HH:mm（draft tab / AI 会话 tab 标题） */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Resolve the "current" draft of a draft list: the one pointed to by
 * currentDraftId, falling back to the newest (first) draft. Returns
 * undefined for an empty list.
 */
export function getCurrentDraft<T extends { id: string }>(
  drafts: T[],
  currentDraftId: string | null | undefined,
): T | undefined {
  return drafts.find((d) => d.id === currentDraftId) || drafts[0]
}
