import { create } from 'zustand'
import { api } from '@/api/client'
import type { AppSettings } from '@coeditor/shared'

// Monotonic sequence for setStyle — only the latest request may write back.
let setStyleSeq = 0

interface SettingsStore {
  style: string
  showThinking: boolean
  loaded: boolean
  loadStyle: () => Promise<void>
  setStyle: (style: string) => Promise<void>
  setShowThinking: (v: boolean) => Promise<void>
  applyStyle: (style: string) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  style: 'gentle',
  showThinking: true,
  loaded: false,
  loadStyle: async () => {
    if (get().loaded) return
    try {
      const settings = await api.rpc<AppSettings>('settings.get')
      set({ style: settings.style, showThinking: settings.showThinking !== false, loaded: true })
    } catch (err) {
      // 插件已处理（如登录门拦截 401）：静默，不打印噪音
      if ((err as Error)?.name === 'PluginHandled') return
      console.error('[settingsStore] loadStyle failed', err)
    }
  },
  setStyle: async (style) => {
    const seq = ++setStyleSeq
    const prev = get().style
    set({ style, loaded: true })
    try {
      const updated = await api.rpc<AppSettings>('settings.update', { style })
      if (seq === setStyleSeq) set({ style: updated.style })
    } catch (err) {
      console.error('[settingsStore] setStyle failed', err)
      // Only the latest request may roll back; a stale failure must not clobber
      // a newer optimistic value that already landed.
      if (seq === setStyleSeq) set({ style: prev })
    }
  },

  // Local sync only (no RPC) — used by the settings page after it saves the
  // full settings, so the review-style radio in SettingsMenu stays consistent.
  setShowThinking: async (v) => {
    const prev = get().showThinking
    set({ showThinking: v, loaded: true })
    try {
      const updated = await api.rpc<AppSettings>('settings.update', { showThinking: v })
      set({ showThinking: updated.showThinking !== false })
    } catch (err) {
      console.error('[settingsStore] setShowThinking failed', err)
      set({ showThinking: prev })
    }
  },

  applyStyle: (style) => set({ style }),
}))