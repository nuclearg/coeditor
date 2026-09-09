import { create } from 'zustand'
import type { ParagraphDraft } from '@coeditor/shared'
import { api } from '@/api/client'
import { useParagraphStore } from './paragraphStore'

// In-flight load requests — concurrent callers await the same promise.
const loadingDrafts = new Map<string, Promise<void>>()

interface ParagraphDraftStore {
  docId: string | null
  draftsByParagraph: Record<string, ParagraphDraft[]>
  loadDrafts: (docId: string, chapterId: string, paragraphId: string) => Promise<void>
  createDraft: (docId: string, chapterId: string, paragraphId: string, content: string) => Promise<ParagraphDraft>
  deleteDraft: (docId: string, chapterId: string, paragraphId: string, draftId: string) => Promise<void>
}

export const useParagraphDraftStore = create<ParagraphDraftStore>((set, get) => ({
  docId: null,
  draftsByParagraph: {},

  loadDrafts: async (docId, chapterId, paragraphId) => {
    const key = `${docId}:${chapterId}:${paragraphId}`
    const existing = loadingDrafts.get(key)
    if (existing) return existing
    // Reset state when switching documents to avoid stale data from another doc
    if (get().docId !== docId) {
      set({ docId, draftsByParagraph: {} })
    }
    const promise = (async () => {
      try {
        const drafts = await api.rpc<ParagraphDraft[]>('paragraphDrafts.list', { docId, chapterId, paragraphId })
        set((s) => (s.docId === docId ? {
          draftsByParagraph: { ...s.draftsByParagraph, [paragraphId]: drafts },
        } : {}))
      } catch (err) {
        console.error('[loadDrafts]', err)
        throw err
      } finally {
        loadingDrafts.delete(key)
      }
    })()
    loadingDrafts.set(key, promise)
    return promise
  },

  createDraft: async (docId, chapterId, paragraphId, content) => {
    const draft = await api.rpc<ParagraphDraft>('paragraphDrafts.create', { docId, chapterId, paragraphId, content })
    set((s) => (s.docId === docId ? {
      draftsByParagraph: {
        ...s.draftsByParagraph,
        [paragraphId]: [draft, ...(s.draftsByParagraph[paragraphId] || [])],
      },
    } : {}))
    // Mirror the server-side currentDraftId update in paragraph state.
    useParagraphStore.getState().applyDraftId(docId, chapterId, paragraphId, draft.id)
    return draft
  },

  deleteDraft: async (docId, chapterId, paragraphId, draftId) => {
    await api.rpc('paragraphDrafts.delete', { docId, chapterId, paragraphId, draftId })
    const remaining = (get().draftsByParagraph[paragraphId] || []).filter((d) => d.id !== draftId)
    set((s) => (s.docId === docId ? {
      draftsByParagraph: {
        ...s.draftsByParagraph,
        [paragraphId]: remaining,
      },
    } : {}))
    // Mirror the server-side currentDraftId switch: deleting the current draft
    // falls back to the latest remaining one (same order as the server).
    const paras = useParagraphStore.getState().paragraphsByChapter[chapterId] || []
    const para = paras.find((p) => p.id === paragraphId)
    if (para && para.currentDraftId === draftId) {
      useParagraphStore.getState().applyDraftId(docId, chapterId, paragraphId, remaining[0]?.id || '')
    }
  },
}))
