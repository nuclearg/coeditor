import { strToU8, zipSync } from 'fflate'

/**
 * 导入/导出纯逻辑（无 I/O）：md 组装、文件名清洗、AI 切分指令解析、锚点切分。
 * - 导出：附件在前、章节在后，统一 `# 标题` 一级标题；空块保留标题；文档标题仅作文件名
 * - 导入：AI 只输出章节/段落的起始锚点（原文逐字摘录），服务端按锚点把原文切成
 *   章节 → 段落；正文零改写、零重排，段落拼接即原文
 * - 锚点归属：锚点是它开启的那一章/段的第一个字符；原文已有的标识行（`# 章`、`## 段`）
 *   必须整行作为锚点，不得落在上一段末尾
 */

/** 单次导入文本上限（字符）：超过直接拒绝（模型上下文限制）。 */
export const MAX_IMPORT_CHARS = 100_000

/**
 * 分章 + 分段落系统 prompt：只输出 JSON 切分指令，锚点必须为原文逐字摘录。
 * 结构化标识（`# 章`、`## 段`）优先：有标识时按标识行对齐，无标识区域才按情节/视角划分。
 */
export const IMPORT_SYSTEM_PROMPT = `# 角色设定
你是一位资深的文本结构分析专家，擅长对小说、叙事类文本进行逻辑章节划分和段落切分。

# 任务目标
请对下面提供的文本进行结构化拆解，输出 JSON 格式的章节与段落配置信息。

# 输出规则（核心要求）
1. **禁止使用数字下标（如 start: 0, end: 500）**。因为中英文混合文本的字符计数极易出现偏差，无法直接用于 substring 截取。
2. **必须使用文本锚点（marker）**：使用原文中**确切存在的连续字符串**作为切分边界，与原文逐字一致（含 #、空格、标点），禁止改写、概括、翻译。
3. **边界归属**：标记属于它**开启**的那一章/段；start 必须是该章/段在原文中的**第一个字符**——不得从标记之后起算、不得截断标记、不得把标记留给上一章/段。
4. 只输出 JSON 本身（不要 markdown 围栏、不要任何解释），我将会用 JSON.parse() 直接解析。

# 结构化标识优先（最高优先级，必须先满足本节，再看下面的指南）
- 原文中的**章节标识行**（如 \`# 第一章\`、\`# 序章\`）：章 start 必须逐字等于该标识行**整行**。
- 原文中的**段落标识行**（如 \`## 老板.3\`、\`### 小节名\`，或 \`1.\`、\`一、\` 等编号行）：
  - 每个标识行开启一个新段落，段落边界必须与标识行对齐；
  - 该段 start 必须逐字等于这条标识行**整行**（含 \`##\` 等前缀与空格）；
  - **不得**在同一标识行内部再切分（一个标识 = 一个段落，标识与其后的正文属于同一段）；
  - **不得**把标识行放到上一段的末尾。
- 只有在**没有任何标识**的文本区域，才按下面的指南自行划分。

# 切分逻辑指南（仅适用于无标识区域）
- **章节划分**：优先按文中明显的大标题区分；若确实没有显式标题，再按叙事逻辑（场景转换、时间跳跃等）划分。
- **段落划分**：按情节或人物视角的节奏，把情节连贯、字数相近（约 800~1200 字）的片段合并为一个逻辑段落，确保语义完整。
- 段落命名（\`title\` 字段）：用简短的 4~10 个中文字概括该段落的中心情节（如“初见与试探”）。

# 输出 JSON 格式（严格按照此 Schema）
{
  "chapters": [
    {
      "title": "章节标题（不超过 20 个字）",
      "start": "章节起始标识：原文标识行整行，如「# 第一章」",
      "paragraphs": [
        { "title": "段落标题（4~10 字）", "start": "段落起始标识：该段第一个字符，原文有段落标识行时必须整行包含，如「## 老板.3」" }
      ]
    }
  ]
}`

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

// ==== 导入：AI 切分指令解析 + 锚点切分 ====

