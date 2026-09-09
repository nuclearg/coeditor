import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unzipSync } from 'fflate'
import { generateId } from '@coeditor/shared'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { repo } from '../src/store/index'
import { USER_ID } from '../src/lib/utils'
import { normalizeParagraph, splitByParagraphTarget } from '../src/lib/transfer'

setupTestEnv()

const { rpcOk, rpcFail } = createRpcHelpers(app)

// === fetch stubbing（导入分章走 BYOK 上游调用） ===
const realFetch = globalThis.fetch

function stubAiComplete(aiJson: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: aiJson } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
}

/** 单句（自带句号）。 */
function sent(text: string): string {
  return `${text}。`
}
/** 一段正文 = 固定句子重复 N 遍（长度稳定可断言）。 */
function block(label: string, n: number): string {
  return sent(`${label}：林深见鹿，溪午闻钟，少年踏着晨雾走进山中`).repeat(n)
}

describe('导入导出', () => {
  beforeEach(async () => {
    globalThis.fetch = realFetch
    await repo.settings.update(USER_ID, { apiKey: '' })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  describe('documents.export', () => {
    it('单篇导出：附件在前章节在后（# 一级标题），文件名 UTF-8', async () => {
      const doc = await rpcOk<{ id: string }>('documents.create', { title: '导出测试', templateId: 'novel' })
      await rpcOk('attachmentDrafts.create', { docId: doc.id, type: 'outline', content: '大纲内容' })
      const chapter = await rpcOk<{ id: string }>('chapters.create', { docId: doc.id, title: '第一章' })
      const para = await rpcOk<{ id: string }>('paragraphs.create', { docId: doc.id, chapterId: chapter.id, name: '段一' })
      await rpcOk('paragraphDrafts.create', { docId: doc.id, chapterId: chapter.id, paragraphId: para.id, content: '正文内容' })

      const res = await app.request('/api/documents.export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id }),
      })
      expect(res.status).toBe(200)
      const md = await res.text()
      expect(md).toContain('# 大纲\n大纲内容')
      expect(md).toContain('# 第一章\n正文内容')
      expect(md.indexOf('# 大纲')).toBeLessThan(md.indexOf('# 第一章'))
      expect(res.headers.get('Content-Type')).toContain('text/markdown')
      expect(res.headers.get('Content-Disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('导出测试.md')}`)
    })

    it('全量导出：zip 每篇一个 md，重名自动加序号', async () => {
      const d1 = await rpcOk<{ id: string }>('documents.create', { title: '同名' })
      await rpcOk<{ id: string }>('documents.create', { title: '同名' })

      const res = await app.request('/api/documents.export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('application/zip')
      expect(res.headers.get('Content-Disposition')).toContain('.zip')
      const entries = unzipSync(new Uint8Array(await res.arrayBuffer()))
      expect(Object.keys(entries).sort()).toEqual(expect.arrayContaining(['同名 (1).md', '同名.md']))
    })

    it('导出不存在的文档报错', async () => {
      const res = await app.request('/api/documents.export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: 'nonexist' }),
      })
      expect((await res.json()).error).toContain('文档不存在')
    })
  })

  describe('documents.importText', () => {
    it('导入：AI 分章 + 段落按 AI 锚点切分（~1000 字），正文文字零改写', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      // 每章两块正文（单换行相连，无空行）：AI 给两块分界锚点 → 每章 2 段
      const a1 = block('A1', 30) // ~660 字
      const a2 = block('A2', 30)
      const b1 = block('B1', 30)
      const b2 = block('B2', 30)
      const content = `第一章 开端\n\n${a1}\n${a2}\n第二章 奇遇\n${b1}\n${b2}`
      const hintOf = (s: string) => s.slice(0, 18)
      stubAiComplete(
        JSON.stringify({
          chapters: [
            {
              title: '第一章 开端',
              startHint: hintOf(a1),
              paragraphs: [{ startHint: hintOf(a1) }, { startHint: hintOf(a2) }],
            },
            {
              title: '第二章 奇遇',
              startHint: hintOf(b1),
              paragraphs: [{ startHint: hintOf(b1) }, { startHint: hintOf(b2) }],
            },
          ],
        }),
      )

      const doc = await rpcOk<{ id: string; title: string }>('documents.importText', {
        title: '导入测试',
        templateId: 'novel',
        content,
      })
      expect(doc.title).toBe('导入测试')

      const chapters = await repo.chapters.list(USER_ID, doc.id)
      expect(chapters.map((c) => c.title)).toEqual(['第一章 开端', '第二章 奇遇'])
      const [ch1, ch2] = chapters
      const p1 = await repo.paragraphs.list(USER_ID, doc.id, ch1.id)
      const p2 = await repo.paragraphs.list(USER_ID, doc.id, ch2.id)
      // 每章 2 段，且拼回 = 原文（段落内换行已归并，正文文字不变）
      expect(p1).toHaveLength(2)
      expect(p2).toHaveLength(2)
      const d1 = await repo.drafts.listParagraphDrafts(USER_ID, doc.id, ch1.id, p1[0].id)
      const d2 = await repo.drafts.listParagraphDrafts(USER_ID, doc.id, ch1.id, p1[1].id)
      expect(d1[0].content + d2[0].content).toBe(a1 + a2)
      expect(d1[0].content).toBe(a1)
      expect(d2[0].content).toBe(a2)
    })

    it('导入：章节不足 1000 字 → 整章单段（即使 AI 给了多个段落锚点）', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      const short = '风雨如晦，少年提灯出门，山寺钟声隐隐传来。'
      const content = `第一章 开端\n\n${short}`
      const hint = short.slice(0, 10)
      stubAiComplete(
        JSON.stringify({
          chapters: [
            { title: '第一章 开端', startHint: hint, paragraphs: [{ startHint: hint }, { startHint: '钟声隐隐传来' }] },
          ],
        }),
      )
      const doc = await rpcOk<{ id: string }>('documents.importText', { title: 'x', content })
      const chapters = await repo.chapters.list(USER_ID, doc.id)
      expect(chapters).toHaveLength(1)
      const paras = await repo.paragraphs.list(USER_ID, doc.id, chapters[0].id)
      expect(paras).toHaveLength(1)
      const drafts = await repo.drafts.listParagraphDrafts(USER_ID, doc.id, chapters[0].id, paras[0].id)
      expect(drafts[0].content).toBe(short)
    })

    it('导入：AI 只给章节未给段落锚点 → 规则兜底按 ~1000 字断段', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      const body = block('长文', 120) // ~2600 字，无空行整块
      const content = `第一章 长文\n\n${body}`
      stubAiComplete(
        JSON.stringify({
          chapters: [{ title: '第一章 长文', startHint: body.slice(0, 18) }],
        }),
      )
      const doc = await rpcOk<{ id: string }>('documents.importText', { title: 'x', content })
      const chapters = await repo.chapters.list(USER_ID, doc.id)
      expect(chapters).toHaveLength(1)
      const paras = await repo.paragraphs.list(USER_ID, doc.id, chapters[0].id)
      // ~2600 字 → 至少 2 段，且文字拼回与原文一致
      expect(paras.length).toBeGreaterThanOrEqual(2)
      const drafts = await Promise.all(
        paras.map((p) => repo.drafts.listParagraphDrafts(USER_ID, doc.id, chapters[0].id, p.id)),
      )
      expect(drafts.map((d) => d[0].content).join('')).toBe(body)
    })

    it('导入：超过 10 万字拒绝且不调 AI', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      let aiCalled = false
      globalThis.fetch = (async () => {
        aiCalled = true
        return new Response('{}')
      }) as typeof fetch

      const err = await rpcFail('documents.importText', { title: 'x', content: 'a'.repeat(100_001) })
      expect(err).toContain('过长')
      expect(aiCalled).toBe(false)
    })

    it('导入：未配置 API Key 拒绝', async () => {
      const err = await rpcFail('documents.importText', { title: 'x', content: '第一章\n\n内容' })
      expect(err).toContain('未配置 API Key')
    })

    it('导入：AI 返回结构无法解析时报错且不建文档', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      stubAiComplete('{"chapters":[]}')
      const before = await repo.documents.list(USER_ID)
      const err = await rpcFail('documents.importText', { title: 'x', content: '第一章\n\n内容' })
      expect(err).toContain('未能正确拆分章节')
      const after = await repo.documents.list(USER_ID)
      expect(after.length).toBe(before.length)
    })
  })

  describe('段落规则切分（transfer lib）', () => {
    it('normalizeParagraph：删空行/换行归并，正文文字不变', () => {
      expect(normalizeParagraph('第一段。\n\n  第二段。  \n第三段。')).toBe('第一段。第二段。第三段。')
      expect(normalizeParagraph('hello\nworld')).toBe('hello world') // ASCII 相邻补空格
    })

    it('splitByParagraphTarget：长文本按句号断出 ~1000 字段落，文字完整', () => {
      const body = block('甲', 200) // ~4400 字
      const parts = splitByParagraphTarget(body)
      expect(parts.length).toBeGreaterThanOrEqual(3)
      expect(parts.join('')).toBe(body)
      for (const p of parts) {
        expect(p.length).toBeLessThanOrEqual(1_700)
        expect(p.endsWith('。')).toBe(true) // 句号后断，无截断句
      }
    })
  })
})
