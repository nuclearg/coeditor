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

/**
 * 内联样式里的「设计尺寸」：H5/桌面输出物理 px，小程序输出 rpx（750 设计稿，1 设计 px = 2rpx）。
 *
 * 为什么必须有这个函数：Taro 的 pxtransform **只作用于样式文件**，内联 style 原样落到
 * WXSS 上——写数字（如 `fontSize: 20`）在小程序里就是 **20 物理像素**，不会被换算成 rpx。
 * 于是 `isWebView() ? 12 : 20` 这种"两端各给一个值"的写法，在小程序上得到的是 20px 物理
 * 像素，比正文（.text-sm = 26rpx ≈ 13px）还大，与 H5 的 12px 明显不一致。
 *
 * 统一走本函数：`designPx(12)` → H5 `12px` / 小程序 `24rpx`，两端视觉一致且随屏宽缩放。
 * 注意：应用在**需要与两端一致的尺寸**上；纯粹的平台差异（如触摸目标更大）应显式写明理由。
 */
export function designPx(px: number): string {
  return isWebView() ? `${px}px` : `${px * 2}rpx`
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
