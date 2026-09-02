import { Hono } from 'hono'
import { z } from 'zod/v4'
import type { Document, Attachment } from '@coeditor/shared'
import { generateId } from '@coeditor/shared'
import { defineRpc, safeId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'
import { aiComplete } from '../lib/ai-complete.js'
import {
  IMPORT_SYSTEM_PROMPT, MAX_IMPORT_CHARS,
  buildZip, chapterParagraphs, docToMarkdown, locateChapters, parseChapterPlan,
  sanitizeFileName, uniqueFileNames,
  type MarkdownSource,
} from '../lib/transfer.js'

const app = new Hono()

/** 组装单篇 markdown 源数据（附件/章节/段落均按 order 数组顺序，内容取当前草稿）。 */
async function buildMarkdownSource(doc: Document): Promise<MarkdownSource> {
  const chapters = await repo.chapters.list(USER_ID, doc.id)
  const chapterSources: MarkdownSource['chapters'] = []
  for (const ch of chapters) {
    const paragraphs: string[] = []
    const paras = await repo.paragraphs.list(USER_ID, doc.id, ch.id)
    for (const p of paras) {
      const drafts = await repo.drafts.listParagraphDrafts(USER_ID, doc.id, ch.id, p.id)
      // drafts 按 version 降序（最新在前）；currentDraftId 优先，无则最新
      const current = p.currentDraftId ? drafts.find((d) => d.id === p.currentDraftId) : drafts[0]
      if (current) paragraphs.push(current.content)
    }
    chapterSources.push({ title: ch.title, paragraphs })
  }
  const attachments = await repo.attachments.list(USER_ID, doc.id)
  const attachmentSources: MarkdownSource['attachments'] = []
  for (const a of attachments) {
    const drafts = await repo.drafts.listAttachmentDrafts(USER_ID, doc.id, a.type)
    const current = a.currentDraftId ? drafts.find((d) => d.id === a.currentDraftId) : drafts[0]
    attachmentSources.push({ name: a.name, content: current?.content ?? '' })
  }
  return { attachments: attachmentSources, chapters: chapterSources }
}

/**
 * 导出：docId 为空 = 全量 zip；非空 = 单篇 markdown。
 * 返回文件流（Content-Disposition 带 UTF-8 文件名）；本地无鉴权，同源/CORS localhost。
 */
app.post('/api/documents.export', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = z.object({ docId: safeId.optional() }).safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({ success: false, error: '请求参数不合法' })
  }
  const { docId } = parsed.data

  if (docId) {
    const doc = await repo.documents.get(USER_ID, docId)
    if (!doc) return c.json({ success: false, error: '文档不存在' })
    const md = docToMarkdown(await buildMarkdownSource(doc))
    const fileName = `${sanitizeFileName(doc.title)}.md`
    return c.body(new TextEncoder().encode(md), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    })
  }

  const docs = await repo.documents.list(USER_ID)
  const names = uniqueFileNames(docs)
  const files: Array<{ name: string; content: string }> = []
  for (let i = 0; i < docs.length; i++) {
    files.push({ name: names[i], content: docToMarkdown(await buildMarkdownSource(docs[i])) })
  }
  const zipBytes = buildZip(files)
  const fileName = `coeditor-docs-${new Date().toISOString().slice(0, 10)}.zip`
  return c.body(new Uint8Array(zipBytes), 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  })
})

/**
 * 导入纯文本/markdown：BYOK 非流式 AI 分章（返回切分指令）→ 原文锚点定位 → 规则分段 → 建文档。
 * 无计费（开源版免费，用户承担自己的 token 成本）；无配额（对齐开源版），仅限 10 万字。
 */
app.post('/api/documents.importText', defineRpc(
  z.object({
    title: z.string().max(200).optional(),
    templateId: safeId.optional(),
    content: z.string().min(1, 'content 不能为空'),
  }),
  async (input) => {
    const content = input.content.trim()
    if (content.length === 0) throw new Error('content 不能为空')
    if (content.length > MAX_IMPORT_CHARS) {
      throw new Error(`导入文本过长（上限 ${Math.floor(MAX_IMPORT_CHARS / 10000)} 万字），请拆分文件后重试`)
    }

    const settings = await repo.settings.get(USER_ID)
    if (!settings.apiKey) {
      throw new Error('未配置 API Key，请先在设置页面配置')
    }

    // AI 分章：结构解析失败重试一次；上游错误直接透传（可自愈文案）
    let plans: ReturnType<typeof parseChapterPlan> = null
    for (let attempt = 0; attempt <= 1; attempt++) {
      const aiJson = await aiComplete(settings, IMPORT_SYSTEM_PROMPT, content)
      plans = parseChapterPlan(aiJson)
      if (plans && plans.length > 0) break
    }
    if (!plans || plans.length === 0) {
      throw new Error('AI 未能正确拆分章节，请重试或调整文件内容')
    }

    const spans = locateChapters(content, plans)

    // 建文档（模板附件顺序与手动创建一致；默认 novel）
    const tplId = input.templateId || 'novel'
    const template = await repo.templates.get(tplId)
    if (!template) throw new Error('模板不存在')
    const now = new Date().toISOString()
    const doc: Document = {
      id: generateId(),
      userId: USER_ID,
      title: input.title?.trim() || '导入文档',
      description: '',
      templateId: tplId,
      attachmentOrder: template.attachments.map((a) => a.type),
      chapterOrder: [],
      timeCreated: now,
      timeUpdated: now,
    }
    await repo.documents.create(USER_ID, doc)

    for (const span of spans) {
      const chapter = await repo.chapters.create(USER_ID, doc.id, {
        id: generateId(),
        documentId: doc.id,
        title: span.title,
        paragraphOrder: [],
        timeCreated: new Date().toISOString(),
      })
      for (const paraText of chapterParagraphs(span, content)) {
        const paraId = generateId()
        const para = await repo.paragraphs.create(USER_ID, doc.id, chapter.id, {
          id: paraId,
          chapterId: chapter.id,
          name: '',
          currentDraftId: null,
        })
        const draft = await repo.drafts.createParagraphDraft(USER_ID, doc.id, chapter.id, paraId, generateId(), paraText)
        await repo.paragraphs.update(USER_ID, doc.id, chapter.id, paraId, { currentDraftId: draft.id })
      }
    }
    // 返回磁盘最新状态（chapters.create 已更新 document.json 的 chapterOrder，内存 doc 是初始快照）
    const saved = await repo.documents.get(USER_ID, doc.id)
    return saved
  },
))

export default app
