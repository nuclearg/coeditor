/**
 * 回归：H5 移动端（窄屏浮层侧栏）点击【新建章节】【新建段落】必须生效。
 *
 * 历史 bug：点击 "+ 新建章节/段落" 后 React 同步 flush 把被点的行替换成输入框，
 * 点击目标脱离 DOM，LayoutShell 的"点击侧栏外收起"误判为外部点击把侧栏收起，
 * 表现为"点了没反应"。修复后侧栏保持展开、输入框出现、回车即可创建。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { createDoc } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, clickAt, findLeaf, findText, openSidebarMobile, sidebarOpen } from './helpers/page'

const NEW_CHAPTER = 'New chapter|新建章节'
const NEW_PARAGRAPH = 'New paragraph|新建段落'

describe('H5 移动端：新建章节/新建段落', () => {
  let browser: Browser
  let page: Page
  let docId: string

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    const doc = await createDoc('e2e-移动端新建')
    docId = doc.id
    await page.goto(`${devBase()}#/pages/edit/index?docId=${docId}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)
    await openSidebarMobile(page)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('点击新建章节：侧栏不收起、输入框出现、回车创建成功', async () => {
    await clickAt(page, await findLeaf(page, NEW_CHAPTER))
    await wait(400)
    const afterClick = await page.evaluate(() => ({
      inputs: Array.from(document.querySelectorAll('input')).map((i) => i.placeholder),
    }))
    // 侧栏保持展开（历史 bug 的核心断言）
    expect(await sidebarOpen(page)).toBe(true)
    expect(afterClick.inputs.some((p) => /New chapter|新建章节/.test(p))).toBe(true)

    await page.keyboard.type('第一章')
    await wait(200)
    await page.keyboard.press('Enter')
    await wait(1200)
    const body = await page.evaluate(() => document.body.innerText)
    expect(body).toContain('第一章')
  })

  it('点击新建段落：侧栏不收起、输入框出现且自动聚焦、回车创建成功', async () => {
    // 展开第一章
    await clickAt(page, await findText(page, '›'))
    await wait(500)
    await clickAt(page, await findLeaf(page, NEW_PARAGRAPH))
    await wait(400)
    expect(await sidebarOpen(page)).toBe(true)
    const focused = await page.evaluate(() => {
      const ta = document.querySelector('taro-input-core input') as HTMLInputElement | null
      return ta ? document.activeElement === ta : false
    })
    expect(focused).toBe(true)

    await page.keyboard.type('段落甲')
    await wait(200)
    await page.keyboard.press('Enter')
    await wait(1200)
    const body = await page.evaluate(() => document.body.innerText)
    expect(body).toContain('段落甲')
  })
})
