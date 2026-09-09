import { create } from 'zustand'
import { getStorage, setStorage } from '@/lib/storage'

export type Language = 'zh' | 'en'

interface I18nStore {
  language: Language
  setLanguage: (lang: Language) => void
}

function getInitialLanguage(): Language {
  const stored = getStorage('coeditor-lang')
  if (stored === 'zh' || stored === 'en') return stored
  if (process.env.TARO_ENV === 'h5' && typeof navigator !== 'undefined') {
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
  return 'zh'
}

export const useI18nStore = create<I18nStore>((set) => ({
  language: getInitialLanguage(),
  setLanguage: (language) => {
    setStorage('coeditor-lang', language)
    set({ language })
  },
}))
