/**
 * AI 输出吸底跟随（本次核心改动）：
 * 1. AI 输出时不再无条件锁定视角到底部——仅当用户停留在输出底部 10px 内才跟随；
 * 2. 用户滚离底部（滚轮/触摸/拖动）后停止吸底，不把视角拉回；
 * 3. 滚回底部 10px 内自动恢复跟随。
 *
 * 依赖 e2e 基建里的 mock AI 上游（SSE 流式）与后端 AI 配置。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { createDoc } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, clickAt, aiScrollMetrics, userScrollTo, userScrollToBottom, waitForAtBottom } from './helpers/page'

/** 等待 AI 流开始（scrollHeight 增长说明首个 chunk 已渲染） */
async function waitForStreamStart(page: Page, initialHeight: number, timeoutMs = 20_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const m = await aiScrollMetrics(page)
    if (m && m.scrollHeight > initialHeight + 100) return
    await wait(300)
  }
  throw new Error('等待 AI 流式输出开始超时')
}

describe('AI 输出吸底跟随', () => {
  let browser: Browser
  let page: Page
  let docId: string

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    const doc = await createDoc('e2e-吸底滚动')
    docId = doc.id
    // 全文视图（casual 会话挂在 docId 下）
    await page.goto(`${devBase()}#/pages/edit/index?docId=${docId}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('贴底跟随：流式输出期间视口保持贴底（dist ≤ 10）', async () => {
    // 发送一条消息触发 AI 流
    const inputPos = await page.evaluate(() => {
      const ta = document.querySelector('taro-textarea-core.ai-panel-input textarea')
      if (!ta) return null
      const r = ta.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await clickAt(page, inputPos)
    await wait(300)
    await page.keyboard.type('请审阅这段内容')
    await wait(300)
    const sendPos = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.btn')).find((el) => (el.textContent || '').trim().includes('➤'))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await clickAt(page, sendPos)

    const before = await aiScrollMetrics(page)
    expect(before).not.toBeNull()
    await waitForStreamStart(page, before!.scrollHeight)

    // 等待跟随落定（首 chunk 渲染后 follow 效果把视口贴到底部），再采样
    const s1 = await waitForAtBottom(page)
    await wait(600)
    const s2 = await aiScrollMetrics(page)
    // 流式进行中：内容在增长，且视口一直贴底（≤10px）
    expect(s2!.scrollHeight).toBeGreaterThan(s1.scrollHeight)
    expect(s2!.distFromBottom).toBeLessThanOrEqual(10)
  })

  it('滚离底部后不再吸底（视角不被拉回）', async () => {
    // 用户滚到远离底部的位置
    await userScrollTo(page, 100)
    await wait(300)
    const s3 = await aiScrollMetrics(page)
    await wait(900) // 流式继续输出
    const s4 = await aiScrollMetrics(page)
    // 内容仍在增长，但 scrollTop 纹丝不动（不把视角拉回底部）
    expect(s4!.scrollHeight).toBeGreaterThan(s3!.scrollHeight)
    expect(s4!.scrollTop).toBe(s3!.scrollTop)
  })

  it('滚回底部 10px 内自动恢复跟随', async () => {
    // 滚回最底部（直接设 scrollTop = scrollHeight，浏览器钳制到真实底部，
    // 避免按旧高度计算目标在流式增长后偏短）
    await userScrollToBottom(page)
    // 恢复跟随需等下一个 chunk 触发的 follow 滚动
    const s5 = await waitForAtBottom(page)
    await wait(800)
    const s6 = await aiScrollMetrics(page)
    // 恢复跟随：贴底且 scrollTop 随内容增长
    expect(s6!.distFromBottom).toBeLessThanOrEqual(10)
    expect(s6!.scrollTop).toBeGreaterThan(s5.scrollTop)
  })
})
