import { create } from 'zustand'
import { api } from '@/api/client'
import type { AppSettings } from '@coeditor/shared'

// Monotonic sequence for setStyle — only the latest request may write back.
let setStyleSeq = 0

interface SettingsStore {
  style: string
  loaded: boolean
  loadStyle: () => Promise<void>
  setStyle: (style: string) => Promise<void>
  applyStyle: (style: string) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  style: 'gentle',
  loaded: false,
  loadStyle: async () => {
    if (get().loaded) return
    try {
      const settings = await api.rpc<AppSettings>('settings.get')
      set({ style: settings.style, loaded: true })
    } catch (err) {
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

  // Local sync only (no RPC) — used by the api-config dialog after it saves the
  // full settings, so the review-style radio in SettingsMenu stays consistent.
  applyStyle: (style) => set({ style }),
}))
