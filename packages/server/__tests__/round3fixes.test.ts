import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import type { AiConversation, Chapter, Document } from '@coeditor/shared'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { repo } from '../src/store/index'
import { USER_ID } from '../src/lib/utils'
import { documentPath, chapterFilePath, paragraphDraftMdPath, templateFilePath } from '../src/store/file-paths'

setupTestEnv()

const { rpcOk, rpcFail } = createRpcHelpers(app)

// ==================== B24: exact mask-echo detection ====================

describe('settings apiKey mask-echo detection (B24)', () => {
  it('a real key containing "*" is saved and survives a masked round-trip', async () => {
    await rpcOk('settings.update', { apiKey: 'abc*def-123' })
    const got = await rpcOk<{ apiKey: string }>('settings.get')
    // maskApiKey: asterisks + last 4 chars
    expect(got.apiKey).toBe('*******-123')

    // Echoing the masked value back (as the client form does) must NOT
    // clobber the real key, while other fields still update.
    await rpcOk('settings.update', { apiKey: got.apiKey, model: 'roundtrip-model' })
    const again = await rpcOk<{ apiKey: string; model: string }>('settings.get')
    expect(again.apiKey).toBe('*******-123')
    expect(again.model).toBe('roundtrip-model')
  })
})

// ==================== R14: length caps ====================

describe('field length caps (R14)', () => {
  it('rejects ids longer than 128 chars', async () => {
    const err = await rpcFail('chapters.create', { docId: 'a'.repeat(129), title: '超长ID' })
    expect(err.startsWith('docId')).toBe(true)
  })

  it('rejects oversized settings fields', async () => {
    expect((await rpcFail('settings.update', { apiKey: 'k'.repeat(513) })).startsWith('apiKey')).toBe(true)
    expect((await rpcFail('settings.update', { model: 'm'.repeat(201) })).startsWith('model')).toBe(true)
    expect((await rpcFail('settings.update', { apiBaseUrl: 'x'.repeat(2049) })).startsWith('apiBaseUrl')).toBe(true)
  })
})

// ==================== R15: bad JSON body vs empty body ====================

describe('request body JSON handling (R15)', () => {
  it('a non-empty body that is not valid JSON is rejected explicitly', async () => {
    const res = await app.request('/api/settings.get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops',
    })
    const body = await res.json() as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('请求体不是合法 JSON')
  })

  it('an empty body is still a valid no-arg call', async () => {
    const res = await app.request('/api/settings.get', { method: 'POST' })
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(true)
  })
})

// ==================== currentDraftId rules (B3 family) ====================

describe('currentDraftId is null-based and validated', () => {
  const docId = 'doc_r3_drafts'
  let chapterId: string
  let paragraphId: string

  it('setup — doc/chapter/paragraph', async () => {
    await rpcOk('documents.create', { id: docId, title: '草稿规则测试' })
    const ch = await rpcOk<{ id: string }>('chapters.create', { docId, title: '第一章' })
    chapterId = ch.id
    const p = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId, name: '段落' })
    paragraphId = p.id
  })

  it('paragraphs.create starts with currentDraftId null', async () => {
    const p = await rpcOk<{ currentDraftId: string | null }>('paragraphs.get', { docId, chapterId, paragraphId })
    expect(p.currentDraftId).toBeNull()
  })

  it('paragraphs.update rejects an unknown draft id', async () => {
    const err = await rpcFail('paragraphs.update', {
      docId, chapterId, paragraphId, currentDraftId: 'no_such_draft',
    })
    expect(err).toContain('草稿不存在')
  })

  it('attachments.update rejects an unknown draft id', async () => {
    await rpcOk('attachments.ensure', { docId, type: 'outline' })
    const err = await rpcFail('attachments.update', {
      docId, type: 'outline', currentDraftId: 'no_such_draft',
    })
    expect(err).toContain('草稿不存在')
  })

  it('deleting the only draft resets currentDraftId to null', async () => {
    const draft = await rpcOk<{ id: string }>('paragraphDrafts.create', {
      docId, chapterId, paragraphId, content: '第一稿',
    })
    const withDraft = await rpcOk<{ currentDraftId: string | null }>('paragraphs.get', { docId, chapterId, paragraphId })
    expect(withDraft.currentDraftId).toBe(draft.id)

    await rpcOk('paragraphDrafts.delete', { docId, chapterId, paragraphId, draftId: draft.id })
    const after = await rpcOk<{ currentDraftId: string | null }>('paragraphs.get', { docId, chapterId, paragraphId })
    expect(after.currentDraftId).toBeNull()
  })
})

