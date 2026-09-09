import { create } from 'zustand'
import { getStorage, setStorage } from '@/lib/storage'

type Theme = 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

function getInitialTheme(): Theme {
  const stored = getStorage('theme')
  if (stored === 'dark' || stored === 'light') return stored
  // H5 端跟随系统
  if (process.env.TARO_ENV === 'h5' && typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

// 主题 class 由 app.tsx 在根 View 上驱动（.app.dark），跨端一致，
// 因此这里只负责状态与持久化，不做 DOM 操作。
const initialTheme = getInitialTheme()

export const useTheme = create<ThemeStore>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    setStorage('theme', theme)
    set({ theme })
  },
}))
