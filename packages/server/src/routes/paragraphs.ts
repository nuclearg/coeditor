import { Hono } from 'hono'
import { z } from 'zod/v4'
import type { Paragraph } from '@coeditor/shared'
import { generateId } from '@coeditor/shared'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/paragraphs.list', defineRpc(
  z.object({ docId: safeId, chapterId: safeId }),
  async (input) => {
    return repo.paragraphs.list(USER_ID, input.docId, input.chapterId)
  },
))

app.post('/api/paragraphs.create', defineRpc(
  z.object({
    docId: safeId,
    chapterId: safeId,
    name: z.string().max(200).optional(),
  }),
  async (input) => {
    const para: Paragraph = {
      id: generateId(),
      chapterId: input.chapterId,
      name: input.name || '',
      currentDraftId: null,
    }
    return repo.paragraphs.create(USER_ID, input.docId, input.chapterId, para)
  },
))

app.post('/api/paragraphs.get', defineRpc(
  z.object({ docId: safeId, chapterId: safeId, paragraphId: safeId }),
  async (input) => {
    const para = await repo.paragraphs.get(USER_ID, input.docId, input.chapterId, input.paragraphId)
    if (!para) throw new Error('段落不存在')
    return para
  },
))

app.post('/api/paragraphs.update', defineRpc(
  z.object({
    docId: safeId,
    chapterId: safeId,
    paragraphId: safeId,
    name: z.string().max(200).optional(),
    currentDraftId: safeId.optional(),
  }),
  async (input) => {
    return repo.paragraphs.update(USER_ID, input.docId, input.chapterId, input.paragraphId, {
      name: input.name,
      currentDraftId: input.currentDraftId,
    })
  },
))

app.post('/api/paragraphs.delete', defineRpc(
  z.object({ docId: safeId, chapterId: safeId, paragraphId: safeId }),
  async (input) => {
    await repo.paragraphs.delete(USER_ID, input.docId, input.chapterId, input.paragraphId)
    return null
  },
))

app.post('/api/paragraphs.reorder', defineRpc(
  z.object({
    docId: safeId,
    chapterId: safeId,
    paragraphOrder: z.array(safeId),
  }),
  async (input) => {
    await repo.paragraphs.reorder(USER_ID, input.docId, input.chapterId, input.paragraphOrder)
    return null
  },
))

export default app
