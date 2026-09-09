/**
 * 后端 API 辅助：e2e 测试用固定前缀的 RPC 请求创建独立文档/章节，互不干扰。
 */
import { backendBase } from './env'

export async function apiRpc<T>(action: string, params: object = {}): Promise<T> {
  const res = await fetch(`${backendBase()}/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const body = (await res.json()) as { success: boolean; data: T; error?: string }
  if (!body.success) throw new Error(`${action} failed: ${body.error}`)
  return body.data
}

export interface E2EDoc {
  id: string
  title: string
  templateId: string
}

export async function createDoc(title: string): Promise<E2EDoc> {
  return apiRpc<E2EDoc>('documents.create', { title, templateId: 'novel' })
}

export interface E2EChapter {
  id: string
  title: string
}

export async function createChapter(docId: string, title: string): Promise<E2EChapter> {
  return apiRpc<E2EChapter>('chapters.create', { docId, title })
}

export async function listChapters(docId: string): Promise<E2EChapter[]> {
  return apiRpc<E2EChapter[]>('chapters.list', { docId })
}

export interface E2EParagraph {
  id: string
  name: string
}

export async function listParagraphs(docId: string, chapterId: string): Promise<E2EParagraph[]> {
  return apiRpc<E2EParagraph[]>('paragraphs.list', { docId, chapterId })
}
