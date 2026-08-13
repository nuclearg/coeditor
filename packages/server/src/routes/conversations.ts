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
  }),
  async (input) => {
    return repo.conversations.list(USER_ID, input.docId, input.parentId, input.type)
  },
))

app.post('/api/conversations.create', defineRpc(
  z.object({
    docId: safeId,
    type: conversationTypeSchema,
    parentId: safeId,
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
      createdAt: new Date().toISOString(),
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
