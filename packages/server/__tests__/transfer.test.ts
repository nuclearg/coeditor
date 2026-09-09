import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unzipSync } from 'fflate'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { repo } from '../src/store/index'
import { USER_ID } from '../src/lib/utils'

setupTestEnv()

const { rpc, rpcOk, rpcFail } = createRpcHelpers(app)

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
/**
 * 一段正文 = N 个**互不相同**的句子拼接（长度稳定、锚点串唯一）。
 * 注意：若句子重复，同一锚点串会在原文中多次出现，后往前定位会命中最后一次——那是文本本身的歧义。
 */
function block(label: string, n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) {
    out += sent(`${label}-${i}：林深见鹿，溪午闻钟，少年踏着晨雾走进山中`)
  }
  return out
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
      await rpcOk<{ id: string }>('documents.create', { title: '同名' })
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
    /** 读取某章各段落的当前草稿内容（落库顺序）。 */
    async function paragraphContents(docId: string, chapterId: string): Promise<string[]> {
      const paras = await repo.paragraphs.list(USER_ID, docId, chapterId)
      const out: string[] = []
      for (const p of paras) {
        const drafts = await repo.drafts.listParagraphDrafts(USER_ID, docId, chapterId, p.id)
        out.push(drafts[0]?.content ?? '')
      }
      return out
    }

    it('导入：按标识行锚点切分（标识整行随本段），章节/段落标题落库，拼接即原文', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      const content = [
        '# 序章',
        '',
        '## 老板.1',
        '',
        '第一段正文甲。',
        '',
        '## 老板.2',
        '',
        '第二段正文乙。',
        '',
        '# 第一章',
        '',
        '## 老板.3',
        '',
        '第三段正文丙。',
      ].join('\n')
      stubAiComplete(
        JSON.stringify({
          chapters: [
            {
              title: '序章',
              start: '# 序章',
              paragraphs: [
                { title: '初见', start: '## 老板.1' },
                { title: '试探', start: '## 老板.2' },
              ],
            },
            { title: '第一章', start: '# 第一章', paragraphs: [{ title: '再会', start: '## 老板.3' }] },
          ],
        }),
      )

      const doc = await rpcOk<{ id: string; title: string }>('documents.importText', {
        title: '标识切分',
        templateId: 'novel',
        content,
      })
      expect(doc.title).toBe('标识切分')

      const chapters = await repo.chapters.list(USER_ID, doc.id)
      expect(chapters.map((c) => c.title)).toEqual(['序章', '第一章'])

      const [ch1, ch2] = chapters
      const p1 = await repo.paragraphs.list(USER_ID, doc.id, ch1.id)
      expect(p1.map((p) => p.name)).toEqual(['初见', '试探']) // 段落 name = AI 段落标题
      const c1 = await paragraphContents(doc.id, ch1.id)
      // 段落标识整行落在本段开头：段1 含 "## 老板.1"、段2 以 "## 老板.2" 开头
      expect(c1[0]).toContain('## 老板.1')
      expect(c1[0]).not.toContain('## 老板.2')
      expect(c1[1].startsWith('## 老板.2')).toBe(true)
      const c2 = await paragraphContents(doc.id, ch2.id)
      // 章标题行属于该章第一段的头部 → 首段以 "# 第一章" 开头，且含本段标识 "## 老板.3"
      expect(c2[0].startsWith('# 第一章')).toBe(true)
      expect(c2[0]).toContain('## 老板.3')
      // 内容零改写：段落拼接 = 原文
      expect([...c1, ...c2].join('')).toBe(content)
    })

    it('导入：无标识文本按 AI 锚点切段，拼接即原文', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      const a1 = block('A1', 5)
      const a2 = block('A2', 5)
      const content = `第一章 开端\n\n${a1}${a2}`
      stubAiComplete(
        JSON.stringify({
          chapters: [
            {
              title: '第一章 开端',
              start: '第一章 开端',
              paragraphs: [
                { title: '开篇', start: a1.slice(0, 18) },
                { title: '转折', start: a2.slice(0, 18) },
              ],
            },
          ],
        }),
      )

      const doc = await rpcOk<{ id: string }>('documents.importText', { title: '无标识', templateId: 'novel', content })
      const chapters = await repo.chapters.list(USER_ID, doc.id)
      expect(chapters).toHaveLength(1)
      const paras = await repo.paragraphs.list(USER_ID, doc.id, chapters[0].id)
      expect(paras).toHaveLength(2)
      const contents = await paragraphContents(doc.id, chapters[0].id)
      expect(contents[0]).toBe(`第一章 开端\n\n${a1}`) // 章标题行归第一段（锚点之前的头部并入）
      expect(contents[1]).toBe(a2)
      expect(contents.join('')).toBe(content)
    })

    it('导入：AI 未给段落锚点 → 整章一段（不做规则切分）', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      const body = block('长文', 120) // ~2600 字，无标识整块
      const content = `第一章 长文\n\n${body}`
      stubAiComplete(
        JSON.stringify({ chapters: [{ title: '第一章 长文', start: '第一章 长文', paragraphs: [] }] }),
      )

      const doc = await rpcOk<{ id: string }>('documents.importText', { title: '整章', templateId: 'novel', content })
      const chapters = await repo.chapters.list(USER_ID, doc.id)
      expect(chapters).toHaveLength(1)
      const contents = await paragraphContents(doc.id, chapters[0].id)
      expect(contents).toHaveLength(1)
      expect(contents[0]).toBe(content)
    })

    it('导入：锚点未命中原文 → 重试一次后报错且不建文档', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      let calls = 0
      globalThis.fetch = (async () => {
        calls++
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ chapters: [{ title: '第一章', start: '原文中不存在的锚点XYZ', paragraphs: [] }] }) } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }) as typeof fetch

      const before = await repo.documents.list(USER_ID)
      const err = await rpcFail('documents.importText', { title: 'x', templateId: 'novel', content: '第一章\n\n内容' })
      expect(err).toContain('未能正确拆分章节')
      expect(calls).toBe(2) // 重试一次
      expect((await repo.documents.list(USER_ID)).length).toBe(before.length)
    })

    it('导入：AI 返回空 chapters 报错且不建文档', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      stubAiComplete('{"chapters":[]}')
      const before = await repo.documents.list(USER_ID)
      const err = await rpcFail('documents.importText', { title: 'x', templateId: 'novel', content: '第一章\n\n内容' })
      expect(err).toContain('未能正确拆分章节')
      expect((await repo.documents.list(USER_ID)).length).toBe(before.length)
    })

    it('导入：超过 10 万字拒绝且不调 AI', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      let aiCalled = false
      globalThis.fetch = (async () => {
        aiCalled = true
        return new Response('{}')
      }) as typeof fetch

      const err = await rpcFail('documents.importText', { title: 'x', templateId: 'novel', content: 'a'.repeat(100_001) })
      expect(err).toContain('过长')
      expect(aiCalled).toBe(false)
    })

    it('导入：未配置 API Key 拒绝', async () => {
      const err = await rpcFail('documents.importText', { title: 'x', templateId: 'novel', content: '第一章\n\n内容' })
      expect(err).toContain('未配置 API Key')
    })

    it('导入：缺 title 或 templateId 一律拒绝（必须先选模板 + 填标题）', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      const before = await repo.documents.list(USER_ID)
      const missingTemplate = await rpc('documents.importText', { title: 'x', content: '第一章\n\n内容' })
      expect(missingTemplate.success).toBe(false)
      const missingTitle = await rpc('documents.importText', { templateId: 'novel', content: '第一章\n\n内容' })
      expect(missingTitle.success).toBe(false)
      expect((await repo.documents.list(USER_ID)).length).toBe(before.length)
    })
  })
})
