import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { generateId } from '@coeditor/shared'
import { setupTestEnv, createRpcHelpers, getTestDir } from './helpers'
import app from '../src/index'

setupTestEnv()

const { rpcOk, rpcFail } = createRpcHelpers(app)

// ==================== B1: safeId rejects bare '.' ====================

describe('safeId rejects bare "." (data-loss regression)', () => {
  it('documents.delete({docId:"."}) fails validation and docs survive', async () => {
    await rpcOk('documents.create', { id: 'doc_dot_victim', title: '点号测试' })
    const err = await rpcFail('documents.delete', { docId: '.' })
    expect(err).toContain('非法字符')
    // The whole docs root must still be intact
    const doc = await rpcOk<{ id: string }>('documents.get', { docId: 'doc_dot_victim' })
    expect(doc.id).toBe('doc_dot_victim')
  })

  it('other delete endpoints reject "." too', async () => {
    const docId = 'doc_dot_victim'
    const ch = await rpcOk<{ id: string }>('chapters.create', { docId, title: '点号章节' })
    expect(await rpcFail('chapters.delete', { docId, chapterId: '.' })).toContain('非法字符')
    expect(await rpcFail('paragraphs.delete', { docId, chapterId: ch.id, paragraphId: '.' })).toContain('非法字符')
    expect(await rpcFail('attachments.delete', { docId, type: '.' })).toContain('非法字符')
    expect(await rpcFail('conversations.delete', { docId, convId: '.' })).toContain('非法字符')
    // Chapter still exists
    const after = await rpcOk<{ id: string }>('chapters.get', { docId, chapterId: ch.id })
    expect(after.id).toBe(ch.id)
  })
})

// ==================== B9: turnId 'conversation' is reserved ====================

describe('turnId "conversation" is reserved (conversation.json collision)', () => {
  const docId = 'doc_turnid_reserved'
  let convId: string

  it('setup — create doc, conversation and a real turn', async () => {
    await rpcOk('documents.create', { id: docId, title: 'turnId保留字测试' })
    const conv = await rpcOk<{ id: string }>('conversations.create', {
      docId, type: 'casual', parentId: docId,
    })
    convId = conv.id
    await rpcOk('turns.create', { docId, convId, question: '你好' })
  })

  it('all turn endpoints reject turnId "conversation"', async () => {
    expect(await rpcFail('turns.get', { docId, convId, turnId: 'conversation' })).toContain('非法字符')
    expect(await rpcFail('turns.delete', { docId, convId, turnId: 'conversation' })).toContain('非法字符')
    expect(await rpcFail('turns.selectAnswer', { docId, convId, turnId: 'conversation', answerIndex: 0 })).toContain('非法字符')
  })

  it('conversation metadata survives', async () => {
    const conv = await rpcOk<{ id: string }>('conversations.get', { docId, convId })
    expect(conv.id).toBe(convId)
    const turns = await rpcOk<Array<{ id: string }>>('turns.list', { docId, convId })
    expect(turns.length).toBe(1)
  })
})

// ==================== B10: duplicate doc id / orphan attachment trees ====================

describe('documents.create duplicate explicit id', () => {
  it('rejects with 文档已存在 and keeps the original', async () => {
    await rpcOk('documents.create', { id: 'doc_dup_create', title: '原文档' })
    const err = await rpcFail('documents.create', { id: 'doc_dup_create', title: '覆盖尝试' })
    expect(err).toContain('文档已存在')
    const doc = await rpcOk<{ title: string }>('documents.get', { docId: 'doc_dup_create' })
    expect(doc.title).toBe('原文档')
  })
})

describe('attachments.ensure requires the parent document', () => {
  it('rejects a missing doc and leaves no orphan files', async () => {
    const err = await rpcFail('attachments.ensure', { docId: 'no_such_doc_xyz', type: 'outline' })
    expect(err).toContain('文档不存在')
    const orphanDir = path.join(getTestDir(), 'users', 'default_user', 'docs', 'no_such_doc_xyz')
    await expect(fs.access(orphanDir)).rejects.toThrow()
  })

  it('still works for an existing doc', async () => {
    await rpcOk('documents.create', { id: 'doc_ensure_ok', title: '附件正常路径' })
    const att = await rpcOk<{ id: string }>('attachments.ensure', { docId: 'doc_ensure_ok', type: 'outline' })
    expect(att.id).toBe('outline')
  })
})

