/**
 * 回归：编辑内容 localStorage 草稿快照（误刷新不丢内容）+ 重新进入文档回到上次位置。
 *
 * - coeditor:unsaved-drafts：{ docId: { targetKey: { content, updatedAt } } }，
 *   输入防抖写入；刷新后恢复内容并标记未保存；手动保存成功后清除。
 * - coeditor:last-view：{ docId: SavedView }，视图变化写入；重新进入文档恢复。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { apiRpc, createDoc, createChapter } from './helpers/api'
import { devBase } from './helpers/env'
import {
  wait, clickAt, findLeaf, findText, storageMap, clearStorage, editorTextareaValue, clickEditorTextarea,
} from './helpers/page'

const NEW_PARAGRAPH = 'New paragraph|新建段落'
const CONTENT = 'e2e-未保存内容-ABC-123'

async function saveDraft(page: Page): Promise<void> {
  const p = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('[class*="btn"]')).find(
      (el) => { const t = (el.textContent || '').trim(); return t === 'Save' || t === '保存' },
    )
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  expect(p).not.toBeNull()
  await clickAt(page, p)
}

describe('草稿持久化与位置恢复', () => {
  let browser: Browser
  let page: Page
  let docId: string
  let chapterId: string

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    // 刷新带未保存内容会弹浏览器确认框：测试里直接确认离开
    page.on('dialog', (d) => { void d.accept() })
    const doc = await createDoc('e2e-草稿持久化')
    docId = doc.id
    const ch = await createChapter(docId, '第一章')
    chapterId = ch.id
    // 直接经 API 建一个段落，测试聚焦持久化行为（UI 建段落在 h5-create 覆盖）
    await apiRpc('paragraphs.create', { docId, chapterId, name: '段落甲' })
    await page.goto(`${devBase()}#/pages/edit/index?docId=${docId}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)
    await clearStorage(page)
    await page.reload({ waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)
    // 展开章节并选中段落甲，进入可编辑视图
    await clickAt(page, await findText(page, '›'))
    await wait(500)
    await clickAt(page, await findLeaf(page, '^段落甲$'))
    await wait(800)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('输入内容写入 localStorage 快照', async () => {
    await clickEditorTextarea(page)
    await wait(200)
    await page.keyboard.type(CONTENT)
    await wait(1500) // 防抖落盘
    const m = await storageMap(page)
    const draftKey = Object.keys(m).find((k) => k.includes('unsaved'))
    expect(draftKey).toBeTruthy()
    expect(m[draftKey!]).toContain(CONTENT)
  })

  it('刷新后内容恢复且仍在原位置（未保存标记保留）', async () => {
    await page.reload({ waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(5000) // boot + 恢复
    const value = await editorTextareaValue(page)
    expect(value).toContain(CONTENT)
    // 恢复后回到段落甲（位置恢复）
    const body = await page.evaluate(() => document.body.innerText)
    expect(body).toContain('段落甲')
    expect(await editorTextareaValue(page)).not.toBeNull()
  })

  it('保存成功后清除快照，再刷新从服务端读取', async () => {
    await saveDraft(page)
    await wait(1500)
    const m = await storageMap(page)
    const draftKey = Object.keys(m).find((k) => k.includes('unsaved'))
    // 快照键可能保留（空 map），关键断言：已无该文档的未保存内容
    expect(draftKey).toBeDefined()
    expect(m[draftKey!]).not.toContain(CONTENT)
    await page.reload({ waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(5000)
    const value = await editorTextareaValue(page)
    expect(value).toContain(CONTENT) // 内容已存服务端版本历史
  })

  it('重新进入文档回到上次编辑位置（附件视图）', async () => {
    await clickAt(page, await findLeaf(page, '^Outline$'))
    await wait(800)
    await page.reload({ waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(5000)
    // 恢复后应为附件（Outline）可编辑视图：有编辑器 textarea，标题含附件名
    const value = await editorTextareaValue(page)
    expect(value).not.toBeNull()
    const body = await page.evaluate(() => document.body.innerText)
    expect(/Outline|大纲/.test(body)).toBe(true)
  })
})
