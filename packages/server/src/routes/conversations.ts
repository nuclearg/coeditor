import { Hono } from 'hono'
import { z } from 'zod/v4'
import type { AiConversation } from '@coeditor/shared'
import { generateId, CONVERSATION_TYPES } from '@coeditor/shared'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

const conversationTypeSchema = z.enum(CONVERSATION_TYPES)

app.post('/api/conversations.list', defineRpc(
  z.object({
    docId: safeId,
    parentId: safeId,
    type: conversationTypeSchema,
    // 草稿版本归属（段落/附件场景）：传了按 draftId 过滤，否则按 parentId（实体）
    draftId: safeId.optional(),
  }),
  async (input) => {
    return repo.conversations.list(USER_ID, input.docId, input.parentId, input.type, input.draftId)
  },
))

app.post('/api/conversations.create', defineRpc(
  z.object({
    docId: safeId,
    type: conversationTypeSchema,
    parentId: safeId,
    // 草稿版本 id（段落/附件场景）：每个 draftVersion 独立会话（1:N）
    draftId: safeId.optional(),
    // 章节 id（段落审阅场景）：段落会话必须携带，供上下文加载当前章节/段落
    chapterId: safeId.optional(),
  }),
  async (input) => {
    // Parent document must exist — otherwise we write an orphan conversation
    // tree that no documents-scoped list can ever surface.
    const doc = await repo.documents.get(USER_ID, input.docId)
    if (!doc) throw new Error('文档不存在')

    const convId = generateId()
    const conv: AiConversation = {
      id: convId,
      type: input.type,
      // Always set documentId for document-level queries
      documentId: input.docId,
      ...(input.type === 'attachment_review' ? { attachmentId: input.parentId } : {}),
      ...(input.type === 'paragraph_review' ? { paragraphId: input.parentId } : {}),
      ...(input.type === 'chapter_review' ? { chapterId: input.parentId } : {}),
      // 段落审阅：显式携带章节归属（chapter_review 时 chapterId=parentId 已覆盖）
      ...(input.type === 'paragraph_review' && input.chapterId ? { chapterId: input.chapterId } : {}),
      ...(input.draftId ? { draftId: input.draftId } : {}),
      timeCreated: new Date().toISOString(),
    }
    return repo.conversations.create(USER_ID, input.docId, conv)
  },
))

app.post('/api/conversations.get', defineRpc(
  z.object({ docId: safeId, convId: safeId }),
  async (input) => {
    const conv = await repo.conversations.get(USER_ID, input.docId, input.convId)
    if (!conv) throw new Error('会话不存在')
    return conv
  },
))

app.post('/api/conversations.delete', defineRpc(
  z.object({ docId: safeId, convId: safeId }),
  async (input) => {
    await repo.conversations.delete(USER_ID, input.docId, input.convId)
    return null
  },
))

export default app
