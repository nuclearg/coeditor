import { getStorage, setStorage } from './storage'

/**
 * 本地持久化（localStorage / 小程序 storage）：
 * - 未保存的编辑内容快照（防止误刷新丢失正在写的内容）
 * - 每个文档最后一次编辑位置（重新进入文档时回到原处）
 *
 * 键值设计：
 *   coeditor:unsaved-drafts → { [docId]: { [targetKey]: { content, updatedAt } } }
 *     targetKey = `p:<chapterId>/<paragraphId>` 或 `a:<attachmentType>`
 *   coeditor:last-view     → { [docId]: SavedView }
 */

export type SavedView =
  | { type: 'paragraph'; chapterId: string; paragraphId: string }
  | { type: 'attachment'; attachmentId: string }
  | { type: 'chapter'; chapterId: string }
  | { type: 'fulltext' }

export interface DraftSnapshot {
  content: string
  updatedAt: number
}

const DRAFT_KEY = 'coeditor:unsaved-drafts'
const VIEW_KEY = 'coeditor:last-view'

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = getStorage(key)
    if (!raw) return {}
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {}
  } catch {
    return {}
  }
}

function writeMap(key: string, map: Record<string, unknown>): void {
  setStorage(key, JSON.stringify(map))
}

// === 未保存内容快照 ===

export function getDraftSnapshot(docId: string, targetKey: string): DraftSnapshot | null {
  const map = readMap<Record<string, DraftSnapshot>>(DRAFT_KEY)
  return map[docId]?.[targetKey] || null
}

export function saveDraftSnapshot(docId: string, targetKey: string, content: string): void {
  const map = readMap<Record<string, DraftSnapshot>>(DRAFT_KEY)
  const docMap = map[docId] || {}
  docMap[targetKey] = { content, updatedAt: Date.now() }
  map[docId] = docMap
  writeMap(DRAFT_KEY, map)
}

export function clearDraftSnapshot(docId: string, targetKey?: string): void {
  const map = readMap<Record<string, DraftSnapshot>>(DRAFT_KEY)
  const docMap = map[docId]
  if (!docMap) return
  if (targetKey === undefined) {
    delete map[docId]
  } else {
    delete docMap[targetKey]
    if (Object.keys(docMap).length === 0) delete map[docId]
  }
  writeMap(DRAFT_KEY, map)
}

// === 最后一次编辑位置 ===

export function getLastView(docId: string): SavedView | null {
  const map = readMap<SavedView>(VIEW_KEY)
  return map[docId] || null
}

export function saveLastView(docId: string, view: SavedView): void {
  const map = readMap<SavedView>(VIEW_KEY)
  map[docId] = view
  writeMap(VIEW_KEY, map)
}
