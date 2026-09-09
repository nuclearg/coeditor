import { create } from 'zustand'
import type { Paragraph } from '@coeditor/shared'
import { api } from '@/api/client'

interface ParagraphStore {
  docId: string | null
  paragraphsByChapter: Record<string, Paragraph[]>
  loadParagraphs: (docId: string, chapterId: string) => Promise<void>
  createParagraph: (docId: string, chapterId: string, name?: string) => Promise<Paragraph>
  deleteParagraph: (docId: string, chapterId: string, paragraphId: string) => Promise<void>
  updateParagraphDraftId: (docId: string, chapterId: string, paragraphId: string, draftId: string) => Promise<void>
  applyDraftId: (docId: string, chapterId: string, paragraphId: string, draftId: string) => void
  updateParagraphName: (docId: string, chapterId: string, paragraphId: string, name: string) => Promise<void>
  reorderParagraphs: (docId: string, chapterId: string, paragraphOrder: string[]) => Promise<void>
}

// Track in-flight chapter loads to prevent concurrent duplicates.
// Stores the actual promise so concurrent callers await the SAME load
// instead of bailing out early (which would break loaders that depend
// on paragraphsByChapter being populated after `await loadParagraphs`).
const loadingChapters = new Map<string, Promise<void>>()

export const useParagraphStore = create<ParagraphStore>((set, get) => ({
  docId: null,
  paragraphsByChapter: {},

  loadParagraphs: async (docId, chapterId) => {
    const key = `${docId}:${chapterId}`
    const existing = loadingChapters.get(key)
    if (existing) return existing

    // Reset state when switching documents to avoid stale data from another doc
    if (get().docId !== docId) {
      set({ docId, paragraphsByChapter: {} })
    }

    const promise = (async () => {
      try {
        const paragraphs = await api.rpc<Paragraph[]>('paragraphs.list', { docId, chapterId })
        set((s) => (s.docId === docId
          ? { paragraphsByChapter: { ...s.paragraphsByChapter, [chapterId]: paragraphs } }
          : {}))
      } catch (err) {
        console.error('[loadParagraphs]', err)
        throw err
      } finally {
        loadingChapters.delete(key)
      }
    })()

    loadingChapters.set(key, promise)
    return promise
  },

  createParagraph: async (docId, chapterId, name) => {
    const para = await api.rpc<Paragraph>('paragraphs.create', { docId, chapterId, name: name || '' })
    set((s) => (s.docId === docId ? {
      paragraphsByChapter: {
        ...s.paragraphsByChapter,
        [chapterId]: [...(s.paragraphsByChapter[chapterId] || []), para],
      },
    } : {}))
    return para
  },

  deleteParagraph: async (docId, chapterId, paragraphId) => {
    await api.rpc('paragraphs.delete', { docId, chapterId, paragraphId })
    set((s) => (s.docId === docId ? {
      paragraphsByChapter: {
        ...s.paragraphsByChapter,
        [chapterId]: (s.paragraphsByChapter[chapterId] || []).filter((p) => p.id !== paragraphId),
      },
    } : {}))
  },

  updateParagraphDraftId: async (docId, chapterId, paragraphId, draftId) => {
    await api.rpc('paragraphs.update', { docId, chapterId, paragraphId, currentDraftId: draftId })
    get().applyDraftId(docId, chapterId, paragraphId, draftId)
  },

  // Local mirror of the server-side currentDraftId change (no RPC). Used by the
  // draft store after create/delete draft, where the server already persisted it.
  applyDraftId: (docId, chapterId, paragraphId, draftId) => {
    set((s) => (s.docId === docId ? {
      paragraphsByChapter: {
        ...s.paragraphsByChapter,
        [chapterId]: (s.paragraphsByChapter[chapterId] || []).map((p) =>
          p.id === paragraphId ? { ...p, currentDraftId: draftId } : p
        ),
      },
    } : {}))
  },

  updateParagraphName: async (docId, chapterId, paragraphId, name) => {
    await api.rpc('paragraphs.update', { docId, chapterId, paragraphId, name })
    set((s) => (s.docId === docId ? {
      paragraphsByChapter: {
        ...s.paragraphsByChapter,
        [chapterId]: (s.paragraphsByChapter[chapterId] || []).map((p) =>
          p.id === paragraphId ? { ...p, name } : p
        ),
      },
    } : {}))
  },

  reorderParagraphs: async (docId, chapterId, paragraphOrder) => {
    await api.rpc('paragraphs.reorder', { docId, chapterId, paragraphOrder })
    set((s) => {
      if (s.docId !== docId) return {}
      const ordered = paragraphOrder
        .map((id) => (s.paragraphsByChapter[chapterId] || []).find((p) => p.id === id))
        .filter(Boolean) as Paragraph[]
      return {
        paragraphsByChapter: {
          ...s.paragraphsByChapter,
          [chapterId]: ordered,
        },
      }
    })
  },
}))
