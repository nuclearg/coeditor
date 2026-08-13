/**
 * Repository interface — the abstraction layer between routes and storage.
 *
 * Current implementation: FileRepository (JSON files on disk).
 * Future: can be swapped to a DB-backed implementation without touching routes.
 */

import type {
  Document, Chapter, Paragraph, ParagraphDraft,
  Attachment, AttachmentDraft, AiConversation, AiTurn, AiAnswer,
  AppSettings, ConversationType, DocumentTemplate,
} from '@coeditor/shared'

// === Document ===

export interface DocumentRepo {
  list(userId: string): Promise<Document[]>
  get(userId: string, docId: string): Promise<Document | null>
  create(userId: string, doc: Document): Promise<Document>
  update(userId: string, docId: string, data: Partial<Pick<Document, 'title' | 'description'>>): Promise<Document>
  delete(userId: string, docId: string): Promise<void>
  reorderChapters(userId: string, docId: string, chapterOrder: string[]): Promise<void>
}

// === Chapter ===

export interface ChapterRepo {
  list(userId: string, docId: string): Promise<Chapter[]>
  get(userId: string, docId: string, chapterId: string): Promise<Chapter | null>
  create(userId: string, docId: string, chapter: Chapter): Promise<Chapter>
  update(userId: string, docId: string, chapterId: string, data: Partial<Pick<Chapter, 'title'>>): Promise<Chapter>
  delete(userId: string, docId: string, chapterId: string): Promise<void>
}

// === Paragraph ===

export interface ParagraphRepo {
  list(userId: string, docId: string, chapterId: string): Promise<Paragraph[]>
  get(userId: string, docId: string, chapterId: string, paragraphId: string): Promise<Paragraph | null>
  create(userId: string, docId: string, chapterId: string, para: Paragraph): Promise<Paragraph>
  update(userId: string, docId: string, chapterId: string, paragraphId: string, data: Partial<Pick<Paragraph, 'name' | 'currentDraftId'>>): Promise<Paragraph>
  delete(userId: string, docId: string, chapterId: string, paragraphId: string): Promise<void>
  reorder(userId: string, docId: string, chapterId: string, paragraphOrder: string[]): Promise<void>
}

// === Drafts ===

export interface DraftRepo {
  // Paragraph drafts
  listParagraphDrafts(userId: string, docId: string, chapterId: string, paragraphId: string): Promise<ParagraphDraft[]>
  createParagraphDraft(userId: string, docId: string, chapterId: string, paragraphId: string, draftId: string, content: string): Promise<ParagraphDraft>
  getParagraphDraft(userId: string, docId: string, chapterId: string, paragraphId: string, draftId: string): Promise<ParagraphDraft | null>
  deleteParagraphDraft(userId: string, docId: string, chapterId: string, paragraphId: string, draftId: string): Promise<void>

  // Attachment drafts
  listAttachmentDrafts(userId: string, docId: string, type: string): Promise<AttachmentDraft[]>
  createAttachmentDraft(userId: string, docId: string, type: string, draftId: string, content: string): Promise<AttachmentDraft>
  getAttachmentDraft(userId: string, docId: string, type: string, draftId: string): Promise<AttachmentDraft | null>
  deleteAttachmentDraft(userId: string, docId: string, type: string, draftId: string): Promise<void>
}

// === Attachment ===

export interface AttachmentRepo {
  list(userId: string, docId: string): Promise<Attachment[]>
  get(userId: string, docId: string, type: string): Promise<Attachment | null>
  /** 按类型幂等创建（已存在则返回现有），并生成初始空草稿 */
  ensure(userId: string, docId: string, type: string, name: string): Promise<Attachment>
  update(userId: string, docId: string, type: string, data: { name?: string; currentDraftId?: string | null }): Promise<Attachment>
  delete(userId: string, docId: string, type: string): Promise<void>
}

// === Template ===

export interface TemplatesRepo {
  list(): Promise<DocumentTemplate[]>
  get(templateId: string): Promise<DocumentTemplate | null>
}

// === Conversation ===

export interface ConversationRepo {
  list(userId: string, docId: string, parentId: string, type: ConversationType): Promise<AiConversation[]>
  get(userId: string, docId: string, convId: string): Promise<AiConversation | null>
  create(userId: string, docId: string, conv: AiConversation): Promise<AiConversation>
  delete(userId: string, docId: string, convId: string): Promise<void>
}

// === Turn ===

export interface TurnRepo {
  list(userId: string, docId: string, convId: string): Promise<AiTurn[]>
  get(userId: string, docId: string, convId: string, turnId: string): Promise<AiTurn | null>
  create(userId: string, docId: string, convId: string, turn: AiTurn): Promise<AiTurn>
  update(userId: string, docId: string, convId: string, turnId: string, turn: AiTurn): Promise<AiTurn>
  delete(userId: string, docId: string, convId: string, turnId: string): Promise<void>

  /**
   * Atomically add or update an answer inside a turn.
   * `makeCurrent` (default true) controls whether a PUSHED answer becomes
   * the selected one; cancelled-stream drains pass false.
   */
  addAnswer(userId: string, docId: string, convId: string, turnId: string, answer: AiAnswer, existingAnswerId?: string, makeCurrent?: boolean): Promise<AiAnswer>

  /** Atomically update the selected answer index. */
  updateAnswerIndex(userId: string, docId: string, convId: string, turnId: string, answerIndex: number): Promise<AiTurn>

  /** Find a turn by ID across all conversations (fallback when convId is unknown). */
  findById(userId: string, docId: string, turnId: string): Promise<AiTurn | null>
}

// === Settings ===

export interface PromptFile {
  fulltextReview: string
  chapterReview: string
  attachmentReview: string
  paragraphReview: string
  casual: string
}

export interface SettingsRepo {
  get(userId: string): Promise<AppSettings>
  update(userId: string, data: Partial<AppSettings>): Promise<AppSettings>
}

// === Aggregate Repository ===

export interface Repository {
  documents: DocumentRepo
  chapters: ChapterRepo
  paragraphs: ParagraphRepo
  drafts: DraftRepo
  attachments: AttachmentRepo
  templates: TemplatesRepo
  conversations: ConversationRepo
  turns: TurnRepo
  settings: SettingsRepo

  /**
   * One-time initialization on server startup.
   * Ensures user directory and default config exist.
   */
  initialize(): Promise<void>

  /** Load AI review prompt for a given style */
  loadPrompt(style: string): Promise<PromptFile>
}