// ==================== B25: template existence ====================

describe('documents.create validates templateId (B25)', () => {
  it('rejects an unknown templateId', async () => {
    const err = await rpcFail('documents.create', { id: 'doc_r3_tpl', title: '模板测试', templateId: 'no_such_template' })
    expect(err).toContain('模板不存在')
  })
})

// ==================== B22: shared attachment name resolution ====================

describe('attachmentDrafts.create resolves the template name (B22)', () => {
  it('implicit ensure stores the template display name, not the raw type', async () => {
    await rpcOk('documents.create', { id: 'doc_r3_att', title: '附件命名测试' })
    await rpcOk('attachmentDrafts.create', { docId: 'doc_r3_att', type: 'worldview', content: '世界观初稿' })
    const att = await rpcOk<{ id: string; name: string }>('attachments.get', { docId: 'doc_r3_att', type: 'worldview' })
    expect(att.name).toBe('世界观')
  })
})

// ==================== B21: conversations.list sort ====================

describe('conversations.list sorts by createdAt ascending (B21)', () => {
  const docId = 'doc_r3_sort'

  it('returns conversations in createdAt order regardless of fs order', async () => {
    await rpcOk('documents.create', { id: docId, title: '会话排序测试' })
    // Ids deliberately reversed vs createdAt to rule out an id-sort coincidence.
    const newer: AiConversation = {
      id: 'conv_a', type: 'casual', documentId: docId, createdAt: '2025-01-01T00:00:00.000Z',
    }
    const older: AiConversation = {
      id: 'conv_b', type: 'casual', documentId: docId, createdAt: '2024-01-01T00:00:00.000Z',
    }
    await repo.conversations.create(USER_ID, docId, newer)
    await repo.conversations.create(USER_ID, docId, older)

    const list = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: docId, type: 'casual',
    })
    expect(list.map((c) => c.id)).toEqual(['conv_b', 'conv_a'])
  })
})

// ==================== R9: reorder ghost-id self-healing ====================

describe('reorder filters ghost ids and self-heals the stored order (R9)', () => {
  it('chapters: a ghost id in chapterOrder is dropped on reorder', async () => {
    const docId = 'doc_r3_ghost_ch'
    await rpcOk('documents.create', { id: docId, title: '幽灵章节' })
    const ch1 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '第一章' })
    const ch2 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '第二章' })

    // Inject a ghost id whose chapter file never existed.
    const docFile = documentPath(USER_ID, docId)
    const doc = JSON.parse(await fs.readFile(docFile, 'utf-8')) as Document
    doc.chapterOrder = [ch1.id, 'ghost_chapter', ch2.id]
    await fs.writeFile(docFile, JSON.stringify(doc, null, 2), 'utf-8')

    await rpcOk('documents.reorderChapters', { docId, chapterOrder: [ch2.id, ch1.id] })

    const fresh = JSON.parse(await fs.readFile(docFile, 'utf-8')) as Document
    expect(fresh.chapterOrder).toEqual([ch2.id, ch1.id])
  })

  it('paragraphs: a ghost id in paragraphOrder is dropped on reorder', async () => {
    const docId = 'doc_r3_ghost_p'
    await rpcOk('documents.create', { id: docId, title: '幽灵段落' })
    const ch = await rpcOk<{ id: string }>('chapters.create', { docId, title: '第一章' })
    const p1 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch.id, name: '段一' })
    const p2 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch.id, name: '段二' })

    const chapFile = chapterFilePath(USER_ID, docId, ch.id)
    const chap = JSON.parse(await fs.readFile(chapFile, 'utf-8')) as Chapter
    chap.paragraphOrder = [p1.id, 'ghost_paragraph', p2.id]
    await fs.writeFile(chapFile, JSON.stringify(chap, null, 2), 'utf-8')

    await rpcOk('paragraphs.reorder', { docId, chapterId: ch.id, paragraphOrder: [p2.id, p1.id] })

    const fresh = JSON.parse(await fs.readFile(chapFile, 'utf-8')) as Chapter
    expect(fresh.paragraphOrder).toEqual([p2.id, p1.id])
  })

  it('a real missing id in the incoming order still fails validation', async () => {
    const docId = 'doc_r3_ghost_strict'
    await rpcOk('documents.create', { id: docId, title: '严格校验' })
    const ch1 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '第一章' })
    await rpcOk('chapters.create', { docId, title: '第二章' })
    const err = await rpcFail('documents.reorderChapters', { docId, chapterOrder: [ch1.id] })
    expect(err).toContain('必须包含所有现有章节 ID')
  })
})

