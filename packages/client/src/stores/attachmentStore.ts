import { create } from 'zustand'
import { DRAFT_TAB_LIMIT, splitPage } from './paragraphDraftStore'
import type { Attachment, AttachmentDraft, DocumentTemplate } from '@coeditor/shared'
import { api } from '@/api/client'

// In-flight ensure requests per docId:type — concurrent callers await the same promise.
const ensuring = new Map<string, Promise<Attachment>>()
// In-flight loadDrafts requests — concurrent callers await the same promise.
const loadingAttDrafts = new Map<string, Promise<void>>()

interface AttachmentStore {
  docId: string | null
  templates: DocumentTemplate[]
  attachments: Record<string, Attachment>
  draftsByAttachment: Record<string, AttachmentDraft[]>
  loadTemplates: () => Promise<void>
  loadAttachments: (docId: string) => Promise<void>
  ensureAttachment: (docId: string, type: string) => Promise<Attachment>
  loadDrafts: (docId: string, type: string) => Promise<void>
  /** 该附件的版本列表是否被截断过（tab 栏据此显示「…」） */
  hasMoreByAttachment: Record<string, boolean>
  /** 展开该附件的全部版本（点「…」时调用） */
  expandDrafts: (docId: string, type: string) => Promise<void>
  createDraft: (docId: string, type: string, content: string) => Promise<AttachmentDraft>
  switchDraft: (docId: string, type: string, draftId: string) => Promise<void>
  deleteDraft: (docId: string, type: string, draftId: string) => Promise<void>
}

export const useAttachmentStore = create<AttachmentStore>((set, get) => ({
  docId: null,
  templates: [],
  attachments: {},
  draftsByAttachment: {},
  hasMoreByAttachment: {},

  loadTemplates: async () => {
    if (get().templates.length > 0) return
    try {
      const templates = await api.rpc<DocumentTemplate[]>('templates.list')
      set({ templates })
    } catch (err) {
      // 插件已处理（如登录门拦截 401）：静默，不打印噪音
      if ((err as Error)?.name === 'PluginHandled') return
      console.error('[loadTemplates]', err)
      throw err
    }
  },

  loadAttachments: async (docId) => {
    if (get().docId !== docId) {
      set({ docId, attachments: {}, draftsByAttachment: {}, hasMoreByAttachment: {} })
    }
    try {
      const atts = await api.rpc<Attachment[]>('attachments.list', { docId })
      set((s) => {
        if (s.docId !== docId) return {}
        const attachments: Record<string, Attachment> = {}
        for (const a of atts) attachments[a.type] = a
        return { attachments }
      })
    } catch (err) {
      console.error('[loadAttachments]', err)
      throw err
    }
  },

  ensureAttachment: async (docId, type) => {
    const existing = get().attachments[type]
    if (existing) return existing
    const key = `${docId}:${type}`
    const inflight = ensuring.get(key)
    if (inflight) return inflight
    const promise = (async () => {
      const att = await api.rpc<Attachment>('attachments.ensure', { docId, type })
      set((s) => (s.docId === docId ? { attachments: { ...s.attachments, [type]: att } } : {}))
      return att
    })()
    ensuring.set(key, promise)
    try {
      return await promise
    } finally {
      ensuring.delete(key)
    }
  },

  loadDrafts: async (docId, type) => {
    const key = `${docId}:${type}`
    const existing = loadingAttDrafts.get(key)
    if (existing) return existing
    if (get().docId !== docId) {
      set({ docId, attachments: {}, draftsByAttachment: {}, hasMoreByAttachment: {} })
    }
    const promise = (async () => {
      try {
        // 与段落草稿同款：默认只取最近 DRAFT_TAB_LIMIT 条（多取一条判断"还有更多"），
        // 并识别服务端追加在末尾的"当前草稿"
        const rows = await api.rpc<AttachmentDraft[]>('attachmentDrafts.list', {
          docId, type, limit: DRAFT_TAB_LIMIT + 1,
        })
        const currentDraftId = get().attachments[type]?.currentDraftId || ''
        const { drafts, hasMore } = splitPage(rows, DRAFT_TAB_LIMIT, currentDraftId)
        set((s) => (s.docId === docId ? {
          draftsByAttachment: { ...s.draftsByAttachment, [type]: drafts },
          hasMoreByAttachment: { ...s.hasMoreByAttachment, [type]: hasMore },
        } : {}))
      } catch (err) {
        console.error('[loadDrafts]', err)
        throw err
      } finally {
        loadingAttDrafts.delete(key)
      }
    })()
    loadingAttDrafts.set(key, promise)
    return promise
  },

  expandDrafts: async (docId, type) => {
    // 不带 limit = 返回全部版本（用户主动点「…」触发）
    const drafts = await api.rpc<AttachmentDraft[]>('attachmentDrafts.list', { docId, type })
    set((s) => (s.docId === docId ? {
      draftsByAttachment: { ...s.draftsByAttachment, [type]: drafts },
      hasMoreByAttachment: { ...s.hasMoreByAttachment, [type]: false },
    } : {}))
  },

  createDraft: async (docId, type, content) => {
    const draft = await api.rpc<AttachmentDraft>('attachmentDrafts.create', { docId, type, content })
    set((s) => (s.docId === docId ? {
      draftsByAttachment: {
        ...s.draftsByAttachment,
        [type]: [draft, ...(s.draftsByAttachment[type] || [])],
      },
      // Mirror server-side currentDraftId update
      attachments: s.attachments[type]
        ? { ...s.attachments, [type]: { ...s.attachments[type], currentDraftId: draft.id } }
        : s.attachments,
    } : {}))
    return draft
  },

  switchDraft: async (docId, type, draftId) => {
    await api.rpc('attachments.update', { docId, type, currentDraftId: draftId })
    set((s) => (s.docId === docId && s.attachments[type]
      ? { attachments: { ...s.attachments, [type]: { ...s.attachments[type], currentDraftId: draftId } } }
      : {}))
  },

  deleteDraft: async (docId, type, draftId) => {
    await api.rpc('attachmentDrafts.delete', { docId, type, draftId })
    set((s) => {
      if (s.docId !== docId) return {}
      const remaining = (s.draftsByAttachment[type] || []).filter((d) => d.id !== draftId)
      const att = s.attachments[type]
      const wasCurrent = att?.currentDraftId === draftId
      return {
        draftsByAttachment: { ...s.draftsByAttachment, [type]: remaining },
        // Mirror the server-side currentDraftId switch to the latest remaining draft.
        attachments: att && wasCurrent
          ? { ...s.attachments, [type]: { ...att, currentDraftId: remaining[0]?.id || '' } }
          : s.attachments,
      }
    })
  },
}))