import { create } from 'zustand'
import type { Chapter } from '@coeditor/shared'
import { api } from '@/api/client'

interface ChapterStore {
  docId: string | null
  chapters: Chapter[]
  loadChapters: (docId: string) => Promise<void>
  createChapter: (docId: string, title: string) => Promise<Chapter>
  updateChapter: (docId: string, chapterId: string, data: { title?: string }) => Promise<void>
  deleteChapter: (docId: string, chapterId: string) => Promise<void>
  reorderChapters: (docId: string, chapterOrder: string[]) => Promise<void>
}

// Track in-flight loads per docId. Concurrent callers await the SAME promise
// so `await loadChapters(docId)` always resolves with data in the store.
const loadingDocs = new Map<string, Promise<void>>()

export const useChapterStore = create<ChapterStore>((set, get) => ({
  docId: null,
  chapters: [],

  loadChapters: async (docId) => {
    const existing = loadingDocs.get(docId)
    if (existing) return existing

    // Reset state when switching documents to avoid stale data from another doc
    if (get().docId !== docId) {
      set({ docId, chapters: [] })
    }

    const promise = (async () => {
      try {
        const chapters = await api.rpc<Chapter[]>('chapters.list', { docId })
        if (get().docId === docId) set({ chapters })
      } catch (err) {
        console.error('[loadChapters]', err)
        throw err
      } finally {
        loadingDocs.delete(docId)
      }
    })()

    loadingDocs.set(docId, promise)
    return promise
  },

  createChapter: async (docId, title) => {
    const chapter = await api.rpc<Chapter>('chapters.create', { docId, title })
    set((s) => (s.docId === docId ? { chapters: [...s.chapters, chapter] } : {}))
    return chapter
  },

  updateChapter: async (docId, chapterId, data) => {
    const chapter = await api.rpc<Chapter>('chapters.update', { docId, chapterId, ...data })
    set((s) => (s.docId === docId ? {
      chapters: s.chapters.map((c) => (c.id === chapterId ? chapter : c)),
    } : {}))
  },

  deleteChapter: async (docId, chapterId) => {
    await api.rpc('chapters.delete', { docId, chapterId })
    set((s) => (s.docId === docId ? { chapters: s.chapters.filter((c) => c.id !== chapterId) } : {}))
  },

  reorderChapters: async (docId, chapterOrder) => {
    await api.rpc('documents.reorderChapters', { docId, chapterOrder })
    set((s) => {
      if (s.docId !== docId) return {}
      const ordered = chapterOrder
        .map((id) => s.chapters.find((c) => c.id === id))
        .filter(Boolean) as Chapter[]
      return { chapters: ordered }
    })
  },
}))
