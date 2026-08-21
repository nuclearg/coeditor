/**
 * 模板 prompt 的 ${} 变量解析（服务端）。
 *
 * 变量约定：
 * - ${附件type}：任一附件当前内容（如 ${outline}、${worldview}），当前被审附件用自身 type 引用
 * - ${document}：全文正文（仅章节/段落，不含附件）
 * - ${currentChapter}：当前章节内容
 * - ${currentParagraph}：当前段落内容
 * - ${currentChapterPrevParagraphs}：当前章节中当前段落之前的段落内容
 *
 * 只按需加载被模板引用的变量；未提供的变量渲染为空字符串。
 */

import { repo } from '../store/index.js'
import { USER_ID } from './utils.js'

export const RESERVED_VARS = [
  'document',
  'currentChapter',
  'currentParagraph',
  'currentChapterPrevParagraphs',
] as const

/** 提取模板中的 ${name}（去重、去空白） */
export function extractVars(template: string): string[] {
  const vars: string[] = []
  const re = /\$\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const name = m[1].trim()
    if (name && !vars.includes(name)) vars.push(name)
  }
  return vars
}

/** 渲染 ${name}：ctx 未提供的变量替换为空字符串（不残留 ${} 占位符） */
export function renderPrompt(template: string, ctx: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_all, name: string) => ctx[name.trim()] ?? '')
}

export interface PromptContextInput {
  docId: string
  /** 当前审阅的附件 type（attachment 审阅场景） */
  attachmentId?: string | null
  chapterId?: string | null
  paragraphId?: string | null
  /**
   * 草稿版本 id（段落/附件场景）：会话归属的 draftVersion。
   * 提供时，当前段落/附件的内容按该草稿读取（而非当前激活草稿），
   * 保证每个版本的会话审阅的是对应版本的内容。
   */
  draftId?: string | null
}

/**
 * 按需组装模板引用的变量 → 内容。
 * 未匹配到任何实体（如附件已被删除）时对应变量为空字符串。
 */
export async function buildPromptContext(
  vars: string[],
  input: PromptContextInput,
): Promise<Record<string, string>> {
  const ctx: Record<string, string> = {}
  const wanted = new Set(vars)

  // 附件变量：除保留字外的 ${name} 都按附件 type 解析
  const attachmentVars = vars.filter((v) => !(RESERVED_VARS as readonly string[]).includes(v))
  if (attachmentVars.length > 0) {
    const attachments = await repo.attachments.list(USER_ID, input.docId)
    for (const att of attachments) {
      if (!attachmentVars.includes(att.type)) continue
      // 被审附件若有草稿版本归属，按该草稿读取；其余附件按当前激活草稿
      const byDraft = input.draftId && input.attachmentId === att.type
      ctx[att.type] = byDraft
        ? await draftContent(input.draftId!, (drafts) => drafts, input.docId, undefined, undefined, att.type)
        : await attachmentContent(input.docId, att.type, att.currentDraftId)
    }
  }

  if (wanted.has('document')) {
    ctx.document = await buildFullText(input.docId)
  }
  if (wanted.has('currentChapter') && input.chapterId) {
    ctx.currentChapter = await buildChapterText(input.docId, input.chapterId)
  }
  if (wanted.has('currentParagraph') && input.chapterId && input.paragraphId) {
    ctx.currentParagraph = input.draftId
      ? await draftContent(input.draftId, (drafts) => drafts, input.docId, input.chapterId, input.paragraphId)
      : await paragraphContent(input.docId, input.chapterId, input.paragraphId)
  }
  if (wanted.has('currentChapterPrevParagraphs') && input.chapterId && input.paragraphId) {
    ctx.currentChapterPrevParagraphs = await buildPrevParagraphs(
      input.docId, input.chapterId, input.paragraphId,
    )
  }

  return ctx
}

// === 内容组装辅助 ===

/** 附件当前激活草稿的内容 */
async function attachmentContent(
  docId: string, type: string, currentDraftId: string | null,
): Promise<string> {
  if (!currentDraftId) return ''
  const drafts = await repo.drafts.listAttachmentDrafts(USER_ID, docId, type)
  return drafts.find((d) => d.id === currentDraftId)?.content ?? ''
}

/** 段落当前激活草稿的内容 */
async function paragraphContent(
  docId: string, chapterId: string, paragraphId: string,
): Promise<string> {
  const para = await repo.paragraphs.get(USER_ID, docId, chapterId, paragraphId)
  return para ? paragraphDraftContent(docId, chapterId, para) : ''
}

/** 全文正文：`# 章节标题\n\n段落...`，章节间空行分隔（不含附件） */
async function buildFullText(docId: string): Promise<string> {
  const chapters = await repo.chapters.list(USER_ID, docId)
  const parts: string[] = []
  for (const ch of chapters) {
    parts.push(await buildChapterText(docId, ch.id))
  }
  return parts.join('\n\n')
}

/** 章节正文：`# 章节标题\n\n段落...` */
async function buildChapterText(docId: string, chapterId: string): Promise<string> {
  const chapter = await repo.chapters.get(USER_ID, docId, chapterId)
  const paras = await repo.paragraphs.list(USER_ID, docId, chapterId)
  const body = (
    await Promise.all(paras.map((p) => paragraphDraftContent(docId, chapterId, p)))
  ).join('\n\n')
  return `# ${chapter?.title ?? ''}\n\n${body}`
}

/** 当前段落之前（同章节、按段落顺序）的段落内容 */
async function buildPrevParagraphs(
  docId: string, chapterId: string, paragraphId: string,
): Promise<string> {
  const paras = await repo.paragraphs.list(USER_ID, docId, chapterId)
  const idx = paras.findIndex((p) => p.id === paragraphId)
  const prev = idx > 0 ? paras.slice(0, idx) : []
  return (await Promise.all(prev.map((p) => paragraphDraftContent(docId, chapterId, p)))).join('\n\n')
}

/** 段落当前激活草稿内容 */
async function paragraphDraftContent(
  docId: string, chapterId: string, para: { id: string; currentDraftId: string | null },
): Promise<string> {
  if (!para.currentDraftId) return ''
  const drafts = await repo.drafts.listParagraphDrafts(USER_ID, docId, chapterId, para.id)
  return drafts.find((d) => d.id === para.currentDraftId)?.content ?? ''
}

/** 按草稿 id 直接读取内容（段落或附件草稿，draft 归属的会话用它保证内容与版本一致） */
async function draftContent(
  draftId: string,
  _select: (drafts: Array<{ id: string; content: string }>) => Array<{ id: string; content: string }>,
  docId: string, chapterId?: string, paragraphId?: string, attachmentType?: string,
): Promise<string> {
  let drafts: Array<{ id: string; content: string }> = []
  if (attachmentType) {
    drafts = await repo.drafts.listAttachmentDrafts(USER_ID, docId, attachmentType)
  } else if (chapterId && paragraphId) {
    drafts = await repo.drafts.listParagraphDrafts(USER_ID, docId, chapterId, paragraphId)
  }
  return drafts.find((d) => d.id === draftId)?.content ?? ''
}
