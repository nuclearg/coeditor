/**
 * 回归：AI 面板气泡内文本可选中/复制。
 *
 * Taro H5 运行时默认在 html/.taro-app-wrap 上设置 user-select:none（移动 Web
 * reset），整页文本（含 AI 气泡、章节树、正文）都不可选中复制。app.h5.scss
 * 全局恢复 user-select:text（交互控件除外），这里验证气泡文本能被选中。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { createDoc } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, clickAt } from './helpers/page'

describe('气泡文本可选中/复制', () => {
  let browser: Browser
  let page: Page
  let docId: string

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    const doc = await createDoc('e2e-selection-probe')
    docId = doc.id
    await page.goto(`${devBase()}#/pages/edit/index?docId=${docId}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)

    // 全文视图：casual 会话挂在 docId 下。发一条消息触发 AI 输出。
    const inputPos = await page.evaluate(() => {
      const ta = document.querySelector('taro-textarea-core.ai-panel-input textarea')
      if (!ta) return null
      const r = ta.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await clickAt(page, inputPos)
    await wait(200)
    await page.keyboard.type('请审阅这段内容')
    await wait(200)
    const sendPos = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.btn')).find((el) => (el.textContent || '').trim().includes('➤'))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await clickAt(page, sendPos)
    // 等流结束：气泡出现且内容稳定
    await wait(4000)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('用户气泡与 AI 气泡文本均可被选中（user-select:text）', async () => {
    const info = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('.bubble-ai, .bubble-user'))
      const rows: Array<{ className: string; userSelect: string; selectable: boolean }> = []
      for (const b of bubbles) {
        const el = b as HTMLElement
        // 程序化 Range 选中，验证文本真的能被捕获
        let selectable = false
        try {
          const range = document.createRange()
          range.selectNodeContents(el)
          const sel = window.getSelection()
          sel!.removeAllRanges()
          sel!.addRange(range)
          selectable = sel!.toString().length > 0
          sel!.removeAllRanges()
        } catch { /* ignore */ }
        rows.push({
          className: el.className,
          userSelect: getComputedStyle(el).userSelect,
          selectable,
        })
      }
      return rows
    })
    expect(info.length).toBeGreaterThan(0)
    // 每个气泡都应可选中；若有任何一个不可选中，打印详情定位
    const bad = info.filter((r) => !r.selectable)
    console.log('bubbles:', JSON.stringify(info, null, 2))
    expect(bad).toEqual([])
  })
})
