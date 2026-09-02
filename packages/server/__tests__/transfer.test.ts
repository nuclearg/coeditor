import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unzipSync } from 'fflate'
import { generateId } from '@coeditor/shared'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { repo } from '../src/store/index'
import { USER_ID } from '../src/lib/utils'

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

const IMPORT_AI_JSON = JSON.stringify({
  chapters: [
    { title: '第一章 开端', startHint: '风雨如晦。' },
    { title: '第二章 奇遇', startHint: '他遇见一位老者。' },
  ],
})

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
    it('导入：AI 分章 + 原文锚点定位 + 规则分段，无计费', async () => {
      await repo.settings.update(USER_ID, { apiKey: 'test-key' })
      stubAiComplete(IMPORT_AI_JSON)

      const content = '第一章 开端\n\n风雨如晦。\n\n少年提灯出门。\n\n第二章 奇遇\n\n他遇见一位老者。\n\n老者递来一卷书。'
      const doc = await rpcOk<{ id: string; title: string }>('documents.importText', {
        title: '导入测试',
        templateId: 'novel',
        content,
      })
      expect(doc.title).toBe('导入测试')

      const chapters = await repo.chapters.list(USER_ID, doc.id)
      expect(chapters.map((c) => c.title)).toEqual(['第一章 开端', '第二章 奇遇'])
      for (const ch of chapters) {
        const paras = await repo.paragraphs.list(USER_ID, doc.id, ch.id)
        expect(paras).toHaveLength(2)
      }
      // 无计费概念：settings 仍是 BYOK，无钱包
      const settings = await repo.settings.get(USER_ID)
      expect(settings.apiKey).toBe('test-key')
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
})
