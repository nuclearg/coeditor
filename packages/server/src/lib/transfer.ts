import { strToU8, zipSync } from 'fflate'

/**
 * 导入/导出纯逻辑（无 I/O）：md 组装、文件名清洗、章节定位、段落切分。
 * 与 SaaS（Java ExportManager/ImportManager）行为对齐：
 * - 导出：附件在前、章节在后，统一 `# 标题` 一级标题；空块保留标题；段落 name 不导出；文档标题仅作文件名
 * - 导入：AI 只输出切分指令（title + startHint），后端按原文锚点定位 + 规则分段，内容零改写
 */

/** 单次导入文本上限（字符）：超过直接拒绝（模型上下文限制）。 */
export const MAX_IMPORT_CHARS = 100_000

/** 分章系统 prompt：只输出 JSON 切分指令，startHint 必须为原文逐字摘录。 */
export const IMPORT_SYSTEM_PROMPT = `你是文档结构分析器。用户会提供一篇完整的文本（小说/文章），你的任务是把它切分为章节。
要求：
1. 识别文本中的章节标题（如"第一章""第X章""序章""番外"等）；没有明确标题的文本，按情节/场景自然分章。
2. 只输出 JSON（不要输出任何其他文字或解释），格式：
   {"chapters":[{"title":"章节标题","startHint":"该章正文第一句开头的原文摘录"}]}
3. startHint 必须摘录该章正文第一句的开头字符（10-20 字，不含章节标题行），必须与原文逐字一致，禁止改写、概括、翻译。
4. title 可以按原文标题或由你生成（如"第一章"），但 startHint 必须来自原文。
5. chapters 严格按文本顺序排列；全文必须被各章节完整覆盖，不要遗漏任何文本。`

/** 导出源数据（路由层从 repo 组装后传入，本模块保持纯函数）。 */
export interface MarkdownSource {
  /** 附件（按 attachmentOrder 顺序）：名称 + 当前草稿内容（无草稿为空串）。 */
  attachments: Array<{ name: string; content: string }>
  /** 章节（按 chapterOrder 顺序）：标题 + 各段落当前内容。 */
  chapters: Array<{ title: string; paragraphs: string[] }>
}

// ==== 导出 ====

/**
 * 组装单篇 markdown：附件在前、章节在后，`# 标题`，标题后直接内容、块间空行；
 * 空附件/空章节保留空标题；段落间空行分隔；尾部单个换行。
 */
export function docToMarkdown(source: MarkdownSource): string {
  const blocks: string[] = []
  for (const a of source.attachments) {
    const content = a.content.trim()
    blocks.push(content.length > 0 ? `# ${a.name}\n${content}` : `# ${a.name}`)
  }
  for (const ch of source.chapters) {
    const paras = ch.paragraphs.map((p) => p.trim()).filter((p) => p.length > 0)
    const block = paras.length > 0 ? `# ${ch.title}\n${paras.join('\n\n')}` : `# ${ch.title}`
    blocks.push(block)
  }
  const md = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  return md.length > 0 ? md + '\n' : ''
}

/** 文件名清洗：替换 Windows/跨平台非法字符与控制字符；空结果兜底 untitled。 */
export function sanitizeFileName(title: string): string {
  const s = (title ?? '').replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, '_').trim()
  return s.length > 0 ? s : 'untitled'
}

/** 全量导出文件名：重名自动加 (n)。 */
export function uniqueFileNames(docs: Array<{ title: string }>): string[] {
  const counts = new Map<string, number>()
  return docs.map((d) => {
    const base = sanitizeFileName(d.title)
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)
    return n === 1 ? `${base}.md` : `${base} (${n - 1}).md`
  })
}

/** zip 打包（fflate，UTF-8 文件名）。 */
export function buildZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    entries[f.name] = strToU8(f.content)
  }
  return zipSync(entries)
}

// ==== 导入：AI 切分指令解析 + 章节定位 + 段落切分 ====

/** AI 输出的章节计划。 */
export interface ChapterPlan {
  title: string
  startHint: string
}

/** 定位后的章节区间 [start, end) 字符偏移。 */
export interface ChapterSpan {
  title: string
  start: number
  end: number
}

