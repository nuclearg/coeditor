export interface Document {
  id: string
  userId: string
  title: string
  description: string
  templateId: string
  attachmentOrder: string[]
  chapterOrder: string[]
  createdAt: string
  updatedAt: string
}

/** 模板中定义的一种附件类型（一个类型在文档中对应一个附件） */
export interface AttachmentDef {
  type: string        // 类型 key：outline / worldview / characters ...
  name: string | { zh: string; en: string }        // 显示名：大纲 / 世界观 / 人设（支持多语言）
  contextLabel: string | { zh: string; en: string } // 进 AI 上下文的包装标签：文章大纲 / 世界观设定
}

/** 文档模板：定义文档的附件种类 */
export interface DocumentTemplate {
  id: string
  name: string
  attachments: AttachmentDef[]
}

/** 文档附件：id 为数字主键字符串，type 为业务类型 key（同文档内唯一） */
export interface Attachment {
  id: string
  type: string
  documentId: string
  name: string
  /** 当前激活草稿；无草稿时为 null */
  currentDraftId: string | null
  createdAt: string
}

export interface AttachmentDraft {
  id: string
  attachmentId: string
  version: number
  content: string
  createdAt: string
}

export interface Chapter {
  id: string
  documentId: string
  title: string
  paragraphOrder: string[]
  createdAt: string
}

export interface Paragraph {
  id: string
  chapterId: string
  name: string
  /** 当前激活草稿；新建段落/删光草稿时为 null */
  currentDraftId: string | null
}

export interface ParagraphDraft {
  id: string
  paragraphId: string
  version: number
  content: string
  createdAt: string
}

// === Enum vocabularies (single source of truth) ===
// Constant arrays + derived unions so server (zod) and client can share one
// definition instead of each maintaining its own string literals.

/** AI 会话分桶类型 */
export const CONVERSATION_TYPES = ['casual', 'attachment_review', 'paragraph_review', 'chapter_review'] as const
export type ConversationType = (typeof CONVERSATION_TYPES)[number]

/**
 * 注意：fulltext（全文审阅）没有独立会话桶——全文审阅会话与闲聊共用
 * 'casual' 桶（按 documentId 归属文档），该行为是有意保留的。
 */

/** ai.chat 的审阅类型（决定注入的系统 prompt） */
export const REVIEW_TYPES = ['paragraph', 'attachment', 'chapter', 'fulltext', 'casual'] as const
export type ReviewType = (typeof REVIEW_TYPES)[number]

/** 审阅风格（对应 data/prompts/{style}.json） */
export const REVIEW_STYLES = ['gentle', 'strict', 'praise'] as const
export type ReviewStyle = (typeof REVIEW_STYLES)[number]

export interface AiConversation {
  id: string
  type: ConversationType
  documentId?: string
  attachmentId?: string
  /** paragraph_review 会话归属的段落 ID */
  paragraphId?: string
  chapterId?: string
  createdAt: string
}

export interface AiQuestion {
  content: string
  questionVisible: boolean
  createdAt: string
}

export interface AiAnswer {
  id: string
  content: string
  thinking: string
  model: string
  createdAt: string
}

export interface AiTurn {
  id: string
  conversationId: string
  order: number
  question: AiQuestion
  answers: AiAnswer[]
  currentAnswerIndex: number
  createdAt: string
}

// === Shared utilities ===

// Monotonic id state: millisecond timestamp + in-process counter.
let lastIdMs = 0
let idCounter = 0
// 4 base36 chars of counter space per millisecond
const ID_SEQ_MAX = 36 ** 4

/**
 * Generate a unique, strictly monotonic ID.
 *
 * Format: `<ms timestamp, base36, fixed 9 chars>_<counter, base36, fixed 4 chars>`.
 * Both parts are fixed-width, so lexicographic order always matches creation
 * order (relied upon by "latest draft" selection via filename sorting).
 */
export function generateId(): string {
  let now = Date.now()
  // Clock frozen or rewound: keep issuing ids on the last seen millisecond
  // so ordering never goes backwards.
  if (now <= lastIdMs) now = lastIdMs
  if (now === lastIdMs) {
    idCounter += 1
    if (idCounter >= ID_SEQ_MAX) {
      // Counter space exhausted for this millisecond (unreachable in practice)
      now += 1
      idCounter = 0
    }
  } else {
    idCounter = 0
  }
  lastIdMs = now
  return `${now.toString(36).padStart(9, '0')}_${idCounter.toString(36).padStart(4, '0')}`
}

// === Shared config types ===

export interface AppSettings {
  apiKey: string
  apiBaseUrl: string
  model: string
  style: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-pro',
  style: 'gentle',
}
