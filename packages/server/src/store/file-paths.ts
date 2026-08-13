/**
 * Path helpers for the file-based storage layout.
 * Only used internally by FileRepository.
 */

import path from 'node:path'

export const DATA_ROOT = process.env.COEDITOR_DATA_DIR
  ? path.resolve(process.env.COEDITOR_DATA_DIR)
  : (() => { throw new Error('环境变量 COEDITOR_DATA_DIR 未设置。请通过 start.sh 启动或手动设置。') })()

// data/prompts/
export function promptsPath() {
  return path.join(DATA_ROOT, 'prompts')
}
export function promptFilePath(style: string) {
  return path.join(promptsPath(), `${style}.json`)
}

// data/templates/
export function templatesDir() {
  return path.join(DATA_ROOT, 'templates')
}
export function templateFilePath(templateId: string) {
  return path.join(templatesDir(), `${templateId}.json`)
}

// data/users/
export function usersPath() {
  return path.join(DATA_ROOT, 'users')
}
export function userPath(userId: string) {
  return path.join(usersPath(), userId)
}
export function userConfigPath(userId: string) {
  return path.join(userPath(userId), 'config.json')
}

// data/users/$userId/docs/
export function userDocsDir(userId: string) {
  return path.join(userPath(userId), 'docs')
}
export function docDir(userId: string, docId: string) {
  return path.join(userDocsDir(userId), docId)
}
export function documentPath(userId: string, docId: string) {
  return path.join(docDir(userId, docId), 'document.json')
}

// data/users/$userId/docs/$docId/attachments/
export function attachmentsDir(userId: string, docId: string) {
  return path.join(docDir(userId, docId), 'attachments')
}
export function attachmentDir(userId: string, docId: string, type: string) {
  return path.join(attachmentsDir(userId, docId), type)
}
export function attachmentFilePath(userId: string, docId: string, type: string) {
  return path.join(attachmentDir(userId, docId, type), `${type}.json`)
}
export function attachmentDraftMdPath(userId: string, docId: string, type: string, draftId: string) {
  return path.join(attachmentDir(userId, docId, type), `${draftId}.md`)
}

// data/users/$userId/docs/$docId/chapters/
export function chaptersDir(userId: string, docId: string) {
  return path.join(docDir(userId, docId), 'chapters')
}
export function chapterDir(userId: string, docId: string, chapterId: string) {
  return path.join(chaptersDir(userId, docId), chapterId)
}
export function chapterFilePath(userId: string, docId: string, chapterId: string) {
  return path.join(chapterDir(userId, docId, chapterId), 'chapter.json')
}

// data/users/$userId/docs/$docId/chapters/$chapterId/paragraphs/
export function paragraphsDir(userId: string, docId: string, chapterId: string) {
  return path.join(chapterDir(userId, docId, chapterId), 'paragraphs')
}
export function paragraphDir(userId: string, docId: string, chapterId: string, paragraphId: string) {
  return path.join(paragraphsDir(userId, docId, chapterId), paragraphId)
}
export function paragraphFilePath(userId: string, docId: string, chapterId: string, paragraphId: string) {
  return path.join(paragraphDir(userId, docId, chapterId, paragraphId), 'paragraph.json')
}
export function paragraphDraftMdPath(userId: string, docId: string, chapterId: string, paragraphId: string, draftId: string) {
  return path.join(paragraphDir(userId, docId, chapterId, paragraphId), `${draftId}.md`)
}

// data/users/$userId/docs/$docId/conversations/
export function conversationsDir(userId: string, docId: string) {
  return path.join(docDir(userId, docId), 'conversations')
}

// New structure: per-conversation subdirectory
export function conversationDir(userId: string, docId: string, convId: string) {
  return path.join(conversationsDir(userId, docId), convId)
}
export function conversationFilePath(userId: string, docId: string, convId: string) {
  return path.join(conversationDir(userId, docId, convId), 'conversation.json')
}
export function turnFilePath(userId: string, docId: string, convId: string, turnId: string) {
  return path.join(conversationDir(userId, docId, convId), `${turnId}.json`)
}
