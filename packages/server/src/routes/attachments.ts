import { Hono } from 'hono'
import { z } from 'zod/v4'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID, resolveAttachmentName } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/attachments.list', defineRpc(
  z.object({ docId: safeId }),
  async (input) => {
    return repo.attachments.list(USER_ID, input.docId)
  },
))

app.post('/api/attachments.ensure', defineRpc(
  z.object({ docId: safeId, type: safeId, name: z.string().max(100).optional() }),
  async (input) => {
    // 名称优先取模板定义（多语言字段存 zh 作为基线，前端按当前语言展示模板名）
    let name = input.name || input.type
    const doc = await repo.documents.get(USER_ID, input.docId)
    if (doc?.templateId) {
      const template = await repo.templates.get(doc.templateId)
      name = resolveAttachmentName(template, input.type, name)
    }
    return repo.attachments.ensure(USER_ID, input.docId, input.type, name)
  },
))

app.post('/api/attachments.get', defineRpc(
  z.object({ docId: safeId, type: safeId }),
  async (input) => {
    const attachment = await repo.attachments.get(USER_ID, input.docId, input.type)
    if (!attachment) throw new Error('附件不存在')
    return attachment
  },
))

app.post('/api/attachments.update', defineRpc(
  z.object({
    docId: safeId,
    type: safeId,
    name: z.string().max(100).optional(),
    currentDraftId: safeId.optional(),
  }),
  async (input) => {
    return repo.attachments.update(USER_ID, input.docId, input.type, {
      name: input.name,
      currentDraftId: input.currentDraftId,
    })
  },
))

app.post('/api/attachments.delete', defineRpc(
  z.object({ docId: safeId, type: safeId }),
  async (input) => {
    await repo.attachments.delete(USER_ID, input.docId, input.type)
    return null
  },
))

export default app
