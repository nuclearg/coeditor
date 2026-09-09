import { strToU8, zipSync } from 'fflate'

/**
 * 导入/导出纯逻辑（无 I/O）：md 组装、文件名清洗、章节定位、段落切分。
 * 与 Web 端导入/导出实现行为对齐：
 * - 导出：附件在前、章节在后，统一 `# 标题` 一级标题；空块保留标题；段落 name 不导出；文档标题仅作文件名
 * - 导入：AI 只输出切分指令（章节/段落起点锚点），后端按原文锚点定位 + 规则兜底，正文文字零改写
 * - 段落策略：以章节为单位——正文 ≤1000 字整章一段；超过 1000 字时由 AI 给段落断点
 *   （每段约 1000 字、允许 600~1500），服务端按锚点切；AI 锚点不可用时按句号规则兜底
 */

/** 单次导入文本上限（字符）：超过直接拒绝（模型上下文限制）。 */
export const MAX_IMPORT_CHARS = 100_000

/** 段落目标长度（字）。 */
export const PARA_TARGET_LEN = 1_000
/** 断句宽松下限：句末累计 ≥ 该长度即可断（接近目标即可，避免 200 字一小段）。 */
const PARA_MIN_LEN = 600
/** 无合适句末标点时的硬上限（超过强制断，防止单段过长）。 */
const PARA_HARD_LEN = 1_600
/** 碎段合并阈值：短于此的段落并入前一段。 */
const PARA_SLIVER_LEN = 200

const SENTENCE_END = new Set(['。', '！', '？', '!', '?'])
const CLOSING_CHARS = new Set(['”', '』', '」', '’', '》', '）', '】', ']', '"', "'"])

/**
 * 分章 + 分段落系统 prompt：只输出 JSON 切分指令；
 * startHint 必须为原文逐字摘录（正文第一句开头 10-20 字），内容零改写、零重排。
 */
export const IMPORT_SYSTEM_PROMPT = `你是文档结构分析器。用户会提供一篇完整的文本（小说/文章），你的任务是先把它切分为章节，再把每个章节的正文切分为段落。
要求：
1. 识别文本中的章节标题（如"第一章""第X章""序章""番外"等）；没有明确标题的文本，按情节/场景自然分章。
2. 只输出 JSON（不要输出任何其他文字或解释），格式：
   {"chapters":[{"title":"章节标题","startHint":"该章正文第一句开头的原文摘录","paragraphs":[{"startHint":"该段第一句开头的原文摘录"}]}]}
3. startHint 必须摘录正文第一句的开头 10-20 字，必须与原文逐字一致，禁止改写、概括、翻译；每章 paragraphs 的第一条与该章 startHint 相同。
4. title 可以按原文标题或由你生成（如"第一章"），但所有 startHint 必须来自原文。
5. chapters 严格按文本顺序排列；全文必须被各章节完整覆盖，不要遗漏任何文本。
6. 段落切分：以"一个段落 ≈ 1000 字（允许 600~1500 字）"为目标——过短的自然段合并进相邻段落，过长的段在语义完整处断开（优先选在句号/问号/叹号等句末后）。每个段落用其第一句开头的 10-20 字作为 startHint 锚点，AI 只在段落边界做判断，绝不改动文字本身。
7. 若某章正文总字数不足 1000 字，该章只保留一个段落（paragraphs 只有一条）。
8. 每章段落数尽量不超过 100 个：若某章按此规则会超过 100 段，请把该章再拆成多章。`

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

/** AI 输出的章节计划（paragraphHints：AI 建议的段落起点锚点，顺序排列；可为空走规则兜底）。 */
export interface ChapterPlan {
  title: string
  startHint: string
  paragraphHints: string[]
}

/** 定位后的章节区间 [start, end) 字符偏移；hints 为该章 AI 段落锚点（顺序排列）。 */
export interface ChapterSpan {
  title: string
  start: number
  end: number
  hints: string[]
}

