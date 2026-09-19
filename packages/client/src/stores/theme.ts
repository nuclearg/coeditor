import Taro from '@tarojs/taro'
import { create } from 'zustand'
import { getStorage, setStorage } from '@/lib/storage'

type Theme = 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const STORAGE_KEY = 'theme'

/**
 * 用户手动选择过的主题；没选过返回 null（= 跟随系统）。
 *
 * **小程序端恒返回 null**（即永远跟随系统）：小程序主体的配色走
 * `prefers-color-scheme` 媒体查询（见 app.scss 的 `page` 规则），它只能跟随系统，
 * 无法响应手动选择。若这里仍让手动值生效，导航栏（读本 store）会与主体
 * （读媒体查询）不一致——两害相权，统一以系统为准。
 */
function manualTheme(): Theme | null {
  if (process.env.TARO_ENV !== 'h5') return null
  const stored = getStorage(STORAGE_KEY)
  return stored === 'dark' || stored === 'light' ? stored : null
}

/**
 * 宿主环境的系统主题。
 * - H5：`prefers-color-scheme`
 * - 小程序：`wx.getAppBaseInfo().theme`——**前提是 app.json 开了 darkmode**
 *   （见 app.config.ts），否则该字段恒为空；低版本基础库还没有这个字段，
 *   两条路都取不到时退化为 light
 */
function systemTheme(): Theme {
  if (process.env.TARO_ENV === 'h5') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }
  try {
    const info = Taro.getAppBaseInfo?.() ?? Taro.getSystemInfoSync?.()
    return (info as { theme?: string } | undefined)?.theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// 主题 class 由 app.tsx 在根 View 上驱动（.app.dark），跨端一致，
// 因此这里只负责状态与持久化，不做 DOM 操作。
export const useTheme = create<ThemeStore>((set) => ({
  theme: manualTheme() ?? systemTheme(),
  setTheme: (theme) => {
    setStorage(STORAGE_KEY, theme)
    set({ theme })
  },
}))

/**
 * 订阅系统主题变化：**仅在用户没手动选过时**才跟随（选过就以用户为准，
 * 与「设置里的主题 radio」语义一致——它是覆盖项，不是初始值）。
 * 返回取消订阅函数；app.tsx 启动时调用一次。
 */
export function subscribeSystemTheme(): () => void {
  const apply = (next: Theme): void => {
    if (manualTheme() !== null) return
    useTheme.setState({ theme: next })
  }

  if (process.env.TARO_ENV === 'h5') {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => apply(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }

  const handler = (res: { theme: string }): void => apply(res.theme === 'dark' ? 'dark' : 'light')
  Taro.onThemeChange?.(handler)
  return () => Taro.offThemeChange?.(handler)
}