/** 解析 AI 返回的 JSON 切分指令；结构不符返回 null（调用方决定重试/报错）。 */
export function parseChapterPlan(aiJson: string): ChapterPlan[] | null {
  try {
    const root = JSON.parse(aiJson)
    const chapters = root?.chapters
    if (!Array.isArray(chapters) || chapters.length === 0) return null
    const plans: ChapterPlan[] = []
    for (const c of chapters) {
      const title = typeof c?.title === 'string' ? c.title.trim() : ''
      const hint = typeof c?.startHint === 'string' ? c.startHint.trim() : ''
      if (!title || !hint) return null
      plans.push({ title, startHint: hint })
    }
    return plans
  } catch {
    return null
  }
}

/**
 * 章节边界定位：从上一锚点之后搜索 startHint 原文子串，并回溯到本章起点——
 * startHint 定位的是章正文第一句，其上的空行跳过、与章节标题一致的行归本章（从该行行首起）；
 * 锚点失配用上一边界兜底（内容不丢）；空区间章节跳过。
 */
export function locateChapters(content: string, plans: ChapterPlan[]): ChapterSpan[] {
  const spans: Array<{ title: string; start: number }> = []
  let searchFrom = 0
  for (const plan of plans) {
    let start = content.indexOf(plan.startHint, searchFrom)
    if (start < 0) {
      start = searchFrom
    } else {
      start = backtrackToChapterStart(content, start, plan.title)
    }
    if (spans.length > 0 && start < spans[spans.length - 1].start) {
      continue // 回退到已覆盖区间：该计划无效
    }
    spans.push({ title: plan.title, start })
    searchFrom = start + Math.max(1, plan.startHint.length)
  }
  const result: ChapterSpan[] = []
  for (let i = 0; i < spans.length; i++) {
    const end = i + 1 < spans.length ? Math.min(spans[i + 1].start, content.length) : content.length
    if (spans[i].start < end) {
      result.push({ title: spans[i].title, start: spans[i].start, end })
    }
  }
  return result
}

/**
 * 从 start 回溯到本章起点：先定位到所在行行首，再逐行向上——
 * 空行跳过；某行 strip 后与章节标题一致则停在该行行首（标题行归本章）；
 * 否则停在当前行首（startHint 所在行）。
 */
export function backtrackToChapterStart(content: string, start: number, title: string): number {
  let lineStart = start
  while (lineStart > 0 && content.charAt(lineStart - 1) !== '\n') lineStart--
  while (lineStart > 0) {
    let prev = lineStart - 1
    while (prev > 0 && content.charAt(prev - 1) !== '\n') prev--
    const prevLine = content.slice(prev, lineStart - 1).trim()
    if (prevLine.length === 0) {
      lineStart = prev // 空行：继续向上
    } else if (prevLine === title) {
      return prev // 标题行归本章：边界推到标题行首
    } else {
      return lineStart
    }
  }
  return lineStart
}

/** 章节段落：规则切分后剔除章节标题行（AI 给的 title 与原文首行一致时，该行是标题而非正文）。 */
export function chapterParagraphs(span: ChapterSpan, content: string): string[] {
  const paragraphs = splitParagraphs(content.slice(span.start, span.end))
  if (paragraphs.length > 0 && paragraphs[0] === span.title.trim()) {
    return paragraphs.slice(1)
  }
  return paragraphs
}

/** 段落切分：空行（\n 空白 \n）分自然段，块内单换行保留为段内软换行；全程无空行且单块过长时按句号断句。 */
export function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const t = block.trim()
    if (t.length > 0) paragraphs.push(t)
  }
  if (paragraphs.length === 1 && paragraphs[0].length > FALLBACK_SENTENCE_LEN) {
    return splitBySentence(paragraphs[0])
  }
  return paragraphs
}

const FALLBACK_SENTENCE_LEN = 5_000

/** 句号断句：句末（。！？!?）后且长度 ≥200 断段；无标点长文本每 2000 字兜底断段。 */
export function splitBySentence(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of text) {
    cur += ch
    const sentenceEnd = ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?'
    if ((sentenceEnd && cur.length >= 200) || cur.length >= 2000) {
      const t = cur.trim()
      if (t.length > 0) out.push(t)
      cur = ''
    }
  }
  const t = cur.trim()
  if (t.length > 0) out.push(t)
  return out
}
