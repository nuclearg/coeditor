/**
 * 回归：AI 气泡【重新生成】= 原地替换。
 *
 * - 点击重新生成后，旧气泡立即隐藏，新内容在旧气泡位置流式输出：
 *   流式期间页面只应有 1 个 .bubble-ai（旧行为是旧气泡 + 底部新气泡并存 = 2 个）；
 * - 完成后答案原地替换（服务端按 existingAnswerId 更新），不产生候选切换
 *   （不出现 "1/2" 切换器）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { createDoc } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, clickAt } from './helpers/page'

async function sendMessage(page: Page, text: string): Promise<void> {
  const inputPos = await page.evaluate(() => {
    const ta = document.querySelector('taro-textarea-core.ai-panel-input textarea')
    if (!ta) return null
    const r = ta.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await clickAt(page, inputPos)
  await wait(200)
  await page.keyboard.type(text)
  await wait(200)
  const sendPos = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.btn')).find((el) => (el.textContent || '').trim().includes('➤'))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await clickAt(page, sendPos)
}

/** 等待 AI 答案气泡出现（操作行含重试图标 = 流已结束、答案已持久化）。 */
async function waitForAnswer(page: Page, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const hasAction = await page.evaluate(() => !!document.querySelector('.bubble-ai .icon'))
    if (hasAction) return
    await wait(500)
  }
  throw new Error('等待 AI 答案（操作行出现）超时')
}

async function clickRetry(page: Page): Promise<void> {
  const p = await page.evaluate(() => {
    const all = document.querySelectorAll('.bubble-ai')
    const b = all[all.length - 1] as HTMLElement | undefined
    if (!b) return null
    const icon = b.querySelector('.icon') as HTMLElement | null
    if (!icon) return null
    const r = icon.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  expect(p).not.toBeNull()
  await clickAt(page, p, 200)
}

function bubbleCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('.bubble-ai').length)
}

describe('AI 重新生成 = 原地替换', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    const doc = await createDoc('e2e-retry-inplace')
    await page.goto(`${devBase()}#/pages/edit/index?docId=${doc.id}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)
    await sendMessage(page, '请审阅这段内容')
    await waitForAnswer(page)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('重新生成：旧气泡立即隐藏，流式期间只有一个气泡（原位输出）', async () => {
    // 重新生成前：1 个 AI 气泡
    expect(await bubbleCount(page)).toBe(1)
    await clickRetry(page)
    // 流式进行中（mock 总时长较长）：旧气泡已隐藏，仅原位流式气泡 1 个，
    // 底部不再追加第二个气泡
    await wait(600)
    expect(await bubbleCount(page)).toBe(1)
  })

  it('重新生成完成：原地替换，不出现候选切换（1/2）', async () => {
    await waitForAnswer(page)
    // 仍只有 1 个气泡，且无候选切换器（服务端原地更新，answer 未累积）
    expect(await bubbleCount(page)).toBe(1)
    const hasSwitcher = await page.evaluate(() => document.body.innerText.includes('1/2'))
    expect(hasSwitcher).toBe(false)
  })
})
