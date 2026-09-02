/**
 * 导入导出（H5/桌面端）端到端：
 * - 编辑面板左下角【导出】→ 触发 md 下载（Content-Disposition 文件名）
 * - 首页【导入】→ 文件选择 → mock AI 分章（非流式）→ 跳转新文档 → 章节落库正确
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { createDoc, createChapter, listChapters } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, findLeaf, clickAt } from './helpers/page'

/** 与 e2e/fixtures/mock-ai.ts 的 IMPORT_PLAN_JSON startHint 逐字匹配。 */
const IMPORT_CONTENT = '第一章 晨雾\n\n天刚蒙蒙亮，镇上还笼罩着一层薄雾。\n\n雾气里传来几声犬吠。\n\n第二章 山神庙\n\n庙门半掩着，蛛网在梁间晃动。\n\n香灰落进铜炉。\n\n第三章 归途\n\n下山时太阳已经出来了。\n\n他笑了笑，背起竹篓。'

describe('导入导出（H5）', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await launchBrowser()
    // headless 默认拒绝自动下载：允许下载到临时目录，download 事件才会触发
    const downloadDir = mkdtempSync(path.join(tmpdir(), 'coeditor-e2e-dl-'))
    await browser.defaultBrowserContext().setDownloadBehavior({ policy: 'allow', downloadPath: downloadDir })
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.warn('[console]', m.type(), m.text())
    })
    page.on('requestfailed', (r) => console.warn('[reqfail]', r.url(), r.failure()?.errorText))
  })

  afterAll(async () => {
    await browser.close()
  })

  it('编辑面板左下角导出：点击触发 md 下载', async () => {
    const doc = await createDoc('e2e-export-doc')
    await createChapter(doc.id, '第一章')

    await page.goto(`${devBase()}#/pages/edit/index?docId=${doc.id}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(3000)

    const btn = await findLeaf(page, 'Export|导出')
    expect(btn).not.toBeNull()

    // 捕获导出请求响应：验证文件流（Content-Disposition 文件名）。
    // headless-shell 对 blob URL 下载不触发 download 事件（真实浏览器为标准行为），
    // 且响应 body 被页面 fetch 消费后 puppeteer 读不到，这里断言下载前的完整链路。
    const exportResp = new Promise<{ status: number; cd: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('未捕获到 documents.export 请求（按钮点击未触发导出）')), 10_000)
      page.on('response', (r) => {
        if (r.url().includes('/api/documents.export')) {
          clearTimeout(timer)
          resolve({ status: r.status(), cd: r.headers()['content-disposition'] || '' })
        }
      })
    })
    await clickAt(page, btn)
    const resp = await exportResp
    expect(resp.status).toBe(200)
    expect(resp.cd).toContain(encodeURIComponent('e2e-export-doc.md'))
  })

  it('首页导入：文件选择 → AI 分章 → 跳转新文档且章节正确', async () => {
    await page.goto(`${devBase()}`, { waitUntil: 'networkidle2', timeout: 120_000 })
    await wait(2000)

    const btn = await findLeaf(page, 'Import|导入')
    expect(btn).not.toBeNull()
    // 直接派发 click 事件（坐标点击可能受 Taro 事件绑定/布局影响，DOM 事件最可靠）
    const dispatched = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('taro-view-core, taro-text-core')).find(
        (e) => (e.textContent || '').trim() === 'Import' || (e.textContent || '').trim() === '导入',
      )
      if (!el) return false
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      return true
    })
    expect(dispatched).toBe(true)

    // 动态创建的 file input（点击导入按钮后挂载）
    await page.waitForSelector('input[type=file]', { timeout: 10_000 })
    const fileInput = await page.$('input[type=file]')
    expect(fileInput).not.toBeNull()
    const importFile = path.join(mkdtempSync(path.join(tmpdir(), 'coeditor-e2e-import-')), '测试导入.txt')
    writeFileSync(importFile, IMPORT_CONTENT)
    await fileInput!.uploadFile(importFile)

    // mock AI 即时返回 → 跳转编辑页
    await page.waitForFunction(() => window.location.hash.includes('pages/edit/index'), { timeout: 30_000 })
    await wait(2000)

    const hash = await page.evaluate(() => window.location.hash)
    const docId = hash.match(/docId=([^&]+)/)?.[1]
    expect(docId).toBeTruthy()
    const chapters = await listChapters(docId!)
    expect(chapters.map((c) => c.title)).toEqual(['第一章 晨雾', '第二章 山神庙', '第三章 归途'])
  })
})
