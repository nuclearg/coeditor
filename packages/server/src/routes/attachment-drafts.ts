import { Hono } from 'hono'
import { z } from 'zod/v4'
import { generateId } from '@coeditor/shared'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID, resolveAttachmentName } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/attachmentDrafts.list', defineRpc(
  z.object({ docId: safeId, type: safeId }),
  async (input) => {
    return repo.drafts.listAttachmentDrafts(USER_ID, input.docId, input.type)
  },
))

app.post('/api/attachmentDrafts.create', defineRpc(
  z.object({
    docId: safeId,
    type: safeId,
    content: z.string().max(200000),
  }),
  async (input) => {
    // Ensure the attachment exists first. Resolve the display name from the
    // template exactly like attachments.ensure — passing the raw type key
    // here would freeze it as the attachment name permanently.
    let name = input.type
    const doc = await repo.documents.get(USER_ID, input.docId)
    if (doc?.templateId) {
      const template = await repo.templates.get(doc.templateId)
      name = resolveAttachmentName(template, input.type, name)
    }
    await repo.attachments.ensure(USER_ID, input.docId, input.type, name)
    const draftId = generateId()
    return repo.drafts.createAttachmentDraft(USER_ID, input.docId, input.type, draftId, input.content)
  },
))

app.post('/api/attachmentDrafts.get', defineRpc(
  z.object({ docId: safeId, type: safeId, draftId: safeId }),
  async (input) => {
    const draft = await repo.drafts.getAttachmentDraft(USER_ID, input.docId, input.type, input.draftId)
    if (!draft) throw new Error('草稿不存在')
    return draft
  },
))

app.post('/api/attachmentDrafts.delete', defineRpc(
  z.object({ docId: safeId, type: safeId, draftId: safeId }),
  async (input) => {
    await repo.drafts.deleteAttachmentDraft(USER_ID, input.docId, input.type, input.draftId)
    return null
  },
))

export default app
