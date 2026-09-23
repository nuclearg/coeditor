import { create } from 'zustand'
import type { ParagraphDraft } from '@coeditor/shared'
import { api } from '@/api/client'
import { useParagraphStore } from './paragraphStore'

// In-flight load requests — concurrent callers await the same promise.
const loadingDrafts = new Map<string, Promise<void>>()

/**
 * 版本 tab 默认只取这么多条，超出的折叠成「…」（点开后拉全部）。
 *
 * 为什么值得限制：侧边栏为了显示每个段落的字数，会为**每个段落**拉一次版本列表 ——
 * 一个 100 段的稿子就是 100 次请求，每次返回该段落全部版本（含 content 正文）。
 * 限制到最近几条后，这个批量加载的成本与"历史版本有多长"解耦。
 *
 * 多取一条（+1）是为了判断"还有没有更多"：返回条数 > DRAFT_TAB_LIMIT 即说明服务端被截断过。
 * 响应体保持**数组**不变（对外契约不动，小程序旧版本客户端不会因为字段变化而挂）。
 *
 * 另外：服务端在分页第一页会**把当前草稿追加到末尾**（当它不在最新 N 条里时）。
 * 这条注入项必须从"还有更多"的判断里剔除，否则它会被当成"第 N+1 条"而误判；
 * 也不能让它挤掉一个 tab 位置——它是"当前版本"，属于必须可见的那一条。
 */
export const DRAFT_TAB_LIMIT = 5

/**
 * 从服务端返回的一页里切出"要展示的版本 + 是否还有更多"。
 *
 * 服务端约定（见 DocumentManager.appendCurrentIfMissing）：第一页返回**最新 limit 条**，
 * 若当前草稿不在其中，再把它**追加在末尾**（因此当前草稿要么落在前 limit 条里，要么一定是最后一条）。
 */
export function splitPage<T extends { id: string }>(rows: T[], limit: number, currentDraftId: string) {
  const idx = currentDraftId ? rows.findIndex((d) => d.id === currentDraftId) : -1
  const injected = idx >= limit // 落在"最新 limit 条"之外 = 服务端追加的那条
  const newest = injected ? rows.slice(0, rows.length - 1) : rows
  const hasMore = newest.length > limit
  const visible = hasMore ? newest.slice(0, limit) : newest
  // 当前版本始终保留（编辑器正文/侧边栏字数都按它取），排在末尾
  return { drafts: injected ? [...visible, rows[rows.length - 1]] : visible, hasMore }
}

interface ParagraphDraftStore {
  docId: string | null
  draftsByParagraph: Record<string, ParagraphDraft[]>
  /** 该段落的版本列表是否被截断过（tab 栏据此显示「…」） */
  hasMoreByParagraph: Record<string, boolean>
  loadDrafts: (docId: string, chapterId: string, paragraphId: string) => Promise<void>
  /** 展开该段落的全部版本（点「…」时调用）：一次拉全量并替换列表 */
  expandDrafts: (docId: string, chapterId: string, paragraphId: string) => Promise<void>
  createDraft: (docId: string, chapterId: string, paragraphId: string, content: string) => Promise<ParagraphDraft>
  deleteDraft: (docId: string, chapterId: string, paragraphId: string, draftId: string) => Promise<void>
}

export const useParagraphDraftStore = create<ParagraphDraftStore>((set, get) => ({
  docId: null,
  draftsByParagraph: {},
  hasMoreByParagraph: {},

  loadDrafts: async (docId, chapterId, paragraphId) => {
    const key = `${docId}:${chapterId}:${paragraphId}`
    const existing = loadingDrafts.get(key)
    if (existing) return existing
    // Reset state when switching documents to avoid stale data from another doc
    if (get().docId !== docId) {
      set({ docId, draftsByParagraph: {}, hasMoreByParagraph: {} })
    }
    const promise = (async () => {
      try {
        const rows = await api.rpc<ParagraphDraft[]>('paragraphDrafts.list', {
          docId, chapterId, paragraphId, limit: DRAFT_TAB_LIMIT + 1,
        })
        // 当前草稿 id 取自段落 store（服务端会把它追加在这一页末尾，见 splitPage 的说明）
        const paras = useParagraphStore.getState().paragraphsByChapter[chapterId] || []
        const currentDraftId = paras.find((p) => p.id === paragraphId)?.currentDraftId || ''
        const { drafts, hasMore } = splitPage(rows, DRAFT_TAB_LIMIT, currentDraftId)
        set((s) => (s.docId === docId ? {
          draftsByParagraph: { ...s.draftsByParagraph, [paragraphId]: drafts },
          hasMoreByParagraph: { ...s.hasMoreByParagraph, [paragraphId]: hasMore },
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

  expandDrafts: async (docId, chapterId, paragraphId) => {
    // 不带 limit = 服务端的旧行为（返回全部版本）。这是**用户主动点「…」**触发的，
    // 一次性拉全是刻意的取舍：点了"展开全部"就该看到全部，而不是再点 N 次。
    const drafts = await api.rpc<ParagraphDraft[]>('paragraphDrafts.list', { docId, chapterId, paragraphId })
    set((s) => (s.docId === docId ? {
      draftsByParagraph: { ...s.draftsByParagraph, [paragraphId]: drafts },
      hasMoreByParagraph: { ...s.hasMoreByParagraph, [paragraphId]: false },
    } : {}))
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