/** AI 偶发在 JSON 外包 markdown 代码围栏（```json ... ```）：先清洗再解析。 */
function stripJsonFence(s: string): string {
  let json = s.trim()
  if (json.startsWith('```')) {
    const firstNl = json.indexOf('\n')
    json = (firstNl > 0 ? json.slice(firstNl + 1) : json.replace(/^```/, '')).trim()
    if (json.endsWith('```')) json = json.slice(0, -3).trim()
  }
  return json
}

/** 解析 AI 返回的 JSON 切分指令；结构不符返回 null（调用方决定重试/报错）。 */
export function parseChapterPlan(aiJson: string): ChapterPlan[] | null {
  try {
    const root = JSON.parse(stripJsonFence(aiJson))
    const chapters = root?.chapters
    if (!Array.isArray(chapters) || chapters.length === 0) return null
    const plans: ChapterPlan[] = []
    for (const c of chapters) {
      const title = typeof c?.title === 'string' ? c.title.trim() : ''
      const hint = typeof c?.startHint === 'string' ? c.startHint.trim() : ''
      if (!title || !hint) return null
      const paragraphHints: string[] = []
      if (Array.isArray(c?.paragraphs)) {
        for (const p of c.paragraphs) {
          const ph = typeof p?.startHint === 'string' ? p.startHint.trim() : ''
          if (ph.length > 0) paragraphHints.push(ph)
        }
      }
      plans.push({ title, startHint: hint, paragraphHints })
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
  const spans: Array<{ title: string; start: number; hints: string[] }> = []
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
    spans.push({ title: plan.title, start, hints: plan.paragraphHints })
    searchFrom = start + Math.max(1, plan.startHint.length)
  }
  const result: ChapterSpan[] = []
  for (let i = 0; i < spans.length; i++) {
    const end = i + 1 < spans.length ? Math.min(spans[i + 1].start, content.length) : content.length
    if (spans[i].start < end) {
      result.push({ title: spans[i].title, start: spans[i].start, end, hints: spans[i].hints })
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

// ==== 段落切分：AI 锚点优先，规则兜底 ====

/**
 * 章节正文 + AI 段落锚点 → 段落列表：
 * 1) 剔除以标题开头的行（标题不是正文段落）
 * 2) 正文 ≤1000 字 → 整章一段（不切）
 * 3) 否则按 AI 锚点（段落起点原文摘录）在原正文中顺序定位、切分；
 *    锚点不可用 → 按句号规则切（目标 ≈1000 字）
 * 4) 碎段并入前段、过长段规则重切；段落内部空白行/换行归一（正文文字零改写）
 */
export function chapterParagraphs(span: ChapterSpan, content: string): string[] {
  const text = content.slice(span.start, span.end)
  const body = dropFirstLineIf(text, span.title)
  const whole = normalizeParagraph(body)
  if (whole.length === 0) return []
  if (whole.length <= PARA_TARGET_LEN) return [whole] // 章节不足 1000 字：整章一段

  const cuts = locateParagraphCuts(body, span.hints ?? [])
  if (cuts.length === 0) return splitByParagraphTarget(whole) // AI 锚点不可用：规则兜底

  const paras: string[] = []
  let prev = 0
  for (const cut of [...cuts, body.length]) {
    const p = normalizeParagraph(body.slice(prev, cut))
    if (p.length > 0) paras.push(p)
    prev = cut
  }
  return refineParagraphs(paras)
}

/** 段落起点锚点定位：在原正文（含原换行/空行）上顺序 indexOf，返回内部切点数组。 */
export function locateParagraphCuts(body: string, hints: string[]): number[] {
  const cuts: number[] = []
  let cursor = 0
  let lastCut = -1
  for (const h of hints) {
    if (h.length === 0) continue
    const pos = body.indexOf(h, cursor)
    if (pos < 0) continue
    if (pos > 0 && pos > lastCut) {
      cuts.push(pos)
      lastCut = pos
    }
    cursor = pos + Math.max(1, h.length)
  }
  return cuts
}

/** 段落文本规范化：删空行/行首尾空白；行间拼接（CJK 直接连、ASCII 相邻补空格）。 */
export function normalizeParagraph(text: string): string {
  let out = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (out.length > 0 && needsSpace(out[out.length - 1], line[0])) out += ' '
    out += line
  }
  return out
}

function dropFirstLineIf(text: string, title: string): string {
  const t = title.trim()
  if (t.length === 0) return text
  let i = 0
  while (i < text.length) {
    const nl = text.indexOf('\n', i)
    const lineEnd = nl < 0 ? text.length : nl
    const line = text.slice(i, lineEnd).trim()
    if (line.length > 0) {
      if (line === t) return nl < 0 ? '' : text.slice(nl + 1)
      return text
    }
    i = nl < 0 ? text.length : nl + 1
  }
  return text
}

function needsSpace(a: string, b: string): boolean {
  return /[A-Za-z0-9]/.test(a) && /[A-Za-z0-9]/.test(b)
}

/** 碎段并入前段、过长段按规则重切；至多两轮保证不残留过长/过碎段落。 */
function refineParagraphs(paras: string[]): string[] {
  let cur = paras
  for (let round = 0; round < 2; round++) {
    const expanded: string[] = []
    for (const p of cur) {
      if (p.length > PARA_HARD_LEN) {
        for (const q of splitByParagraphTarget(p)) expanded.push(q)
      } else {
        expanded.push(p)
      }
    }
    const merged: string[] = []
    for (const p of expanded) {
      if (merged.length > 0 && p.length < PARA_SLIVER_LEN) {
        merged[merged.length - 1] = appendText(merged[merged.length - 1], p)
      } else {
        merged.push(p)
      }
    }
    cur = merged
  }
  return cur
}

/**
 * 按目标长度（≈1000 字）的句号规则切段：句末（。！？!?，可带闭合引号）累计 ≥600 断段，
 * 无句末标点累计 ≥1600 强制断段。
 */
export function splitByParagraphTarget(text: string): string[] {
  if (text.length <= PARA_TARGET_LEN) return [text]
  const chars = Array.from(text)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    cur += ch
    if (cur.length >= PARA_HARD_LEN) {
      out.push(cur)
      cur = ''
      continue
    }
    if (cur.length >= PARA_MIN_LEN && SENTENCE_END.has(ch)) {
      while (i + 1 < chars.length && CLOSING_CHARS.has(chars[i + 1])) {
        cur += chars[i + 1]
        i++
      }
      out.push(cur)
      cur = ''
    }
  }
  if (cur.length > 0) out.push(cur)

  const merged: string[] = []
  for (const p of out) {
    if (merged.length > 0 && p.length < PARA_SLIVER_LEN) {
      merged[merged.length - 1] = appendText(merged[merged.length - 1], p)
    } else {
      merged.push(p)
    }
  }
  return merged.length > 0 ? merged : out
}

function appendText(a: string, b: string): string {
  if (a.length > 0 && b.length > 0 && needsSpace(a[a.length - 1], b[0])) return `${a} ${b}`
  return a + b
}
