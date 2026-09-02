import { describe, it, expect } from 'vitest'
import type { AiAnswer } from '@coeditor/shared'
import { generateId } from '@coeditor/shared'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { repo } from '../src/store/index'
import { USER_ID } from '../src/lib/utils'

setupTestEnv()

const { rpcOk, rpcFail } = createRpcHelpers(app)

describe('CoEditor RPC Integration', () => {
  // ==================== Document ====================
  describe('Document', () => {
    const docId = 'doc_test_1'

    it('documents.create — creates a document', async () => {
      const doc = await rpcOk<{ id: string; title: string }>('documents.create', {
        id: docId, title: '测试文章', description: '测试描述',
      })
      expect(doc.id).toBe(docId)
      expect(doc.title).toBe('测试文章')
    })

    it('documents.list — lists documents', async () => {
      const docs = await rpcOk<Array<{ id: string }>>('documents.list')
      expect(docs.length).toBeGreaterThan(0)
      expect(docs.some((d) => d.id === docId)).toBe(true)
    })

    it('documents.get — gets a single document', async () => {
      const doc = await rpcOk<{ id: string; title: string }>('documents.get', { docId })
      expect(doc.title).toBe('测试文章')
    })

    it('documents.update — updates a document', async () => {
      const doc = await rpcOk<{ title: string }>('documents.update', { docId, title: '新标题' })
      expect(doc.title).toBe('新标题')
    })

    it('documents.get — returns error for non-existent doc', async () => {
      const err = await rpcFail('documents.get', { docId: 'nonexist' })
      expect(err).toContain('不存在')
    })

    it('documents.create — rejects empty title', async () => {
      const err = await rpcFail('documents.create', { title: '' })
      expect(err).toContain('标题不能为空')
    })

    it('documents.create — rejects path traversal ID', async () => {
      const err = await rpcFail('documents.create', { id: '../hack', title: '恶意' })
      expect(err).toContain('非法字符')
    })
  })

  // ==================== Chapter ====================
  describe('Chapter', () => {
    const docId = 'doc_test_1'
    let chapterId: string

    it('chapters.create — creates a chapter', async () => {
      const ch = await rpcOk<{ id: string; title: string }>('chapters.create', { docId, title: '第一章' })
      expect(ch.title).toBe('第一章')
      chapterId = ch.id
    })

    it('chapters.list — lists chapters', async () => {
      const chs = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
      expect(chs.length).toBeGreaterThan(0)
    })

    it('chapters.get — gets a single chapter', async () => {
      const ch = await rpcOk<{ id: string; title: string }>('chapters.get', { docId, chapterId })
      expect(ch.title).toBe('第一章')
    })

    it('chapters.update — updates a chapter', async () => {
      const ch = await rpcOk<{ title: string }>('chapters.update', { docId, chapterId, title: '新章节标题' })
      expect(ch.title).toBe('新章节标题')
    })
  })

  // ==================== Paragraph ====================
  describe('Paragraph', () => {
    const docId = 'doc_test_1'
    let chapterId: string
    let paragraphId: string

    it('setup — get first chapter', async () => {
      const chs = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
      chapterId = chs[0].id
    })

    it('paragraphs.create — creates a paragraph', async () => {
      const para = await rpcOk<{ id: string; name: string }>('paragraphs.create', { docId, chapterId, name: '段落1' })
      expect(para.name).toBe('段落1')
      paragraphId = para.id
    })

    it('paragraphs.list — lists paragraphs', async () => {
      const paras = await rpcOk<Array<{ id: string }>>('paragraphs.list', { docId, chapterId })
      expect(paras.length).toBeGreaterThan(0)
    })

    it('paragraphs.get — gets a single paragraph', async () => {
      const para = await rpcOk<{ id: string; name: string }>('paragraphs.get', { docId, chapterId, paragraphId })
      expect(para.name).toBe('段落1')
    })

    it('paragraphs.update — updates a paragraph', async () => {
      const para = await rpcOk<{ name: string }>('paragraphs.update', { docId, chapterId, paragraphId, name: '新段落名' })
      expect(para.name).toBe('新段落名')
    })
  })

  // ==================== Paragraph Draft ====================
  describe('ParagraphDraft', () => {
    const docId = 'doc_test_1'
    let chapterId: string
    let paragraphId: string
    let draftId: string

    it('setup — get first chapter and paragraph', async () => {
      const chs = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
      chapterId = chs[0].id
      const paras = await rpcOk<Array<{ id: string }>>('paragraphs.list', { docId, chapterId })
      paragraphId = paras[0].id
    })

    it('paragraphDrafts.create — creates a draft', async () => {
      const draft = await rpcOk<{ id: string; content: string; version: number }>('paragraphDrafts.create', {
        docId, chapterId, paragraphId, content: '草稿内容 v1',
      })
      expect(draft.content).toBe('草稿内容 v1')
      expect(draft.version).toBe(1)
      draftId = draft.id
    })

    it('paragraphDrafts.list — lists drafts', async () => {
      const drafts = await rpcOk<Array<{ id: string }>>('paragraphDrafts.list', { docId, chapterId, paragraphId })
      expect(drafts.length).toBe(1)
    })

    it('paragraphDrafts.create — second draft updates currentDraftId', async () => {
      const draft2 = await rpcOk<{ id: string; version: number }>('paragraphDrafts.create', {
        docId, chapterId, paragraphId, content: '草稿内容 v2',
      })
      expect(draft2.version).toBe(2)

      // Verify paragraph's currentDraftId was updated
      const para = await rpcOk<{ currentDraftId: string }>('paragraphs.get', { docId, chapterId, paragraphId })
      expect(para.currentDraftId).toBe(draft2.id)
    })

    it('paragraphDrafts.get — gets a single draft', async () => {
      const draft = await rpcOk<{ id: string; content: string }>('paragraphDrafts.get', { docId, chapterId, paragraphId, draftId })
      expect(draft.content).toBe('草稿内容 v1')
    })

    it('paragraphDrafts.delete — deletes a draft', async () => {
      await rpcOk('paragraphDrafts.delete', { docId, chapterId, paragraphId, draftId })
      const drafts = await rpcOk<Array<{ id: string }>>('paragraphDrafts.list', { docId, chapterId, paragraphId })
      expect(drafts.every((d) => d.id !== draftId)).toBe(true)
      // 删后不可读
      const err = await rpcFail('paragraphDrafts.get', { docId, chapterId, paragraphId, draftId })
      expect(err).toContain('草稿不存在')
    })
  })

  // ==================== Attachment & Template ====================
  describe('Attachment & Template', () => {
    const docId = 'doc_test_1'

    it('attachments.list — tolerates documents without attachmentOrder field (legacy data)', async () => {
      // 模拟旧版本数据：document.json 缺失 attachmentOrder 字段
      const { promises: fs } = await import('node:fs')
      const path = await import('node:path')
      const { getTestDir } = await import('./helpers')
      const legacyDoc = await rpcOk<{ id: string }>('documents.create', { id: 'doc_legacy', title: '旧数据' })
      const docFile = path.join(getTestDir(), 'users', 'default_user', 'docs', legacyDoc.id, 'document.json')
      const doc = JSON.parse(await fs.readFile(docFile, 'utf-8'))
      delete doc.attachmentOrder
      await fs.writeFile(docFile, JSON.stringify(doc), 'utf-8')

      // 不应报错，返回空列表；ensure 后能正常补上 attachmentOrder
      const atts = await rpcOk<Array<{ id: string }>>('attachments.list', { docId: legacyDoc.id })
      expect(atts).toEqual([])
      await rpcOk('attachments.ensure', { docId: legacyDoc.id, type: 'outline' })
      const after = await rpcOk<Array<{ id: string }>>('attachments.list', { docId: legacyDoc.id })
      expect(after.map((a) => a.id)).toEqual(['outline'])
    })

    it('templates.list — returns template list (novel included)', async () => {
      const templates = await rpcOk<Array<{ id: string; attachments: unknown[] }>>('templates.list')
      expect(templates.some((t) => t.id === 'novel')).toBe(true)
    })

    it('templates.get — returns a template', async () => {
      const t = await rpcOk<{ id: string; name: { zh: string; en: string } }>('templates.get', { templateId: 'novel' })
      expect(t.name.zh).toBe('小说')
    })

    it('templates.get — rejects unknown template', async () => {
      const err = await rpcFail('templates.get', { templateId: 'no_such_template' })
      expect(err).toContain('模板不存在')
    })

    it('documents.create with templateId — initializes attachmentOrder from template', async () => {
      const doc = await rpcOk<{ id: string; templateId: string; attachmentOrder: string[] }>('documents.create', {
        id: 'doc_tpl_1', title: '模板文档', templateId: 'novel',
      })
      expect(doc.templateId).toBe('novel')
      // novel 模板附件顺序：outline / worldview / characters / relations
      expect(doc.attachmentOrder).toEqual(['outline', 'worldview', 'characters', 'relations'])
    })

    it('attachments.list — returns created attachments in attachmentOrder', async () => {
      // 只创建前两个附件：worldview 后创建，验证顺序仍按 attachmentOrder
      await rpcOk('attachments.ensure', { docId: 'doc_tpl_1', type: 'outline' })
      await rpcOk('attachments.ensure', { docId: 'doc_tpl_1', type: 'worldview' })
      const atts = await rpcOk<Array<{ id: string }>>('attachments.list', { docId: 'doc_tpl_1' })
      expect(atts.map((a) => a.id)).toEqual(['outline', 'worldview'])
    })

    it('attachments.ensure — creates an attachment (idempotent)', async () => {
      const a1 = await rpcOk<{ id: string; documentId: string; currentDraftId: string; name: string }>('attachments.ensure', { docId, type: 'outline' })
      expect(a1.documentId).toBe(docId)
      expect(a1.currentDraftId).toBeTruthy()
      // 名称优先取模板定义
      expect(a1.name).toBe('大纲')
      const a2 = await rpcOk<{ id: string }>('attachments.ensure', { docId, type: 'outline' })
      expect(a2.id).toBe(a1.id)
    })

    it('attachments.ensure — does not duplicate attachmentOrder entries', async () => {
      const before = await rpcOk<Array<{ id: string }>>('attachments.list', { docId: 'doc_tpl_1' })
      await rpcOk('attachments.ensure', { docId: 'doc_tpl_1', type: 'outline' })
      const after = await rpcOk<Array<{ id: string }>>('attachments.list', { docId: 'doc_tpl_1' })
      expect(after.map((a) => a.id)).toEqual(before.map((b) => b.id))
    })

    it('attachments.get — gets a single attachment', async () => {
      const att = await rpcOk<{ id: string; name: string }>('attachments.get', { docId, type: 'outline' })
      expect(att.id).toBe('outline')
    })

    it('attachments.get — rejects unknown type', async () => {
      const err = await rpcFail('attachments.get', { docId, type: 'no_such' })
      expect(err).toContain('附件不存在')
    })

    it('attachments.update — renames attachment', async () => {
      const att = await rpcOk<{ name: string }>('attachments.update', { docId, type: 'outline', name: '我的大纲' })
      expect(att.name).toBe('我的大纲')
    })

    it('attachmentDrafts.create — creates an attachment draft and updates currentDraftId', async () => {
      const draft = await rpcOk<{ id: string; content: string; attachmentId: string }>('attachmentDrafts.create', { docId, type: 'outline', content: '附件内容' })
      expect(draft.content).toBe('附件内容')
      expect(draft.attachmentId).toBe('outline')
      // 创建草稿后附件 currentDraftId 指向它
      const att = await rpcOk<{ currentDraftId: string }>('attachments.get', { docId, type: 'outline' })
      expect(att.currentDraftId).toBe(draft.id)
    })

    it('attachmentDrafts.list — lists attachment drafts', async () => {
      const drafts = await rpcOk<Array<{ id: string }>>('attachmentDrafts.list', { docId, type: 'outline' })
      expect(drafts.length).toBeGreaterThan(0)
    })

    it('attachmentDrafts.get — gets a single draft', async () => {
      const drafts = await rpcOk<Array<{ id: string }>>('attachmentDrafts.list', { docId, type: 'outline' })
      const draft = await rpcOk<{ id: string; version: number }>('attachmentDrafts.get', { docId, type: 'outline', draftId: drafts[0].id })
      expect(draft.id).toBe(drafts[0].id)
      expect(draft.version).toBeGreaterThan(0)
    })

    it('attachments.update — switches currentDraftId', async () => {
      const drafts = await rpcOk<Array<{ id: string }>>('attachmentDrafts.list', { docId, type: 'outline' })
      const target = drafts[drafts.length - 1].id
      const att = await rpcOk<{ currentDraftId: string }>('attachments.update', { docId, type: 'outline', currentDraftId: target })
      expect(att.currentDraftId).toBe(target)
    })

    it('attachmentDrafts.delete — deletes an attachment draft', async () => {
      const drafts = await rpcOk<Array<{ id: string }>>('attachmentDrafts.list', { docId, type: 'outline' })
      const targetId = drafts[drafts.length - 1].id
      await rpcOk('attachmentDrafts.delete', { docId, type: 'outline', draftId: targetId })
      const remaining = await rpcOk<Array<{ id: string }>>('attachmentDrafts.list', { docId, type: 'outline' })
      expect(remaining.every((d) => d.id !== targetId)).toBe(true)
    })

    it('attachmentDrafts.delete of current draft — switches to a remaining draft', async () => {
      // 创建两个草稿，删除当前（最新的），应切到剩余草稿之一（含 ensure 时的初始空草稿）
      const d1 = await rpcOk<{ id: string }>('attachmentDrafts.create', { docId, type: 'characters', content: '人设 v1' })
      const d2 = await rpcOk<{ id: string }>('attachmentDrafts.create', { docId, type: 'characters', content: '人设 v2' })
      expect(d2.id).not.toBe(d1.id)
      await rpcOk('attachmentDrafts.delete', { docId, type: 'characters', draftId: d2.id })
      const att = await rpcOk<{ currentDraftId: string }>('attachments.get', { docId, type: 'characters' })
      const remaining = await rpcOk<Array<{ id: string }>>('attachmentDrafts.list', { docId, type: 'characters' })
      expect(att.currentDraftId).not.toBe(d2.id)
      expect(remaining.some((d) => d.id === att.currentDraftId)).toBe(true)
    })

    it('attachments.delete — cascades drafts and removes from attachmentOrder', async () => {
      const doc = await rpcOk<{ id: string }>('documents.create', { id: 'doc_del_att', title: '删除附件' })
      await rpcOk('attachments.ensure', { docId: doc.id, type: 'outline' })
      await rpcOk('attachmentDrafts.create', { docId: doc.id, type: 'outline', content: '待删除内容' })
      await rpcOk('attachments.delete', { docId: doc.id, type: 'outline' })
      // 附件不可再获取
      const err = await rpcFail('attachments.get', { docId: doc.id, type: 'outline' })
      expect(err).toContain('附件不存在')
      // attachmentOrder 已移除
      const remaining = await rpcOk<Array<{ id: string }>>('attachments.list', { docId: doc.id })
      expect(remaining.every((a) => a.id !== 'outline')).toBe(true)
      // 草稿也不可读
      const drafts = await rpcOk<Array<unknown>>('attachmentDrafts.list', { docId: doc.id, type: 'outline' })
      expect(drafts.length).toBe(0)
    })
  })

  // ==================== Conversation & Turn ====================
  describe('Conversation & Turn', () => {
    const docId = 'doc_test_1'
    let convId: string
    let turnId: string

    it('conversations.create — creates a conversation', async () => {
      const conv = await rpcOk<{ id: string; type: string }>('conversations.create', {
        docId, type: 'casual', parentId: docId,
      })
      expect(conv.type).toBe('casual')
      convId = conv.id
    })

    it('conversations.list — lists conversations', async () => {
      const convs = await rpcOk<Array<{ id: string }>>('conversations.list', {
        docId, parentId: docId, type: 'casual',
      })
      expect(convs.some((c) => c.id === convId)).toBe(true)
    })

    it('conversations.get — gets a single conversation', async () => {
      const conv = await rpcOk<{ id: string }>('conversations.get', { docId, convId })
      expect(conv.id).toBe(convId)
    })

    it('turns.create — creates a turn', async () => {
      const turn = await rpcOk<{ id: string; question: { content: string } }>('turns.create', {
        docId, convId, question: '你好',
      })
      expect(turn.question.content).toBe('你好')
      turnId = turn.id
    })

    it('turns.list — lists turns', async () => {
      const turnsResult = await rpcOk<Array<{ id: string }>>('turns.list', { docId, convId })
      expect(turnsResult.some((t) => t.id === turnId)).toBe(true)
    })

    it('turns.get — gets a single turn', async () => {
      const turn = await rpcOk<{ id: string }>('turns.get', { docId, turnId })
      expect(turn.id).toBe(turnId)
    })

    it('repo.turns.addAnswer — store-level push adds a new answer (turns.retry endpoint removed)', async () => {
      const answer: AiAnswer = {
        id: generateId(),
        content: '重试回答',
        thinking: '',
        model: 'test-model',
        timeCreated: new Date().toISOString(),
      }
      const saved = await repo.turns.addAnswer(USER_ID, docId, convId, turnId, answer)
      expect(saved.content).toBe('重试回答')

      // Turn starts with zero answers (placeholder removed); addAnswer pushes one
      const turn = await rpcOk<{ answers: unknown[]; currentAnswerIndex: number }>('turns.get', { docId, turnId })
      expect(turn.answers.length).toBe(1)
      expect(turn.currentAnswerIndex).toBe(0)
    })

    it('turns.selectAnswer — switches answer', async () => {
      const turn = await rpcOk<{ currentAnswerIndex: number }>('turns.selectAnswer', {
        docId, turnId, answerIndex: 0,
      })
      expect(turn.currentAnswerIndex).toBe(0)
    })

    it('turns.selectAnswer — rejects invalid index', async () => {
      const err = await rpcFail('turns.selectAnswer', { docId, turnId, answerIndex: 999 })
      expect(err).toContain('无效')
    })

    it('turns.delete — deletes a turn', async () => {
      await rpcOk('turns.delete', { docId, turnId })
      // 删后不可读
      const err = await rpcFail('turns.get', { docId, turnId })
      expect(err).toContain('Turn 不存在')
    })

    it('conversations.delete — deletes a conversation', async () => {
      await rpcOk('conversations.delete', { docId, convId })
      // 删后不可读
      const err = await rpcFail('conversations.get', { docId, convId })
      expect(err).toContain('会话不存在')
    })
  })

  // ==================== Settings ====================
  describe('Settings', () => {
    it('settings.get — returns settings with masked apiKey', async () => {
      const s = await rpcOk<{ apiKey: string; model: string }>('settings.get')
      expect(s.model).toBeTruthy()
      // Key should be masked (or empty)
      expect(s.apiKey).not.toContain('sk-')
    })

    it('settings.update — updates settings', async () => {
      const s = await rpcOk<{ model: string; style: string }>('settings.update', {
        model: 'gpt-4o', style: 'strict',
      })
      expect(s.model).toBe('gpt-4o')
      expect(s.style).toBe('strict')
    })

    it('settings.update — does not corrupt apiKey when masked value is sent back', async () => {
      // Set a real API key
      await rpcOk('settings.update', { apiKey: 'sk-real-secret-key-12345678' })

      // Get returns masked key
      const masked = await rpcOk<{ apiKey: string }>('settings.get')
      expect(masked.apiKey).toContain('*')
      expect(masked.apiKey).not.toBe('sk-real-secret-key-12345678')

      // Sending masked key back should NOT overwrite the real key
      await rpcOk('settings.update', { apiKey: masked.apiKey, model: 'gpt-4o-mini' })

      // Verify real key is preserved (settings.get still shows same masked suffix)
      const after = await rpcOk<{ apiKey: string; model: string }>('settings.get')
      expect(after.apiKey.slice(-4)).toBe('5678')
      expect(after.model).toBe('gpt-4o-mini')
    })
  })

  // ==================== Reorder Validation ====================
  describe('Reorder Validation', () => {
    const docId = 'doc_reorder_test'
    let ch1Id: string
    let ch2Id: string
    let ch3Id: string

    it('setup — create doc and chapters', async () => {
      await rpcOk('documents.create', { id: docId, title: '排序测试' })
      // ensureDocument may have created a default chapter — get all chapter IDs
      const ch1 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章1' })
      const ch2 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章2' })
      const ch3 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章3' })
      ch1Id = ch1.id; ch2Id = ch2.id; ch3Id = ch3.id
    })

    it('documents.reorderChapters — valid reorder succeeds', async () => {
      // Get all actual chapter IDs (may include auto-created ones)
      const allChs = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
      const allIds = allChs.map((c) => c.id)
      // Put ch3 first, keep the rest in whatever order
      const reordered = [ch3Id, ...allIds.filter((id) => id !== ch3Id)]
      await rpcOk('documents.reorderChapters', { docId, chapterOrder: reordered })
      const chs = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
      expect(chs[0].id).toBe(ch3Id)
    })

    it('documents.reorderChapters — invalid reorder fails', async () => {
      const err = await rpcFail('documents.reorderChapters', { docId, chapterOrder: [ch1Id, ch2Id] })
      expect(err).toContain('chapterOrder')
    })

    it('paragraphs.reorder — valid reorder succeeds', async () => {
      const p1 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch1Id, name: 'p1' })
      const p2 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch1Id, name: 'p2' })
      await rpcOk('paragraphs.reorder', { docId, chapterId: ch1Id, paragraphOrder: [p2.id, p1.id] })
      const paras = await rpcOk<Array<{ id: string }>>('paragraphs.list', { docId, chapterId: ch1Id })
      expect(paras[0].id).toBe(p2.id)
    })

    it('paragraphs.reorder — invalid reorder fails', async () => {
      const err = await rpcFail('paragraphs.reorder', { docId, chapterId: ch1Id, paragraphOrder: ['fake_id'] })
      expect(err).toContain('paragraphOrder')
    })

    it('documents.reorderChapters — non-existent doc fails', async () => {
      const err = await rpcFail('documents.reorderChapters', { docId: 'nonexist', chapterOrder: [] })
      expect(err).toContain('不存在')
    })
  })

  // ==================== Deletion Cascades ====================
  describe('Deletion', () => {
    const docId = 'doc_test_1'

    it('chapters.delete — removes chapter from chapterOrder', async () => {
      const chs = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
      const target = chs[0]
      await rpcOk('chapters.delete', { docId, chapterId: target.id })
      const remaining = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
      expect(remaining.every((c) => c.id !== target.id)).toBe(true)
      // 删后不可读
      const err = await rpcFail('chapters.get', { docId, chapterId: target.id })
      expect(err).toContain('章节不存在')
    })

    it('documents.delete — removes entire document', async () => {
      await rpcOk('documents.delete', { docId })
      const err = await rpcFail('documents.get', { docId })
      expect(err).toContain('不存在')
    })
  })

  // ==================== Security ====================
  describe('Security', () => {
    it('rejects path traversal in docId', async () => {
      const err = await rpcFail('documents.get', { docId: '../../etc/passwd' })
      expect(err).toContain('非法字符')
    })

    it('rejects path traversal in chapterId', async () => {
      const err = await rpcFail('chapters.get', { docId: 'safe_doc', chapterId: '../../../hack' })
      expect(err).toContain('非法字符')
    })

    it('rejects path traversal in attachment type', async () => {
      const err = await rpcFail('attachments.ensure', { docId: 'safe_doc', type: '../evil' })
      expect(err).toContain('非法字符')
    })


  })

  // ==================== AI review regression ====================
  describe('AI review', () => {
    const aiBody = (reviewType: string) => ({
      docId: 'doc_ai_1',
      convId: 'conv_ai_1',
      turnId: 'turn_ai_1',
      messages: [{ role: 'user' as const, content: 'hi' }],
      reviewType,
      contentContext: '[文章大纲]\n测试',
    })

    it('ai.chat — rejects legacy reviewType "outline"', async () => {
      await rpcOk('documents.create', { id: 'doc_ai_1', title: 'AI测试' })
      const res = await app.request('/api/ai.chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody('outline')),
      })
      const body = await res.json() as { success: boolean; error?: string }
      expect(body.success).toBe(false)
      expect(body.error).toContain('reviewType')
    })

    it('ai.chat — accepts reviewType "attachment"', async () => {
      // 清空 key，确保通过 schema 校验后走到"未配置 API Key"的 JSON 错误路径
      await rpcOk('settings.update', { apiKey: '' })
      const res = await app.request('/api/ai.chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody('attachment')),
      })
      const body = await res.json() as { success: boolean; error?: string }
      expect(body.success).toBe(false)
      expect(body.error).toContain('API Key')
    })

    it('ai.chat — returns error when no API key configured', async () => {
      // 确保 key 为空
      await rpcOk('settings.update', { apiKey: '' })
      const res = await app.request('/api/ai.chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody('paragraph')),
      })
      const body = await res.json() as { success: boolean; error?: string }
      expect(body.success).toBe(false)
      expect(body.error).toContain('未配置 API Key')
    })
  })
})