// ==================== R10: ensure backfills attachmentOrder ====================

describe('attachments.ensure re-registers a missing attachmentOrder entry (R10)', () => {
  it('heals a doc whose attachmentOrder lost the type', async () => {
    const docId = 'doc_r10_backfill'
    await rpcOk('documents.create', { id: docId, title: '回填测试' })
    await rpcOk('attachments.ensure', { docId, type: 'worldview' })

    // Hand-edit the document to simulate legacy data missing the entry.
    const docFile = documentPath(USER_ID, docId)
    const doc = JSON.parse(await fs.readFile(docFile, 'utf-8')) as Document
    doc.attachmentOrder = (doc.attachmentOrder || []).filter((t) => t !== 'worldview')
    await fs.writeFile(docFile, JSON.stringify(doc, null, 2), 'utf-8')

    const listed = await rpcOk<Array<{ id: string }>>('attachments.list', { docId })
    expect(listed.some((a) => a.id === 'worldview')).toBe(false) // invisible before heal

    await rpcOk('attachments.ensure', { docId, type: 'worldview' })
    const after = await rpcOk<Array<{ id: string }>>('attachments.list', { docId })
    expect(after.some((a) => a.id === 'worldview')).toBe(true)
  })
})

// ==================== R11: template names with embedded .json ====================

describe('templates.list strips only the trailing extension (R11)', () => {
  it('a template file named foo.json.backup.json is still loaded', async () => {
    const tpl = { id: 'backup-tpl', title: '备份模板', attachments: [] }
    await fs.writeFile(templateFilePath('foo.json.backup'), JSON.stringify(tpl, null, 2), 'utf-8')

    const templates = await rpcOk<Array<{ id: string }>>('templates.list')
    expect(templates.some((t) => t.id === 'backup-tpl')).toBe(true)
    // Sanity: the built-in template still resolves under its plain name.
    expect(templates.some((t) => t.id === 'novel')).toBe(true)
  })
})

// ==================== B23: legacy local-timestamp ids ====================

describe('legacy 14-digit ids parse as LOCAL time (B23)', () => {
  it('a legacy draft id yields the local→UTC converted createdAt', async () => {
    const docId = 'doc_r23_legacy'
    await rpcOk('documents.create', { id: docId, title: '旧ID测试' })
    const ch = await rpcOk<{ id: string }>('chapters.create', { docId, title: '第一章' })
    const p = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch.id, name: '段落' })

    // Plant a draft whose id uses the legacy YYYYMMDDHHMMSS_ format.
    const mdPath = paragraphDraftMdPath(USER_ID, docId, ch.id, p.id, '20250102030405_legacy')
    await fs.writeFile(mdPath, '旧格式草稿', 'utf-8')

    const drafts = await rpcOk<Array<{ id: string; createdAt: string }>>('paragraphDrafts.list', {
      docId, chapterId: ch.id, paragraphId: p.id,
    })
    const legacy = drafts.find((d) => d.id === '20250102030405_legacy')
    expect(legacy).toBeDefined()
    // The digits encode LOCAL time — expect the exact local→UTC conversion.
    expect(legacy!.createdAt).toBe(new Date(2025, 0, 2, 3, 4, 5).toISOString())
  })
})
