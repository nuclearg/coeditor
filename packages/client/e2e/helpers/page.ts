/**
 * 页面 DOM 交互辅助。Taro H5 渲染的是自定义元素（taro-view-core /
 * taro-text-core / taro-scroll-view-core 等），文本直接挂在自定义元素内，
 * 因此用"按文本找叶子元素"的方式定位点击目标。
 */
import type { Page } from 'puppeteer'

export interface Point {
  x: number
  y: number
}

export async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 点击指定坐标并等待 UI 稳定（700ms） */
export async function clickAt(page: Page, p: Point | null | undefined, settleMs = 700): Promise<boolean> {
  if (!p) return false
  await page.mouse.click(p.x, p.y)
  await wait(settleMs)
  return true
}

/** 找到 textContent 匹配正则的"叶子" taro-view-core（无元素子节点）并返回中心坐标 */
export async function findLeaf(page: Page, reSrc: string): Promise<Point | null> {
  return page.evaluate((src) => {
    const re = new RegExp(src)
    const el = Array.from(document.querySelectorAll('taro-view-core')).find((e) => {
      const t = (e.textContent || '').trim()
      return re.test(t) && e.children.length === 0
    })
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, reSrc)
}

/** 找到 textContent 完全等于 text 的元素（taro-text-core 或叶子 taro-view-core）并返回中心坐标 */
export async function findText(page: Page, text: string): Promise<Point | null> {
  return page.evaluate((m) => {
    const el = Array.from(document.querySelectorAll('taro-text-core, taro-view-core')).find(
      (e) => (e.textContent || '').trim() === m,
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, text)
}

/** 打开移动端侧栏（main.head.left 的收起态 logo，data-sidebar-open） */
export async function openSidebarMobile(page: Page): Promise<void> {
  const b = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-sidebar-open]'))[0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await clickAt(page, b)
}

export async function sidebarOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.querySelector('[data-sidebar-region]'))
}

export interface StorageMap {
  [key: string]: string
}

export async function storageMap(page: Page): Promise<StorageMap> {
  return page.evaluate(() => {
    const o: StorageMap = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) as string
      o[k] = localStorage.getItem(k) || ''
    }
    return o
  })
}

export async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear())
}

/** 编辑器（正文）textarea 的当前值；非可编辑视图时返回 null */
export async function editorTextareaValue(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const ta = document.querySelector('taro-textarea-core.editor-textarea textarea')
    return ta ? (ta as HTMLTextAreaElement).value : null
  })
}

/** 点击编辑器 textarea（聚焦后即可输入） */
export async function clickEditorTextarea(page: Page): Promise<boolean> {
  const p = await page.evaluate(() => {
    const ta = document.querySelector('taro-textarea-core.editor-textarea textarea')
    if (!ta) return null
    const r = (ta as HTMLTextAreaElement).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  return clickAt(page, p)
}

/** AI 对话区滚动容器的指标（taro-scroll-view-core.taro-scroll-view__scroll-y） */
export async function aiScrollMetrics(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('taro-scroll-view-core.taro-scroll-view__scroll-y')
    if (!el) return null
    return {
      scrollTop: Math.round(el.scrollTop),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      distFromBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
    }
  })
}

/** 模拟用户滚动（滚轮事件 + scroll 事件，与真实用户操作一致） */
export async function userScrollTo(page: Page, scrollTop: number): Promise<void> {
  await page.evaluate((top) => {
    const el = document.querySelector('taro-scroll-view-core.taro-scroll-view__scroll-y') as HTMLElement
    if (!el) return
    el.scrollTop = top
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: top > el.scrollTop ? 500 : -500, bubbles: true }))
    el.dispatchEvent(new Event('scroll'))
  }, scrollTop)
}

/**
 * 模拟用户滚回最底部。注意不能按"读到的旧 scrollHeight"计算目标——流式期间
 * 内容持续增长，旧目标会短一截导致 dist 超阈值（吸底被误判解除）。直接设
 * scrollTop = scrollHeight（浏览器会钳制到真实底部）。
 */
export async function userScrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('taro-scroll-view-core.taro-scroll-view__scroll-y') as HTMLElement
    if (!el) return
    el.scrollTop = el.scrollHeight
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, bubbles: true }))
    el.dispatchEvent(new Event('scroll'))
  })
}

/** 轮询等待视口贴底（dist ≤ 10），用于流式刚启动/恢复跟随后的"落定"等待 */
export async function waitForAtBottom(page: Page, timeoutMs = 5000): Promise<NonNullable<Awaited<ReturnType<typeof aiScrollMetrics>>>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const m = await aiScrollMetrics(page)
    if (m && m.distFromBottom <= 10) return m
    await wait(200)
  }
  const m = await aiScrollMetrics(page)
  throw new Error(`等待贴底超时，最后指标: ${JSON.stringify(m)}`)
}