/** AI 输出的段落计划：段落标题 + 该段起始锚点（原文逐字摘录，锚点属于本段）。 */
export interface ParagraphPlan {
  title: string
  start: string
}

/** AI 输出的章节计划：章节标题 + 章起始锚点 + 各段落计划（顺序排列）。 */
export interface ChapterPlan {
  title: string
  start: string
  paragraphs: ParagraphPlan[]
}

/** 切分后的段落：标题 + 原文内容（零改写）。 */
export interface ParagraphSpan {
  title: string
  content: string
}

/** 切分后的章节：标题 + 段落（互斥且拼接即该章原文）。 */
export interface ChapterSpan {
  title: string
  paragraphs: ParagraphSpan[]
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

/**
 * 解析 AI 返回的 `{ chapters: [...] }` 切分配置；结构不符返回 null（调用方决定重试/报错）。
 * 章节需有 title + start；段落需有 start（title 可空）。
 */
export function parseChapterPlan(aiJson: string): ChapterPlan[] | null {
  try {
    const root = JSON.parse(stripJsonFence(aiJson))
    const chapters = root?.chapters
    if (!Array.isArray(chapters) || chapters.length === 0) return null
    const plans: ChapterPlan[] = []
    for (const c of chapters) {
      const title = typeof c?.title === 'string' ? c.title.trim() : ''
      const start = typeof c?.start === 'string' ? c.start : ''
      if (title.length === 0 || start.length === 0) return null
      const paragraphs: ParagraphPlan[] = []
      if (Array.isArray(c?.paragraphs)) {
        for (const p of c.paragraphs) {
          const pStart = typeof p?.start === 'string' ? p.start : ''
          if (pStart.length === 0) continue
          paragraphs.push({ title: typeof p?.title === 'string' ? p.title.trim() : '', start: pStart })
        }
      }
      plans.push({ title, start, paragraphs })
    }
    return plans
  } catch {
    return null
  }
}

/**
 * 按锚点把原文切成章节 → 段落（互斥、拼接即原文，正文零改写）。
 * 从后往前定位：每章占据 [该章 start, 下一章 start) 的原文块，第一章 start 之前的开头并入第一章；
 * 章内同样从后往前按段落锚点切，段落锚点之前未被覆盖的头部并入该章第一段。
 * 锚点未命中原文（AI 摘录有误）时抛错，由调用方决定重试或报错；不做规则兜底切分。
 */
export function splitContent(content: string, plans: ChapterPlan[]): ChapterSpan[] {
  const chunks: string[] = []
  let rest = content
  for (let i = plans.length - 1; i >= 0; i--) {
    const at = rest.lastIndexOf(plans[i].start)
    if (at < 0) throw new Error(`章节锚点未命中原文: ${plans[i].start.slice(0, 30)}`)
    chunks.unshift(rest.slice(at))
    rest = rest.slice(0, at)
  }
  if (rest.length > 0 && chunks.length > 0) chunks[0] = rest + chunks[0]
  return plans.map((plan, i) => splitChapter(plan, chunks[i]))
}

/** 章内按段落锚点切分；段落锚点之前未被覆盖的头部并入第一段；无段落锚点则整章一段。 */
function splitChapter(plan: ChapterPlan, raw: string): ChapterSpan {
  const paragraphs: ParagraphSpan[] = []
  let head = raw
  for (let j = plan.paragraphs.length - 1; j >= 0; j--) {
    const { title, start } = plan.paragraphs[j]
    const at = head.lastIndexOf(start)
    if (at < 0) throw new Error(`段落锚点未命中原文: ${start.slice(0, 30)}`)
    paragraphs.unshift({ title, content: head.slice(at) })
    head = head.slice(0, at)
  }
  if (head.length > 0) {
    if (paragraphs.length === 0) paragraphs.push({ title: plan.title, content: head })
    else paragraphs[0] = { title: paragraphs[0].title, content: head + paragraphs[0].content }
  }
  if (paragraphs.length === 0) paragraphs.push({ title: plan.title, content: raw })
  return { title: plan.title, paragraphs }
}
