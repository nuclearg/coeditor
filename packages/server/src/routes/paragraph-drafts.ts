import { Hono } from 'hono'
import { z } from 'zod/v4'
import { generateId } from '@coeditor/shared'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/paragraphDrafts.list', defineRpc(
  z.object({ docId: safeId, chapterId: safeId, paragraphId: safeId }),
  async (input) => {
    return repo.drafts.listParagraphDrafts(USER_ID, input.docId, input.chapterId, input.paragraphId)
  },
))

app.post('/api/paragraphDrafts.create', defineRpc(
  z.object({
    docId: safeId,
    chapterId: safeId,
    paragraphId: safeId,
    content: z.string().max(100000),
  }),
  async (input) => {
    const draftId = generateId()
    return repo.drafts.createParagraphDraft(
      USER_ID, input.docId, input.chapterId, input.paragraphId, draftId, input.content,
    )
  },
))

app.post('/api/paragraphDrafts.get', defineRpc(
  z.object({ docId: safeId, chapterId: safeId, paragraphId: safeId, draftId: safeId }),
  async (input) => {
    const draft = await repo.drafts.getParagraphDraft(USER_ID, input.docId, input.chapterId, input.paragraphId, input.draftId)
    if (!draft) throw new Error('草稿不存在')
    return draft
  },
))

app.post('/api/paragraphDrafts.delete', defineRpc(
  z.object({ docId: safeId, chapterId: safeId, paragraphId: safeId, draftId: safeId }),
  async (input) => {
    await repo.drafts.deleteParagraphDraft(USER_ID, input.docId, input.chapterId, input.paragraphId, input.draftId)
    return null
  },
))

export default app
