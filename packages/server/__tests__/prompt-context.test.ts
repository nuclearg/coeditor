import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { extractVars, renderPrompt, buildPromptContext } from '../src/lib/prompt-context'

setupTestEnv()

const { rpcOk } = createRpcHelpers(app)

describe('模板 prompt 变量解析（prompt-context）', () => {
  it('extractVars — 提取并去重', () => {
    expect(extractVars('# 大纲\n${outline}\n${worldview}\n${outline}')).toEqual(['outline', 'worldview'])
    expect(extractVars('无变量')).toEqual([])
    expect(extractVars('${ currentChapter }')).toEqual(['currentChapter'])
  })

  it('renderPrompt — 替换已知变量、未提供变量为空、无 ${} 原样', () => {
    expect(renderPrompt('${a}-${b}', { a: '1' })).toBe('1-')
    expect(renderPrompt('${a}-${b}', { a: '1', b: '2' })).toBe('1-2')
    expect(renderPrompt('你好', { a: '1' })).toBe('你好')
  })

  it('buildPromptContext — 附件/全文/章节/段落/段落前文按需组装', async () => {
    const docId = 'doc_prompt_ctx'
    await rpcOk('documents.create', { id: docId, title: 'prompt上下文' })
    await rpcOk('attachments.ensure', { docId, type: 'outline', name: '大纲' })
    await rpcOk('attachmentDrafts.create', { docId, type: 'outline', content: '大纲内容ABC' })
    const chapter = await rpcOk<{ id: string }>('chapters.create', { docId, title: '第一章' })
    const p1 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: chapter.id, name: '段落一' })
    await rpcOk('paragraphDrafts.create', { docId, chapterId: chapter.id, paragraphId: p1.id, content: '段落一内容' })
    const p2 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: chapter.id, name: '段落二' })
    await rpcOk('paragraphDrafts.create', { docId, chapterId: chapter.id, paragraphId: p2.id, content: '段落二内容' })

    const vars = ['outline', 'document', 'currentChapter', 'currentParagraph', 'currentChapterPrevParagraphs']
    const ctx = await buildPromptContext(vars, {
      docId, attachmentId: 'outline', chapterId: chapter.id, paragraphId: p2.id,
    })

    expect(ctx.outline).toContain('大纲内容ABC')
    expect(ctx.document).toContain('# 第一章')
    expect(ctx.document).toContain('段落一内容')
    expect(ctx.document).toContain('段落二内容')
    expect(ctx.currentChapter).toContain('段落一内容')
    expect(ctx.currentParagraph).toContain('段落二内容')
    // 段落前文 = 当前段落（p2）之前的段落（p1）
    expect(ctx.currentChapterPrevParagraphs).toContain('段落一内容')
    expect(ctx.currentChapterPrevParagraphs).not.toContain('段落二内容')

    // 未引用变量不组装
    const only = await buildPromptContext(['outline'], { docId })
    expect(only.outline).toBeTruthy()
    expect(only.document).toBeUndefined()

    // 全链路：模板渲染
    const template = '审阅大纲：\n${outline}\n\n对照：\n${currentChapter}'
    const rendered = renderPrompt(template, ctx)
    expect(rendered).toContain('大纲内容ABC')
    expect(rendered).toContain('段落一内容')
  })
})
