/**
 * 回归：H5 输入框自动聚焦（ui/Input 的 focus prop）。
 *
 * 历史 bug：Taro 4 + React 18 下，新建章节回车后 Taro 内部 finishEventHandler
 * 触发 "flushSync was called during render"，React 的 autoFocus 提交路径损坏，
 * 之后所有 input 不再自动聚焦（新建章节/段落的输入框要点一下才能输入）。
 * 修复：H5 端改为手动聚焦原生 <input>（绕过 React autoFocus）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { createDoc } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, clickAt, findLeaf, findText, openSidebarMobile } from './helpers/page'

const NEW_CHAPTER = 'New chapter|新建章节'
const NEW_PARAGRAPH = 'New paragraph|新建段落'

async function activeInput(page: Page): Promise<{ focused: boolean; placeholder: string }> {
  return page.evaluate(() => {
    const ta = document.querySelector('taro-input-core input') as HTMLInputElement | null
    if (!ta) return { focused: false, placeholder: '' }
    return { focused: document.activeElement === ta, placeholder: ta.placeholder }
  })
}

describe('H5 输入框自动聚焦', () => {
  let browser: Browser
  let page: Page
  let docId: string

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    const doc = await createDoc('e2e-输入框聚焦')
    docId = doc.id
    await page.goto(`${devBase()}#/pages/edit/index?docId=${docId}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('新建章节回车后，新建段落输入框仍自动聚焦', async () => {
    // 第一步：新建章节并回车（历史 bug 的触发点——flushSync during render）
    await clickAt(page, await findLeaf(page, NEW_CHAPTER))
    await wait(400)
    await page.keyboard.type('第一章')
    await wait(200)
    await page.keyboard.press('Enter')
    await wait(1200)
    // 回车后章节创建成功、章节输入框已关闭
    const body = await page.evaluate(() => document.body.innerText)
    expect(body).toContain('第一章')
    const afterChapter = await activeInput(page)
    expect(afterChapter.placeholder).toBe('')

    // 第二步：展开章节，点击新建段落——输入框应自动聚焦（历史 bug 会在此失败）
    await clickAt(page, await findText(page, '›'))
    await wait(500)
    await clickAt(page, await findLeaf(page, NEW_PARAGRAPH))
    await wait(500)
    const afterPara = await activeInput(page)
    expect(afterPara.placeholder).toMatch(/New paragraph|新建段落/)
    expect(afterPara.focused).toBe(true)
  })

  it('新建章节回车后，再次新建章节的输入框仍自动聚焦', async () => {
    // 关闭第一个章节输入（失焦）后再次点新建章节
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await wait(400)
    await clickAt(page, await findLeaf(page, NEW_CHAPTER))
    await wait(500)
    const after = await activeInput(page)
    expect(after.placeholder).toMatch(/New chapter|新建章节/)
    expect(after.focused).toBe(true)
  })
})
