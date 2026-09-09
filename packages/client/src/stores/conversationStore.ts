import { create } from 'zustand'
import type { AiConversation, AiTurn, ConversationType } from '@coeditor/shared'
import { api } from '@/api/client'

// In-flight load requests — concurrent callers await the same promise.
const loadingConvs = new Map<string, Promise<void>>()
const loadingTurns = new Map<string, Promise<void>>()
// Conversations deleted this session. Guards against an in-flight loadTurns
// resolving AFTER deletion and resurrecting the deleted conv's turns.
const deletedConvs = new Set<string>()

interface ConversationStore {
  docId: string | null
  conversations: Record<string, AiConversation[]>
  turns: Record<string, AiTurn[]>
  loadConversations: (docId: string, parentId: string, type: ConversationType, draftId?: string) => Promise<void>
  createConversation: (docId: string, type: ConversationType, parentId: string, draftId?: string, chapterId?: string) => Promise<AiConversation>
  deleteConversation: (docId: string, parentId: string, convId: string, draftId?: string) => Promise<void>
  loadTurns: (docId: string, convId: string) => Promise<void>
  createTurn: (docId: string, convId: string, question: string, answer?: string, questionVisible?: boolean) => Promise<AiTurn>
  selectAnswer: (docId: string, turnId: string, answerIndex: number) => Promise<void>
}

/**
 * Look up the convId for a given turnId from the local store state.
 * Returns undefined if not found (server will fallback to scan).
 */
function findConvIdForTurn(turnId: string): string | undefined {
  const state = useConversationStore.getState()
  for (const [convId, turnList] of Object.entries(state.turns)) {
    if (turnList.some((t) => t.id === turnId)) return convId
  }
  return undefined
}

/** Re-fetch a turn after a mutation and replace it in place. */
async function refreshTurn(docId: string, turnId: string): Promise<void> {
  const convId = findConvIdForTurn(turnId)
  const turn = await api.rpc<AiTurn>('turns.get', { docId, turnId, convId })
  useConversationStore.setState((s) => {
    if (s.docId !== docId) return {}
    const cId = turn.conversationId
    // Only update if the conversation's turns are still present (don't create a
    // partial single-entry list for a conv that was cleared/never loaded).
    if (!s.turns[cId]) return {}
    return {
      turns: {
        ...s.turns,
        [cId]: s.turns[cId].map((t) => (t.id === turnId ? turn : t)),
      },
    }
  })
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  docId: null,
  conversations: {},
  turns: {},

  loadConversations: async (docId, parentId, type, draftId) => {
    // draft:conversation 1:N——段落/附件会话按草稿版本分桶；无草稿场景用实体 id
    const bucket = draftId || parentId
    const key = `${docId}:${bucket}:${type}`
    const existing = loadingConvs.get(key)
    if (existing) return existing
    if (get().docId !== docId) {
      set({ docId, conversations: {}, turns: {} })
      deletedConvs.clear()
    }
    const promise = (async () => {
      try {
        const convs = await api.rpc<AiConversation[]>('conversations.list', { docId, parentId, type, draftId })
        set((s) => {
          if (s.docId !== docId) return {}
          const existingList = s.conversations[bucket] || []
          const serverIds = new Set(convs.map((c) => c.id))
          // conversations created locally while the request was in-flight should
          // survive, but ONLY if they match the current type (otherwise they
          // belong to a stale parentType and must be dropped).
          const serverType = convs[0]?.type || type
          const localOnly = existingList.filter(
            (c) => !serverIds.has(c.id) && c.type === serverType,
          )
          return { conversations: { ...s.conversations, [bucket]: [...convs, ...localOnly] } }
        })
      } catch (err) {
        console.error('[loadConversations]', err)
        throw err
      } finally {
        loadingConvs.delete(key)
      }
    })()
    loadingConvs.set(key, promise)
    return promise
  },

  createConversation: async (docId, type, parentId, draftId, chapterId) => {
    const conv = await api.rpc<AiConversation>('conversations.create', { docId, type, parentId, draftId, chapterId })
    const bucket = draftId || parentId
    set((s) => (s.docId === docId ? {
      conversations: {
        ...s.conversations,
        [bucket]: [conv, ...(s.conversations[bucket] || [])],
      },
    } : {}))
    return conv
  },

  deleteConversation: async (docId, parentId, convId, draftId) => {
    await api.rpc('conversations.delete', { docId, convId })
    deletedConvs.add(convId)
    const bucket = draftId || parentId
    set((s) => {
      if (s.docId !== docId) return {}
      const newTurns = { ...s.turns }
      delete newTurns[convId]
      return {
        conversations: {
          ...s.conversations,
          [bucket]: (s.conversations[bucket] || []).filter((c) => c.id !== convId),
        },
        turns: newTurns,
      }
    })
  },

  loadTurns: async (docId, convId) => {
    const key = `${docId}:${convId}`
    const existing = loadingTurns.get(key)
    if (existing) return existing
    // Don't reset store here — loadConversations already handles doc switches.
    // Resetting in loadTurns would let a stale finally (old doc's request
    // completing after a switch) wipe the new document's conversations/turns.
    if (get().docId !== docId) return Promise.resolve()
    const promise = (async () => {
      try {
        const t = await api.rpc<AiTurn[]>('turns.list', { docId, convId })
        set((s) => (s.docId === docId && !deletedConvs.has(convId)
          ? { turns: { ...s.turns, [convId]: t } }
          : {}))
      } catch (err) {
        console.error('[loadTurns]', err)
        throw err
      } finally {
        loadingTurns.delete(key)
      }
    })()
    loadingTurns.set(key, promise)
    return promise
  },

  createTurn: async (docId, convId, question, answer, questionVisible) => {
    const turn = await api.rpc<AiTurn>('turns.create', {
      docId,
      convId,
      question: question || '',
      answer,
      questionVisible,
    })
    set((s) => (s.docId === docId ? {
      turns: { ...s.turns, [convId]: [...(s.turns[convId] || []), turn] },
    } : {}))
    return turn
  },

  selectAnswer: async (docId, turnId, answerIndex) => {
    const convId = findConvIdForTurn(turnId)
    await api.rpc('turns.selectAnswer', { docId, turnId, convId, answerIndex })
    await refreshTurn(docId, turnId)
  },
}))
