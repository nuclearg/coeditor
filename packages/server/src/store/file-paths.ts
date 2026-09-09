/**
 * Path helpers for the file-based storage layout.
 * Only used internally by FileRepository.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 数据目录指针文件的位置（存"数据目录指向哪"这个偏好，不是数据本身）。
 * 放在**平台默认数据目录**里（而非独立的配置目录）：
 * - 用户改的是"数据目录"不是"配置目录"——不该感知到第二个目录
 * - 指针只在用户把数据移去非默认位置时写入，且永远落在固定的默认目录，
 *   所以不会出现"指针指向自己"的鸡生蛋问题
 * - 删除应用数据目录（如 macOS 把 App Support/coeditor 扔回收站）时，指针一并删除，无残留
 * 可用 COEDITOR_DATA_DIR_FILE 覆盖（测试/特殊部署场景）。
 * 运行时求值而非模块级常量，便于测试在设置 env 后控制写入位置。
 */
export function getDataDirPrefFile(): string {
  if (process.env.COEDITOR_DATA_DIR_FILE) {
    return path.resolve(process.env.COEDITOR_DATA_DIR_FILE)
  }
  return path.join(defaultDataRoot(), 'data-dir.json')
}

/** 读取持久化的数据目录偏好；文件缺失/损坏时返回 null */
export function readPersistedDataDir(): string | null {
  try {
    const raw = fs.readFileSync(getDataDirPrefFile(), 'utf-8')
    const parsed = JSON.parse(raw) as { dataDir?: unknown }
    if (typeof parsed.dataDir === 'string' && parsed.dataDir.trim() !== '') {
      return path.resolve(parsed.dataDir.trim())
    }
  } catch {
    // 文件不存在或损坏：视为无偏好
  }
  return null
}

/** 持久化数据目录偏好（异步；由 settings.update 的 dataDir 字段触发） */
export async function writePersistedDataDir(dir: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(getDataDirPrefFile()), { recursive: true })
  await fs.promises.writeFile(
    getDataDirPrefFile(),
    JSON.stringify({ dataDir: path.resolve(dir) }, null, 2),
    'utf-8',
  )
}

/**
 * 删除持久化的数据目录偏好。
 * 用户把数据目录改回平台默认时调用——默认目录无需指针文件也能解析，
 * 删掉它保持系统干净（配置文件只应在用户手工改成非默认目录时存在）。
 */
export async function removePersistedDataDir(): Promise<void> {
  await fs.promises.rm(getDataDirPrefFile(), { force: true })
}

/**
 * 平台默认数据目录（无环境变量、无持久化偏好时使用）：
 * - Linux 等：$XDG_DATA_HOME/coeditor（默认 ~/.local/share/coeditor）—— XDG Base Directory 规范
 * - macOS：~/Library/Application Support/coeditor —— 平台惯例
 * - Windows：%LOCALAPPDATA%\coeditor（回退 %APPDATA% 再回退用户主目录）—— 机器专属数据惯例
 */
export function defaultDataRoot(): string {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || home, 'coeditor')
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'coeditor')
  }
  return process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, 'coeditor')
    : path.join(home, '.local', 'share', 'coeditor')
}

function resolveDataRoot(): string {
  // 优先级：COEDITOR_DATA_DIR 环境变量 > 持久化的用户偏好 > 平台默认目录。
  // 环境变量优先保证 start.sh / 桌面 sidecar / 测试（vitest.setup）行为不变；
  // 偏好文件让「设置菜单里改数据目录」在重启后依然生效；默认目录让裸启动（无任何配置）
  // 也能开箱即用，而不是报错。
  const env = process.env.COEDITOR_DATA_DIR
  if (env && env.trim() !== '') return path.resolve(env.trim())
  const pref = readPersistedDataDir()
  if (pref) return pref
  return defaultDataRoot()
}

export let DATA_ROOT: string = resolveDataRoot()

/**
 * 运行时切换数据根目录（settings.update 的 dataDir 字段）。
 * 只改内存中的根路径；所有 file-* 路径函数都在调用时读取 DATA_ROOT，
 * 因此后续文件操作自动落到新目录，无需逐个重构。
 */
export function setDataRoot(root: string): void {
  DATA_ROOT = path.resolve(root)
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
