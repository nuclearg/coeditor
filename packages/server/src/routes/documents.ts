import { Hono } from 'hono'
import { z } from 'zod/v4'
import type { Document } from '@coeditor/shared'
import { generateId } from '@coeditor/shared'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/documents.list', defineRpc(
  z.object({}),
  async () => {
    return repo.documents.list(USER_ID)
  },
))

app.post('/api/documents.create', defineRpc(
  z.object({
    id: safeId.optional(),
    title: z.string().min(1, '标题不能为空').max(200),
    description: z.string().max(2000).optional(),
    templateId: safeId.optional(),
  }),
  async (input) => {
    const docId = input.id || generateId()
    // Explicit client-supplied ids must not overwrite an existing document —
    // that would replace document.json and orphan all of its sub-tree.
    if (input.id) {
      const existing = await repo.documents.get(USER_ID, input.id)
      if (existing) throw new Error('文档已存在')
    }
    const now = new Date().toISOString()

    // 附件顺序按模板定义初始化（旧文档/未指定模板回退默认）
    let attachmentOrder: string[] = []
    if (input.templateId) {
      const template = await repo.templates.get(input.templateId)
      // A dangling templateId would be a dead reference forever after — fail fast.
      if (!template) throw new Error('模板不存在')
      attachmentOrder = template.attachments.map((a) => a.type)
    }

    const doc: Document = {
      id: docId,
      userId: USER_ID,
      title: input.title,
      description: input.description || '',
      templateId: input.templateId || 'novel',
      attachmentOrder,
      chapterOrder: [],
      createdAt: now,
      updatedAt: now,
    }
    return repo.documents.create(USER_ID, doc)
  },
))

app.post('/api/documents.get', defineRpc(
  z.object({ docId: safeId }),
  async (input) => {
    const doc = await repo.documents.get(USER_ID, input.docId)
    if (!doc) throw new Error('文档不存在')
    return doc
  },
))

app.post('/api/documents.update', defineRpc(
  z.object({
    docId: safeId,
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
  }),
  async (input) => {
    return repo.documents.update(USER_ID, input.docId, {
      title: input.title,
      description: input.description,
    })
  },
))

app.post('/api/documents.delete', defineRpc(
  z.object({ docId: safeId }),
  async (input) => {
    await repo.documents.delete(USER_ID, input.docId)
    return null
  },
))

app.post('/api/documents.reorderChapters', defineRpc(
  z.object({
    docId: safeId,
    chapterOrder: z.array(safeId),
  }),
  async (input) => {
    await repo.documents.reorderChapters(USER_ID, input.docId, input.chapterOrder)
    return null
  },
))

export default app
