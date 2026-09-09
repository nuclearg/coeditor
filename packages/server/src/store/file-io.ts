/**
 * Low-level file I/O utilities.
 * Only used internally by FileRepository — routes should not import this.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { DATA_ROOT } from './file-paths'

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

// === Unique temp file suffix to prevent collisions under concurrent writes ===
let tmpCounter = 0
function tmpSuffix(): string {
  return `${process.pid}.${Date.now()}.${(++tmpCounter).toString(36)}`
}

// === Core I/O ===

/**
 * Read JSON file, returning null if it does not exist (ENOENT).
 * Corrupt JSON (SyntaxError) is also treated as null (with a warning), so a
 * single bad file degrades to one missing entry instead of breaking every
 * list endpoint via Promise.all. Throws on other errors (permission etc.).
 */
export async function readJSONOrNull<T>(filePath: string): Promise<T | null> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    return JSON.parse(content) as T
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn(`[readJSONOrNull] skipping corrupt JSON: ${filePath} (${err.message})`)
      return null
    }
    throw err
  }
}

/**
 * Read JSON file, throwing a user-facing error if it does not exist OR is
 * corrupt. Corrupt JSON is wrapped in the same errorMsg (with the original
 * SyntaxError as `cause`) so callers never leak a raw "Unexpected token…"
 * SyntaxError to users.
 */
export async function readJSONOrThrow<T>(filePath: string, errorMsg: string): Promise<T> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(errorMsg, { cause: err })
    throw err
  }
  try {
    return JSON.parse(content) as T
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(errorMsg, { cause: err })
    throw err
  }
}

export async function writeJSON(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tmp = `${filePath}.tmp.${tmpSuffix()}`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, filePath)
  } catch (err) {
    // Clean up orphaned temp file on failure to prevent disk accumulation
    try { await fs.unlink(tmp) } catch { /* best effort */ }
    throw err
  }
}

export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tmp = `${filePath}.tmp.${tmpSuffix()}`
  try {
    await fs.writeFile(tmp, content, 'utf-8')
    await fs.rename(tmp, filePath)
  } catch (err) {
    try { await fs.unlink(tmp) } catch { /* best effort */ }
    throw err
  }
}

/**
 * 软删（逻辑删除铁律）：一切删除都是移入数据根下的 `.trash/`，绝不物理删。
 * 命名 `<ISO时间>_<pid.ms.counter>_<原名>` 防碰撞；回收站不自动清理，
 * 用户可手工找回（恢复 = 移回原路径）。与数据同根目录，保证 rename 同卷原子。
 */
function trashDir(): string {
  return path.join(DATA_ROOT, '.trash')
}

async function moveToTrash(targetPath: string): Promise<void> {
  try {
    await fs.access(targetPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return // 目标已不存在 = 原 ENOENT 容忍语义
    throw err
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(trashDir(), `${stamp}_${tmpSuffix()}_${path.basename(targetPath)}`)
  await fs.mkdir(trashDir(), { recursive: true })
  await fs.rename(targetPath, dest)
}

export async function deleteFile(filePath: string): Promise<void> {
  await moveToTrash(filePath)
}

export async function deleteDir(dirPath: string): Promise<void> {
  await moveToTrash(dirPath)
}

export async function listDir(dirPath: string): Promise<string[]> {
  try { return await fs.readdir(dirPath) } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function exists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true } catch { return false }
}
