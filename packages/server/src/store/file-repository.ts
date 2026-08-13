/**
 * FileRepository — file-system-based implementation of the Repository interface.
 *
 * Single-user system. Writes are atomic (tmp + rename), so files are never
 * corrupted even if a write fails midway.
 * Data is stored as JSON files and Markdown files in a hierarchical directory structure.
 */

import type {
  Document, Chapter, Paragraph, ParagraphDraft,
  Attachment, AttachmentDraft, AiConversation, AiTurn, AiAnswer,
  AppSettings, ConversationType, DocumentTemplate,
} from '@coeditor/shared'
import { generateId, DEFAULT_SETTINGS, REVIEW_STYLES } from '@coeditor/shared'
import { USER_ID } from '../lib/utils.js'
import {
  readJSONOrNull, readJSONOrThrow, writeJSON,
  readFileOrNull, writeFile, deleteFile, deleteDir,
  listDir, exists, ensureDir,
} from './file-io.js'
import {
  userConfigPath, userDocsDir,
  documentPath, docDir,
  attachmentDir, attachmentFilePath, attachmentDraftMdPath,
  templatesDir, templateFilePath,
  chapterDir, chapterFilePath,
  paragraphDir, paragraphFilePath, paragraphDraftMdPath,
  conversationsDir, conversationDir, conversationFilePath, turnFilePath,
  promptFilePath,
} from './file-paths.js'
import type {
  Repository, DocumentRepo, ChapterRepo, ParagraphRepo,
  DraftRepo, AttachmentRepo, TemplatesRepo, ConversationRepo, TurnRepo, SettingsRepo,
  PromptFile,
} from './types.js'

// === Utility ===