// ==================== R13: conversations / turns parent existence checks ====================

describe('conversations.create requires the parent document (R13)', () => {
  it('rejects a missing doc and leaves no orphan files', async () => {
    const err = await rpcFail('conversations.create', {
      docId: 'no_such_doc_conv', type: 'casual', parentId: 'no_such_doc_conv',
    })
    expect(err).toContain('文档不存在')
    const orphanDir = path.join(getTestDir(), 'users', 'default_user', 'docs', 'no_such_doc_conv')
    await expect(fs.access(orphanDir)).rejects.toThrow()
  })
})

describe('turns.create requires the parent conversation (R13)', () => {
  it('rejects a missing conversation and leaves no orphan files', async () => {
    await rpcOk('documents.create', { id: 'doc_turn_parent', title: 'Turn父级校验' })
    const err = await rpcFail('turns.create', {
      docId: 'doc_turn_parent', convId: 'no_such_conv', question: '你好',
    })
    expect(err).toContain('会话不存在')
    const orphanDir = path.join(
      getTestDir(), 'users', 'default_user', 'docs', 'doc_turn_parent', 'conversations', 'no_such_conv',
    )
    await expect(fs.access(orphanDir)).rejects.toThrow()
  })
})

// ==================== B6: corrupt JSON must not break list endpoints ====================

describe('corrupt JSON tolerance in list endpoints', () => {
  it('one corrupt document.json does not break documents.list', async () => {
    await rpcOk('documents.create', { id: 'doc_corrupt_a', title: '好文档' })
    await rpcOk('documents.create', { id: 'doc_corrupt_bad', title: '坏文档' })
    const badFile = path.join(getTestDir(), 'users', 'default_user', 'docs', 'doc_corrupt_bad', 'document.json')
    await fs.writeFile(badFile, '{ this is not json !!!', 'utf-8')

    const docs = await rpcOk<Array<{ id: string }>>('documents.list')
    expect(docs.some((d) => d.id === 'doc_corrupt_a')).toBe(true)
    expect(docs.some((d) => d.id === 'doc_corrupt_bad')).toBe(false)
  })

  it('one corrupt chapter.json does not break chapters.list', async () => {
    const docId = 'doc_corrupt_ch'
    await rpcOk('documents.create', { id: docId, title: '章节容错' })
    const good = await rpcOk<{ id: string }>('chapters.create', { docId, title: '好章节' })
    const bad = await rpcOk<{ id: string }>('chapters.create', { docId, title: '坏章节' })
    const badFile = path.join(getTestDir(), 'users', 'default_user', 'docs', docId, 'chapters', bad.id, 'chapter.json')
    await fs.writeFile(badFile, 'not-json-at-all', 'utf-8')

    const chapters = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
    expect(chapters.map((c) => c.id)).toEqual([good.id])
  })
})

// ==================== R8: generateId monotonic ordering ====================

describe('generateId monotonic ordering', () => {
  it('lexicographic order matches creation order for 1000 rapid ids', () => {
    const ids: string[] = []
    for (let i = 0; i < 1000; i++) ids.push(generateId())
    // All unique
    expect(new Set(ids).size).toBe(1000)
    // Lexicographic sort must not change the order
    const sorted = [...ids].sort()
    expect(sorted).toEqual(ids)
  })

  it('ids keep the <prefix>_<suffix> shape used by filename sorting', () => {
    expect(generateId()).toMatch(/^[0-9a-z]+_[0-9a-z]+$/)
  })
})

// ==================== B5: bodyLimit returns a proper 413 ====================

describe('bodyLimit returns proper 413 JSON', () => {
  it('oversized body is rejected with status 413 and a clear message', async () => {
    const res = await app.request('/api/documents.create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(9 * 1024 * 1024) }),
    })
    expect(res.status).toBe(413)
    const body = await res.json() as { success: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('请求体过大')
  })
})

// ==================== D1: ai.models removed ====================

describe('ai.models endpoint removed', () => {
  it('POST /api/ai.models no longer resolves to an RPC endpoint', async () => {
    const res = await app.request('/api/ai.models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    // Not a registered route anymore (hono default 404, not the RPC envelope)
    expect(res.status).toBe(404)
  })
})
