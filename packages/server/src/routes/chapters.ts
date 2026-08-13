import { Hono } from 'hono'
import { z } from 'zod/v4'
import type { Chapter } from '@coeditor/shared'
import { generateId } from '@coeditor/shared'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/chapters.list', defineRpc(
  z.object({ docId: safeId }),
  async (input) => {
    return repo.chapters.list(USER_ID, input.docId)
  },
))

app.post('/api/chapters.create', defineRpc(
  z.object({
    docId: safeId,
    title: z.string().min(1, '章节标题不能为空').max(200),
  }),
  async (input) => {
    // Ensure document exists with default structure
    const doc = await repo.documents.get(USER_ID, input.docId)
    if (!doc) throw new Error('文档不存在')

    const chapter: Chapter = {
      id: generateId(),
      documentId: input.docId,
      title: input.title,
      paragraphOrder: [],
      createdAt: new Date().toISOString(),
    }
    return repo.chapters.create(USER_ID, input.docId, chapter)
  },
))

app.post('/api/chapters.get', defineRpc(
  z.object({ docId: safeId, chapterId: safeId }),
  async (input) => {
    const chapter = await repo.chapters.get(USER_ID, input.docId, input.chapterId)
    if (!chapter) throw new Error('章节不存在')
    return chapter
  },
))

app.post('/api/chapters.update', defineRpc(
  z.object({
    docId: safeId,
    chapterId: safeId,
    title: z.string().min(1).max(200).optional(),
  }),
  async (input) => {
    return repo.chapters.update(USER_ID, input.docId, input.chapterId, {
      title: input.title,
    })
  },
))

app.post('/api/chapters.delete', defineRpc(
  z.object({ docId: safeId, chapterId: safeId }),
  async (input) => {
    await repo.chapters.delete(USER_ID, input.docId, input.chapterId)
    return null
  },
))

export default app