function parseIdCreated(id: string): string | null {
  // Legacy format: <14-digit local timestamp>_ (YYYYMMDDHHMMSS).
  // The digits encode LOCAL time — construct a local Date and let
  // toISOString() do the local→UTC conversion (hard-appending 'Z' would
  // shift legacy createdAt by one timezone offset).
  const legacy = id.match(/^(\d{14})_/)
  if (legacy) {
    const digits = legacy[1]
    const y = Number(digits.slice(0, 4))
    const m = Number(digits.slice(4, 6))
    const d = Number(digits.slice(6, 8))
    const h = Number(digits.slice(8, 10))
    const min = Number(digits.slice(10, 12))
    const s = Number(digits.slice(12, 14))
    const date = new Date(y, m - 1, d, h, min, s)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString()
  }
  // Current format: <base36 millisecond timestamp>_<counter> (see generateId)
  const match = id.match(/^([0-9a-z]+)_/)
  if (!match) return null
  const ms = parseInt(match[1], 36)
  const date = new Date(ms)
  if (!Number.isFinite(ms) || Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

/**
 * Shared reorder validation for chapters (documents.reorderChapters) and
 * paragraphs (paragraphs.reorder).
 *
 * The caller passes the ids that ACTUALLY exist on disk as `existingIds`
 * (order arrays may carry "ghost" ids whose files were lost/corrupted).
 * Ghost ids are filtered out of the incoming order instead of failing
 * validation — otherwise one lost file would deadlock reordering for that
 * document forever. Callers write the returned cleaned order back, which
 * self-heals the stored order.
 */
function validateReorderIds(existingIds: string[], incomingIds: string[], fieldLabel: string, entityLabel: string): string[] {
  if (new Set(incomingIds).size !== incomingIds.length) {
    throw new Error(`${fieldLabel} 包含重复的${entityLabel} ID`)
  }
  const existing = new Set(existingIds)
  const cleaned = incomingIds.filter((id) => existing.has(id))
  if (cleaned.length !== existing.size || ![...existing].every((id) => cleaned.includes(id))) {
    throw new Error(`${fieldLabel} 必须包含所有现有${entityLabel} ID`)
  }
  return cleaned
}

// === Documents ===

class FileDocumentRepo implements DocumentRepo {
  async list(userId: string): Promise<Document[]> {
    const entries = await listDir(userDocsDir(userId))
    const documents = (await Promise.all(
      entries.map((entry) => readJSONOrNull<Document>(documentPath(userId, entry)))
    )).filter(Boolean) as Document[]

    documents.sort((a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    )
    return documents
  }

  async get(userId: string, docId: string): Promise<Document | null> {
    return readJSONOrNull<Document>(documentPath(userId, docId))
  }

  async create(userId: string, doc: Document): Promise<Document> {
    await writeJSON(documentPath(userId, doc.id), doc)
    return doc
  }

  async update(userId: string, docId: string, data: Partial<Pick<Document, 'title' | 'description'>>): Promise<Document> {
    const filePath = documentPath(userId, docId)
    const existing = await readJSONOrThrow<Document>(filePath, '文档不存在')
    const updated: Document = {
      ...existing,
      title: data.title ?? existing.title,
      description: data.description ?? existing.description,
      updatedAt: new Date().toISOString(),
    }
    await writeJSON(filePath, updated)
    return updated
  }

  async delete(userId: string, docId: string): Promise<void> {
    const dirPath = docDir(userId, docId)
    if (!(await exists(dirPath))) throw new Error('文档不存在')
    await deleteDir(dirPath)
  }

  async reorderChapters(userId: string, docId: string, chapterOrder: string[]): Promise<void> {
    const filePath = documentPath(userId, docId)
    const doc = await readJSONOrThrow<Document>(filePath, '文档不存在')
    // Baseline = ids that actually exist on disk. Ghost ids (order entries
    // whose chapter file was lost/corrupted) are filtered out by
    // validateReorderIds, and the cleaned order is written back below —
    // self-healing instead of a permanent reorder deadlock.
    const presentIds: string[] = []
    for (const id of doc.chapterOrder || []) {
      if (await exists(chapterFilePath(userId, docId, id))) presentIds.push(id)
    }
    doc.chapterOrder = validateReorderIds(presentIds, chapterOrder, 'chapterOrder', '章节')
    await writeJSON(filePath, doc)
  }
}

// === Chapters ===

class FileChapterRepo implements ChapterRepo {
  async list(userId: string, docId: string): Promise<Chapter[]> {
    const doc = await readJSONOrNull<Document>(documentPath(userId, docId))
    if (!doc) return []

    const chapters = (await Promise.all(
      doc.chapterOrder.map((id) => readJSONOrNull<Chapter>(chapterFilePath(userId, docId, id)))
    )).filter(Boolean) as Chapter[]

    return chapters
  }

  async get(userId: string, docId: string, chapterId: string): Promise<Chapter | null> {
    return readJSONOrNull<Chapter>(chapterFilePath(userId, docId, chapterId))
  }

  async create(userId: string, docId: string, chapter: Chapter): Promise<Chapter> {
    const docFilePath = documentPath(userId, docId)
    const doc = await readJSONOrThrow<Document>(docFilePath, '文档不存在')
    doc.chapterOrder.push(chapter.id)
    await writeJSON(chapterFilePath(userId, docId, chapter.id), chapter)
    await writeJSON(docFilePath, doc)
    return chapter
  }

  async update(userId: string, docId: string, chapterId: string, data: Partial<Pick<Chapter, 'title'>>): Promise<Chapter> {
    const filePath = chapterFilePath(userId, docId, chapterId)
    const existing = await readJSONOrThrow<Chapter>(filePath, '章节不存在')
    const updated: Chapter = {
      ...existing,
      title: data.title ?? existing.title,
    }
    await writeJSON(filePath, updated)
    return updated
  }

  async delete(userId: string, docId: string, chapterId: string): Promise<void> {
    const docFilePath = documentPath(userId, docId)
    const doc = await readJSONOrNull<Document>(docFilePath)
    if (doc) {
      doc.chapterOrder = doc.chapterOrder.filter((id) => id !== chapterId)
      await writeJSON(docFilePath, doc)
    }
    await deleteDir(chapterDir(userId, docId, chapterId))
  }
}

// === Paragraphs ===

class FileParagraphRepo implements ParagraphRepo {
  async list(userId: string, docId: string, chapterId: string): Promise<Paragraph[]> {
    const chap = await readJSONOrNull<Chapter>(chapterFilePath(userId, docId, chapterId))
    if (!chap) return []

    const paragraphs = (await Promise.all(
      chap.paragraphOrder.map((id) =>
        readJSONOrNull<Paragraph>(paragraphFilePath(userId, docId, chapterId, id))
      )
    )).filter(Boolean) as Paragraph[]

    return paragraphs
  }

  async get(userId: string, docId: string, chapterId: string, paragraphId: string): Promise<Paragraph | null> {
    return readJSONOrNull<Paragraph>(paragraphFilePath(userId, docId, chapterId, paragraphId))
  }

  async create(userId: string, docId: string, chapterId: string, para: Paragraph): Promise<Paragraph> {
    const chapFile = chapterFilePath(userId, docId, chapterId)
    const chap = await readJSONOrThrow<Chapter>(chapFile, '章节不存在')
    chap.paragraphOrder.push(para.id)
    await writeJSON(paragraphFilePath(userId, docId, chapterId, para.id), para)
    await writeJSON(chapFile, chap)
    return para
  }

  async update(userId: string, docId: string, chapterId: string, paragraphId: string, data: Partial<Pick<Paragraph, 'name' | 'currentDraftId'>>): Promise<Paragraph> {
    const filePath = paragraphFilePath(userId, docId, chapterId, paragraphId)
    const existing = await readJSONOrThrow<Paragraph>(filePath, '段落不存在')
    if (data.currentDraftId) {
      // A real draft id must point at an existing draft file — switching to
      // a nonexistent draft would leave the editor permanently empty.
      if (!(await exists(paragraphDraftMdPath(userId, docId, chapterId, paragraphId, data.currentDraftId)))) {
        throw new Error('草稿不存在')
      }
    }
    const updated: Paragraph = {
      ...existing,
      name: data.name ?? existing.name,
      // null is a legitimate "clear" — only undefined keeps the old value.
      currentDraftId: data.currentDraftId === undefined ? existing.currentDraftId : data.currentDraftId,
    }
    await writeJSON(filePath, updated)
    return updated
  }

  async delete(userId: string, docId: string, chapterId: string, paragraphId: string): Promise<void> {
    const chapFile = chapterFilePath(userId, docId, chapterId)
    const chap = await readJSONOrNull<Chapter>(chapFile)
    if (chap) {
      chap.paragraphOrder = chap.paragraphOrder.filter((id) => id !== paragraphId)
      await writeJSON(chapFile, chap)
    }
    await deleteDir(paragraphDir(userId, docId, chapterId, paragraphId))
  }

  async reorder(userId: string, docId: string, chapterId: string, paragraphOrder: string[]): Promise<void> {
    const chapFile = chapterFilePath(userId, docId, chapterId)
    const chap = await readJSONOrThrow<Chapter>(chapFile, '章节不存在')
    // Baseline = ids that actually exist on disk (see reorderChapters for
    // the ghost-id self-healing rationale).
    const presentIds: string[] = []
    for (const id of chap.paragraphOrder || []) {
      if (await exists(paragraphFilePath(userId, docId, chapterId, id))) presentIds.push(id)
    }
    chap.paragraphOrder = validateReorderIds(presentIds, paragraphOrder, 'paragraphOrder', '段落')
    await writeJSON(chapFile, chap)
  }
}

// === Drafts ===

/**
 * Path builders for one draft collection. Paragraph drafts and attachment
 * drafts share identical logic — only the file layout differs.
 */
interface DraftPaths {
  /** Directory containing the owner JSON and the <draftId>.md files */
  dir: string
  /** Path of a single draft markdown file */
  mdPath: (draftId: string) => string
  /** Path of the owner entity (paragraph.json / <type>.json) */
  ownerPath: string
  /** Error message when the owner entity does not exist */
  ownerMissingError: string
}

interface DraftBase {
  id: string
  version: number
  content: string
  createdAt: string
}

/** Generic draft storage shared by paragraph drafts and attachment drafts. */
const draftStore = {
  async list(paths: DraftPaths): Promise<DraftBase[]> {
    const entries = await listDir(paths.dir)
    const mdFiles = entries.filter((e) => e.endsWith('.md')).sort()

    const drafts: DraftBase[] = await Promise.all(
      mdFiles.map(async (fname, i) => {
        const draftId = fname.replace('.md', '')
        const content = await readFileOrNull(paths.mdPath(draftId)) ?? ''
        const createdAt = parseIdCreated(draftId) || new Date().toISOString()
        return { id: draftId, version: i + 1, content, createdAt }
      })
    )

    drafts.sort((a, b) => b.version - a.version)
    return drafts
  },

  async create(paths: DraftPaths, draftId: string, content: string): Promise<DraftBase> {
    // Validate the owner exists BEFORE writing the draft file, so a bad id
    // cannot leave an orphan .md behind.
    const owner = await readJSONOrThrow<{ currentDraftId: string | null }>(paths.ownerPath, paths.ownerMissingError)

    // Write the .md draft file
    await writeFile(paths.mdPath(draftId), content)

    // Update the owner's currentDraftId atomically
    owner.currentDraftId = draftId
    await writeJSON(paths.ownerPath, owner)

    // Compute version
    const entries = await listDir(paths.dir)
    const version = entries.filter((e) => e.endsWith('.md')).length

    const createdAt = parseIdCreated(draftId) || new Date().toISOString()
    return { id: draftId, version, content, createdAt }
  },

  async get(paths: DraftPaths, draftId: string): Promise<DraftBase | null> {
    const content = await readFileOrNull(paths.mdPath(draftId))
    if (content === null) return null
    const entries = await listDir(paths.dir)
    const mdFiles = entries.filter((e) => e.endsWith('.md')).sort()
    const version = mdFiles.indexOf(`${draftId}.md`) + 1
    const createdAt = parseIdCreated(draftId) || new Date().toISOString()
    return { id: draftId, version, content, createdAt }
  },

  async delete(paths: DraftPaths, draftId: string): Promise<void> {
    await deleteFile(paths.mdPath(draftId))

    // If the deleted draft was the current one, switch to the latest remaining
    const owner = await readJSONOrNull<{ currentDraftId: string | null }>(paths.ownerPath)
    if (owner && owner.currentDraftId === draftId) {
      const entries = await listDir(paths.dir)
      const mdFiles = entries.filter((e) => e.endsWith('.md')).sort()
      owner.currentDraftId = mdFiles.length > 0 ? mdFiles[mdFiles.length - 1].replace('.md', '') : null
      await writeJSON(paths.ownerPath, owner)
    }
  },
}

function paragraphDraftPaths(userId: string, docId: string, chapterId: string, paragraphId: string): DraftPaths {
  return {
    dir: paragraphDir(userId, docId, chapterId, paragraphId),
    mdPath: (draftId) => paragraphDraftMdPath(userId, docId, chapterId, paragraphId, draftId),
    ownerPath: paragraphFilePath(userId, docId, chapterId, paragraphId),
    ownerMissingError: '段落不存在',
  }
}

function attachmentDraftPaths(userId: string, docId: string, type: string): DraftPaths {
  return {
    dir: attachmentDir(userId, docId, type),
    mdPath: (draftId) => attachmentDraftMdPath(userId, docId, type, draftId),
    ownerPath: attachmentFilePath(userId, docId, type),
    ownerMissingError: '附件不存在',
  }
}

class FileDraftRepo implements DraftRepo {
  // --- Paragraph Drafts ---

  async listParagraphDrafts(userId: string, docId: string, chapterId: string, paragraphId: string): Promise<ParagraphDraft[]> {
    const drafts = await draftStore.list(paragraphDraftPaths(userId, docId, chapterId, paragraphId))
    return drafts.map((d) => ({ ...d, paragraphId }))
  }

  async createParagraphDraft(userId: string, docId: string, chapterId: string, paragraphId: string, draftId: string, content: string): Promise<ParagraphDraft> {
    const draft = await draftStore.create(paragraphDraftPaths(userId, docId, chapterId, paragraphId), draftId, content)
    return { ...draft, paragraphId }
  }

  async getParagraphDraft(userId: string, docId: string, chapterId: string, paragraphId: string, draftId: string): Promise<ParagraphDraft | null> {
    const draft = await draftStore.get(paragraphDraftPaths(userId, docId, chapterId, paragraphId), draftId)
    return draft ? { ...draft, paragraphId } : null
  }

  async deleteParagraphDraft(userId: string, docId: string, chapterId: string, paragraphId: string, draftId: string): Promise<void> {
    await draftStore.delete(paragraphDraftPaths(userId, docId, chapterId, paragraphId), draftId)
  }

  // --- Attachment Drafts ---

  async listAttachmentDrafts(userId: string, docId: string, type: string): Promise<AttachmentDraft[]> {
    const drafts = await draftStore.list(attachmentDraftPaths(userId, docId, type))
    return drafts.map((d) => ({ ...d, attachmentId: type }))
  }

  async createAttachmentDraft(userId: string, docId: string, type: string, draftId: string, content: string): Promise<AttachmentDraft> {
    const draft = await draftStore.create(attachmentDraftPaths(userId, docId, type), draftId, content)
    return { ...draft, attachmentId: type }
  }

  async getAttachmentDraft(userId: string, docId: string, type: string, draftId: string): Promise<AttachmentDraft | null> {
    const draft = await draftStore.get(attachmentDraftPaths(userId, docId, type), draftId)
    return draft ? { ...draft, attachmentId: type } : null
  }

  async deleteAttachmentDraft(userId: string, docId: string, type: string, draftId: string): Promise<void> {
    await draftStore.delete(attachmentDraftPaths(userId, docId, type), draftId)
  }
}

// === Attachment ===

class FileAttachmentRepo implements AttachmentRepo {
  async list(userId: string, docId: string): Promise<Attachment[]> {
    const doc = await readJSONOrNull<Document>(documentPath(userId, docId))
    if (!doc) return []

    const attachments = (await Promise.all(
      (doc.attachmentOrder || []).map((type) => readJSONOrNull<Attachment>(attachmentFilePath(userId, docId, type)))
    )).filter(Boolean) as Attachment[]

    return attachments
  }

  async get(userId: string, docId: string, type: string): Promise<Attachment | null> {
    return readJSONOrNull<Attachment>(attachmentFilePath(userId, docId, type))
  }

  async ensure(userId: string, docId: string, type: string, name: string): Promise<Attachment> {
    const filePath = attachmentFilePath(userId, docId, type)
    const existing = await readJSONOrNull<Attachment>(filePath)
    if (existing) {
      // Self-heal: the attachment file exists but its type may be missing
      // from document.attachmentOrder (legacy docs / hand-edited data) —
      // without registration the attachment (and all its drafts) stays
      // invisible to attachments.list forever.
      const docFile = documentPath(userId, docId)
      const doc = await readJSONOrNull<Document>(docFile)
      if (doc) {
        if (!doc.attachmentOrder) doc.attachmentOrder = []
        if (!doc.attachmentOrder.includes(type)) {
          doc.attachmentOrder.push(type)
          await writeJSON(docFile, doc)
        }
      }
      return existing
    }

    const docFile = documentPath(userId, docId)
    // The parent document must exist — otherwise we would write an orphan
    // attachment tree that no list endpoint can ever see.
    const doc = await readJSONOrNull<Document>(docFile)
    if (!doc) throw new Error('文档不存在')

    const draftId = generateId()
    const attachment: Attachment = { id: type, documentId: docId, name, currentDraftId: draftId, createdAt: new Date().toISOString() }
    await writeFile(attachmentDraftMdPath(userId, docId, type, draftId), '')
    await writeJSON(filePath, attachment)

    // Record in document's attachmentOrder (append if missing).
    const fresh = await readJSONOrNull<Document>(docFile)
    if (fresh) {
      if (!fresh.attachmentOrder) fresh.attachmentOrder = []
      if (!fresh.attachmentOrder.includes(type)) {
        fresh.attachmentOrder.push(type)
      }
      await writeJSON(docFile, fresh)
    }
    return attachment
  }

  async update(userId: string, docId: string, type: string, data: { name?: string; currentDraftId?: string | null }): Promise<Attachment> {
    const filePath = attachmentFilePath(userId, docId, type)
    const existing = await readJSONOrThrow<Attachment>(filePath, '附件不存在')
    if (data.currentDraftId) {
      // Must point at a real draft file — see FileParagraphRepo.update.
      if (!(await exists(attachmentDraftMdPath(userId, docId, type, data.currentDraftId)))) {
        throw new Error('草稿不存在')
      }
    }
    const updated: Attachment = {
      ...existing,
      name: data.name ?? existing.name,
      // null is a legitimate "clear" — only undefined keeps the old value.
      currentDraftId: data.currentDraftId === undefined ? existing.currentDraftId : data.currentDraftId,
    }
    await writeJSON(filePath, updated)
    return updated
  }

  async delete(userId: string, docId: string, type: string): Promise<void> {
    await deleteDir(attachmentDir(userId, docId, type))
    const docFile = documentPath(userId, docId)
    const doc = await readJSONOrNull<Document>(docFile)
    if (doc) {
      doc.attachmentOrder = (doc.attachmentOrder || []).filter((t) => t !== type)
      await writeJSON(docFile, doc)
    }
  }
}

// === Templates ===

class FileTemplatesRepo implements TemplatesRepo {
  async list(): Promise<DocumentTemplate[]> {
    const entries = await listDir(templatesDir())
    const templates = (await Promise.all(
      entries
        .filter((e) => e.endsWith('.json'))
        // slice off ONLY the trailing extension — replace() would strip the
        // first '.json' occurrence and break names like foo.json.backup.json
        .map((e) => readJSONOrNull<DocumentTemplate>(templateFilePath(e.slice(0, -'.json'.length))))
    )).filter(Boolean) as DocumentTemplate[]
    return templates
  }

  async get(templateId: string): Promise<DocumentTemplate | null> {
    return readJSONOrNull<DocumentTemplate>(templateFilePath(templateId))
  }
}

// === Conversations ===

class FileConversationRepo implements ConversationRepo {
  async list(userId: string, docId: string, parentId: string, type: ConversationType): Promise<AiConversation[]> {
    const baseDir = conversationsDir(userId, docId)
    const entries = await listDir(baseDir)

    const conversations = (await Promise.all(
      entries.map(async (entry) => {
        const conv = await readJSONOrNull<AiConversation>(conversationFilePath(userId, docId, entry))
        if (!conv || conv.type !== type) return null
        // Filter by parent
        if (type === 'casual') {
          return conv.documentId === parentId ? conv : null
        }
        if (type === 'chapter_review') {
          return conv.chapterId === parentId ? conv : null
        }
        if (type === 'attachment_review' && conv.attachmentId === parentId) return conv
        if (type === 'paragraph_review' && conv.paragraphId === parentId) return conv
        return null
      })
    )).filter(Boolean) as AiConversation[]

    // fs.readdir order is arbitrary — sort like documents/turns do
    // (createdAt ascending, falling back to id for legacy rows).
    conversations.sort((a, b) => {
      const ka = a.createdAt || a.id
      const kb = b.createdAt || b.id
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })

    return conversations
  }

  async get(userId: string, docId: string, convId: string): Promise<AiConversation | null> {
    return readJSONOrNull<AiConversation>(conversationFilePath(userId, docId, convId))
  }

  async create(userId: string, docId: string, conv: AiConversation): Promise<AiConversation> {
    await writeJSON(conversationFilePath(userId, docId, conv.id), conv)
    return conv
  }

  async delete(userId: string, docId: string, convId: string): Promise<void> {
    // Delete entire conversation directory (includes all turns)
    await deleteDir(conversationDir(userId, docId, convId))
  }
}

// === Turns ===

class FileTurnRepo implements TurnRepo {
  async list(userId: string, docId: string, convId: string): Promise<AiTurn[]> {
    const dirPath = conversationDir(userId, docId, convId)
    const entries = await listDir(dirPath)

    const turns = (await Promise.all(
      entries
        .filter((e) => e.endsWith('.json') && e !== 'conversation.json')
        .map((entry) => {
          const turnId = entry.replace('.json', '')
          return readJSONOrNull<AiTurn>(turnFilePath(userId, docId, convId, turnId))
        })
    )).filter(Boolean) as AiTurn[]

    turns.sort((a, b) => a.order - b.order)
    return turns
  }

  async get(userId: string, docId: string, convId: string, turnId: string): Promise<AiTurn | null> {
    return readJSONOrNull<AiTurn>(turnFilePath(userId, docId, convId, turnId))
  }

  async create(userId: string, docId: string, convId: string, turn: AiTurn): Promise<AiTurn> {
    await writeJSON(turnFilePath(userId, docId, convId, turn.id), turn)
    return turn
  }

  async update(userId: string, docId: string, convId: string, turnId: string, turn: AiTurn): Promise<AiTurn> {
    await writeJSON(turnFilePath(userId, docId, convId, turnId), turn)
    return turn
  }

  async delete(userId: string, docId: string, convId: string, turnId: string): Promise<void> {
    await deleteFile(turnFilePath(userId, docId, convId, turnId))
  }

  async addAnswer(userId: string, docId: string, convId: string, turnId: string, answer: AiAnswer, existingAnswerId?: string, makeCurrent = true): Promise<AiAnswer> {
    const filePath = turnFilePath(userId, docId, convId, turnId)
    const turn = await readJSONOrThrow<AiTurn>(filePath, 'Turn 不存在')

    if (existingAnswerId) {
      const idx = turn.answers.findIndex((a) => a.id === existingAnswerId)
      if (idx >= 0) {
        const updated: AiAnswer = {
          ...turn.answers[idx],
          content: answer.content || turn.answers[idx].content,
          thinking: answer.thinking || turn.answers[idx].thinking,
          model: answer.model || turn.answers[idx].model,
        }
        turn.answers[idx] = updated
        await writeJSON(filePath, turn)
        return updated
      }
    }

    turn.answers.push(answer)
    // makeCurrent=false is used by cancelled-stream drains: pushing a late
    // partial answer must not steal currentAnswerIndex from the retry
    // stream's answer.
    if (makeCurrent) turn.currentAnswerIndex = turn.answers.length - 1
    await writeJSON(filePath, turn)
    return answer
  }

  async updateAnswerIndex(userId: string, docId: string, convId: string, turnId: string, answerIndex: number): Promise<AiTurn> {
    const filePath = turnFilePath(userId, docId, convId, turnId)
    const turn = await readJSONOrThrow<AiTurn>(filePath, 'Turn 不存在')
    if (answerIndex >= turn.answers.length) {
      throw new Error('无效的 answerIndex')
    }
    turn.currentAnswerIndex = answerIndex
    await writeJSON(filePath, turn)
    return turn
  }

  async findById(userId: string, docId: string, turnId: string): Promise<AiTurn | null> {
    const convsDir = conversationsDir(userId, docId)
    const entries = await listDir(convsDir)
    for (const convId of entries) {
      const turn = await readJSONOrNull<AiTurn>(turnFilePath(userId, docId, convId, turnId))
      if (turn) return turn
    }
    return null
  }
}

// === Settings ===

class FileSettingsRepo implements SettingsRepo {
  async get(userId: string): Promise<AppSettings> {
    const filePath = userConfigPath(userId)
    const data = await readJSONOrNull<Partial<AppSettings>>(filePath)
    return { ...DEFAULT_SETTINGS, ...data }
  }

  async update(userId: string, data: Partial<AppSettings>): Promise<AppSettings> {
    const filePath = userConfigPath(userId)
    const current = await this.get(userId)
    const updated: AppSettings = {
      apiKey: data.apiKey ?? current.apiKey,
      apiBaseUrl: data.apiBaseUrl ?? current.apiBaseUrl,
      model: data.model ?? current.model,
      style: data.style ?? current.style,
    }
    await writeJSON(filePath, updated)
    return updated
  }

  async loadPrompt(style: string): Promise<PromptFile> {
    const defaults: PromptFile = {
      fulltextReview: '你是一位专业编辑，请审阅这整篇文章。',
      chapterReview: '你是一位专业编辑，请审阅这个章节。',
      attachmentReview: '你是一位专业编辑，请审阅这份设定材料。',
      paragraphReview: '你是一位专业编辑，请审阅这段文字。',
      casual: '你是一位专业编辑，请帮助作者完成写作。',
    }
    // The style comes from config.json on disk (hand-editable) — validate it
    // here too, not only at the HTTP boundary, and fall back to 'gentle'.
    const safeStyle = (REVIEW_STYLES as readonly string[]).includes(style) ? style : 'gentle'
    const filePath = promptFilePath(safeStyle)
    const data = await readJSONOrNull<Partial<PromptFile>>(filePath)
    return { ...defaults, ...data }
  }
}

// === FileRepository (aggregate) ===

export class FileRepository implements Repository {
  documents = new FileDocumentRepo()
  chapters = new FileChapterRepo()
  paragraphs = new FileParagraphRepo()
  drafts = new FileDraftRepo()
  attachments = new FileAttachmentRepo()
  templates = new FileTemplatesRepo()
  conversations = new FileConversationRepo()
  turns = new FileTurnRepo()
  settings: FileSettingsRepo = new FileSettingsRepo()

  /**
   * Initialize the file-based storage:
   * 1. Ensure user directory exists
   * 2. Ensure default config file exists
   */
  async initialize(): Promise<void> {
    const userId = USER_ID

    // Ensure user dirs
    await ensureDir(userDocsDir(userId))
    const configFile = userConfigPath(userId)
    if (!(await exists(configFile))) {
      await writeJSON(configFile, DEFAULT_SETTINGS)
    }
  }

  /** Load prompt file (convenience method for AI routes) */
  async loadPrompt(style: string): Promise<PromptFile> {
    return this.settings.loadPrompt(style)
  }
}
