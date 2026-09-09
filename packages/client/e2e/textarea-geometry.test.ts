/**
 * 回归：编辑区 textarea 滚动条贴面板右缘（resizer 侧无缝隙）。
 *
 * 结构：Taro Textarea 的 padding 在 wrapper（taro-textarea-core）上，
 * 内层原生 textarea 的滚动条会停在 wrapper 内容盒右缘——wrapper 的
 * padding-right 会在滚动条与面板右缘/resizer 之间留下一段缝隙。
 * 修复：wrapper padding-right = 0（滚动条贴边），内层 .taro-textarea
 * padding-right 提供"文本 ↔ 滚动条"之间的留白。
 *
 * 断言：内层 textarea（滚动条所在元素）右缘 ≈ resizer 左缘（≤2px）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { apiRpc, createDoc, createChapter } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, clickAt, findLeaf, findText } from './helpers/page'

describe('编辑区 textarea 滚动条贴边', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    const doc = await createDoc('e2e-textarea-geometry')
    const ch = await createChapter(doc.id, '第一章')
    const para = await apiRpc<{ id: string }>('paragraphs.create', { docId: doc.id, chapterId: ch.id, name: '长文段落' })
    // 长内容触发 textarea 内部滚动条
    await apiRpc('paragraphDrafts.create', {
      docId: doc.id,
      chapterId: ch.id,
      paragraphId: para.id,
      content: Array.from({ length: 300 }, (_, i) => `第 ${i + 1} 行：这是一段很长的正文内容，用于撑出编辑器 textarea 的滚动条。`).join('\n'),
    })
    await page.goto(`${devBase()}#/pages/edit/index?docId=${doc.id}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)
    await clickAt(page, await findText(page, '›'))
    await wait(500)
    await clickAt(page, await findLeaf(page, '^长文段落$'))
    await wait(1000)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('滚动条（内层 textarea 右缘）与 resizer 贴齐，无缝隙', async () => {
    const m = await page.evaluate(() => {
      // 编辑区/AI 面板之间的 resizer（排除侧栏 resizer）
      const resizer = document.querySelector('[data-resizable-handle]:not([data-sidebar-resizer])')
      const wrapper = document.querySelector('taro-textarea-core.editor-textarea')
      if (!resizer || !wrapper) return null
      const wrapperEl = wrapper as HTMLElement
      const inner = wrapperEl.querySelector('textarea') as HTMLTextAreaElement | null
      if (!inner) return null
      const wRect = wrapperEl.getBoundingClientRect()
      const rsRect = (resizer as HTMLElement).getBoundingClientRect()
      const cs = getComputedStyle(wrapperEl)
      return {
        wrapperRight: Math.round(wRect.right),
        resizerLeft: Math.round(rsRect.left),
        wrapperToResizerGap: Math.round(rsRect.left - wRect.right),
        wrapperPaddingRight: cs.paddingRight,
        innerRight: Math.round(inner.getBoundingClientRect().right),
        innerPaddingRight: getComputedStyle(inner).paddingRight,
        innerScrollHeight: inner.scrollHeight,
        innerClientHeight: inner.clientHeight,
      }
    })
    expect(m).not.toBeNull()
    // 内容确实溢出（滚动条存在的前提）
    expect(m!.innerScrollHeight).toBeGreaterThan(m!.innerClientHeight)
    // wrapper 与 resizer 无缝隙
    expect(m!.wrapperToResizerGap).toBeLessThanOrEqual(2)
    // 滚动条（内层 textarea 右缘）贴齐 resizer（≤2px，1px 为 wrapper 边框）
    expect(Math.abs(m!.innerRight - m!.resizerLeft)).toBeLessThanOrEqual(2)
    // 文本与滚动条之间由内层 padding 留白（> 0）
    expect(parseFloat(m!.innerPaddingRight)).toBeGreaterThan(0)
  })
})
