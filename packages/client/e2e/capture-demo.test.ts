/**
 * 产品演示素材录制（按需运行，默认跳过 → 对常规 `pnpm test:e2e` 无副作用）。
 *
 * 为什么放在 e2e 目录：它**复用 e2e 那套已跑通的基建**（globalSetup 起真实后端 +
 * mock AI + H5 dev server，puppeteer 驱动真实浏览器）。所以录到的是**真实界面**，
 * 不是照着产品画的示意图。
 *
 * 运行（完整流程见 coeditor-frontpage/README.md 的「演示素材」一节）：
 *   CAPTURE_DEMO=1 CAPTURE_OUT=/tmp/shots \
 *   E2E_MOCK_TEXT_FILE=e2e/fixtures/demo-review.txt E2E_MOCK_CHARS=8 E2E_MOCK_DELAY=130 \
 *   pnpm exec vitest run --config vitest.e2e.config.ts e2e/capture-demo.test.ts
 *   python3 ../coeditor-frontpage/tools/make-demo-gifs.py /tmp/shots   # 合成 GIF
 *
 * 环境变量：
 *   CAPTURE_DEMO        设了才跑
 *   CAPTURE_OUT         产物目录，默认 /tmp/coeditor-demo-shots
 *   CAPTURE_RECORD_MS   录像时长（默认 8000）
 *   E2E_MOCK_TEXT_FILE / CHARS / DELAY   控制 mock AI 的文案与流速（见 fixtures/mock-ai.ts）
 */
import { afterAll, beforeAll, describe, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, CDPSession, Page } from 'puppeteer'
import { launchBrowser } from './helpers/browser'
import { apiRpc } from './helpers/api'
import { devBase } from './helpers/env'
import { wait, findText } from './helpers/page'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, 'fixtures')
const OUT = process.env.CAPTURE_OUT || '/tmp/coeditor-demo-shots'
const ENABLED = !!process.env.CAPTURE_DEMO
const RECORD_MS = Number(process.env.CAPTURE_RECORD_MS) || 8000

const DEMO_TITLE = '守灯人'

/** 演示用附件：贴着 demo-manuscript.txt 写，让画面前后呼应 */
const ATTACHMENTS: Record<string, string> = {
  outline: [
    '一、晨雾：老陈发现长明灯灯芯结花，镇上有异。',
    '二、山神庙：庙中无人，香炉灰是干的，捡到一枚旧纽扣。',
    '三、归途：下山回镇，把纽扣放在灯旁，最后吹灭了灯。',
    '',
    '主题：守与放。守的是规矩，放的是执念。',
  ].join('\n'),
  worldview: [
    '地点：江南小镇「清河」，祠堂兼作守灯人的住处。',
    '长明灯：镇上旧俗，灯不灭则人心不散。规矩由守灯人世代相传。',
    '手艺：镇上曾有两家会做青布包边纽扣，另一家十年前绝了。',
  ].join('\n'),
  characters: [
    '老陈（守灯人，五十余岁）：寡言，习惯用动作代替说话。',
    '  弧光：从「灯不能灭」到亲手吹灭——规矩让位于他自己的判断。',
    '亡故的同行：只出现在纽扣与手艺里，不直接出场。',
  ].join('\n'),
  relations: [
    '老陈 → 长明灯：既是职责，也是枷锁。',
    '老陈 → 亡故同行：同行是唯一能印证纽扣来历的人，已死。',
    '老陈 → 镇上人：被人需要，但不被人理解。',
  ].join('\n'),
}

/** 解析 demo-manuscript.txt：`## 标题` 分章，章内空行分段 */
function parseManuscript(): { title: string; paragraphs: string[] }[] {
  const raw = readFileSync(path.join(FIXTURES, 'demo-manuscript.txt'), 'utf8')
  const chapters: { title: string; paragraphs: string[] }[] = []
  for (const block of raw.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split('\n')
    const paragraphs = rest.join('\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    if (head.trim() && paragraphs.length) chapters.push({ title: head.trim(), paragraphs })
  }
  if (!chapters.length) throw new Error('demo-manuscript.txt 解析不出章节（需要 `## 标题` 分章）')
  return chapters
}

/**
 * 直接建 章/段/草稿，**不走 documents.importText**：那条路要过 AI 分章、依赖 mock 的
 * 固定锚点，脆弱且与本脚本要展示的内容无关；直接建是确定性的，也更快。
 */
async function seedDocument(): Promise<string> {
  const doc = await apiRpc<{ id: string }>('documents.create', { title: DEMO_TITLE, templateId: 'novel' })
  for (const chapter of parseManuscript()) {
    const ch = await apiRpc<{ id: string }>('chapters.create', { docId: doc.id, title: chapter.title })
    for (const content of chapter.paragraphs) {
      const para = await apiRpc<{ id: string }>('paragraphs.create', {
        docId: doc.id,
        chapterId: ch.id,
        name: '',
      })
      await apiRpc('paragraphDrafts.create', {
        docId: doc.id,
        chapterId: ch.id,
        paragraphId: para.id,
        content,
      })
    }
  }
  for (const [type, content] of Object.entries(ATTACHMENTS)) {
    await apiRpc('attachmentDrafts.create', { docId: doc.id, type, content })
  }
  return doc.id
}

/** 把页面结构落盘，便于核对状态（自动化截图无法肉眼检查时的替代证据） */
async function dumpDom(page: Page, tag: string): Promise<Record<string, unknown>> {
  const info = await page.evaluate(() => {
    const brief = (el: Element) => {
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 80),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      }
    }
    const bySel = (s: string, n = 20) => Array.from(document.querySelectorAll(s)).slice(0, n).map(brief)
    return { innerText: document.body.innerText, buttons: bySel('.btn, button'), aiPanel: bySel('[class*=ai-panel]') }
  })
  writeFileSync(path.join(OUT, `dom-${tag}.json`), JSON.stringify(info, null, 1), 'utf8')
  return info
}

/** 按文本找可点元素中心（Taro 渲染的是自定义元素，文本挂在元素内） */
async function centerOfText(page: Page, text: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((m) => {
    const els = Array.from(document.querySelectorAll('taro-view-core, taro-text-core, div, button, span'))
    const el = els.find((e) => (e.textContent || '').trim() === m && e.getBoundingClientRect().width > 0)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, text)
}

async function newPage(browser: Browser, width: number, height: number, dsf: number): Promise<Page> {
  const page = await browser.newPage()
  // 强制中文界面：i18nStore 的初值取自 navigator.language，并读 localStorage['coeditor-lang']
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('coeditor-lang', 'zh')
    } catch {
      /* 首帧可能还没有 origin，忽略 */
    }
    Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' })
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] })
  })
  await page.setViewport({ width, height, deviceScaleFactor: dsf })
  page.on('pageerror', (e: unknown) => console.warn('[pageerror]', e instanceof Error ? e.message : String(e)))
  return page
}

async function openEditor(page: Page, docId: string): Promise<void> {
  await page.goto(`${devBase()}#/pages/edit/index?docId=${docId}`, {
    waitUntil: 'networkidle2',
    timeout: 120_000,
  })
  await wait(5000)
}

interface TimedAction {
  /** 录制开始后第几毫秒执行 */
  atMs: number
  label: string
  /** 返回点击坐标：合成 GIF 时据此叠加光标（自动化截图本身不含光标，观众看不出点了哪） */
  run: () => Promise<{ x: number; y: number } | null>
}

/**
 * 用 CDP screencast 录像。
 *
 * 为什么不用 `page.screenshot` 连拍：实测每帧约 185ms（~5.4fps），出来是幻灯片。
 * screencast 走 JPEG 帧流，能到 10–20fps，且只在画面变化时推帧——配合把每帧的
 * **真实时间戳**记下来（交给合成脚本换算各帧时长），静止段就自然停住，不会快进。
 */
async function record(
  page: Page,
  prefix: string,
  durationMs: number,
  actions: TimedAction[],
): Promise<{ count: number; marks: { label: string; frame: number }[] }> {
  const client: CDPSession = await page.createCDPSession()
  const shots: { file: string; ts: number }[] = []
  let i = 0
  const onFrame = (evt: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
    const file = path.join(OUT, `${prefix}-${String(i).padStart(4, '0')}.jpg`)
    writeFileSync(file, Buffer.from(evt.data, 'base64'))
    shots.push({ file, ts: evt.metadata.timestamp })
    i += 1
    void client.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {})
  }
  client.on('Page.screencastFrame', onFrame)
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 82,
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: 1,
  })

  const marks: { label: string; frame: number; atMs: number; point: { x: number; y: number } | null }[] = []
  const pending = [...actions].sort((a, b) => a.atMs - b.atMs)
  const t0 = Date.now()
  let ai = 0
  while (Date.now() - t0 < durationMs) {
    const elapsed = Date.now() - t0
    while (ai < pending.length && elapsed >= pending[ai].atMs) {
      const point = await pending[ai].run()
      marks.push({ label: pending[ai].label, frame: shots.length, atMs: elapsed, point })
      ai += 1
    }
    await wait(40)
  }
  await client.send('Page.stopScreencast')
  client.off('Page.screencastFrame', onFrame)
  await client.detach()

  // 每帧的相对时间戳（ms）交给合成脚本换算时长
  const base = shots[0]?.ts ?? 0
  writeFileSync(
    path.join(OUT, `${prefix}-frames.json`),
    JSON.stringify(
      {
        fps: shots.length > 1 ? shots.length / ((shots[shots.length - 1].ts - base) || 1) : 0,
        marks,
        frames: shots.map((s) => ({ file: path.basename(s.file), tMs: Math.round((s.ts - base) * 1000) })),
      },
      null,
      1,
    ),
    'utf8',
  )
  return { count: shots.length, marks }
}

describe.skipIf(!ENABLED)('产品演示素材录制', () => {
  let browser: Browser
  let docId: string

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    docId = await seedDocument()
    browser = await launchBrowser()
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('静态图：三栏编辑界面（2x）', async () => {
    const page = await newPage(browser, 1440, 900, 2)
    await openEditor(page, docId)
    const info = await dumpDom(page, 'editor-zh')
    // 语言没生效就直接失败，免得录出一整套英文素材
    const text = String(info.innerText)
    if (!/审阅|全文|章节/.test(text)) {
      throw new Error(`界面未切换到中文，检查语言覆盖。innerText 片段：${text.slice(0, 200)}`)
    }
    await page.screenshot({ path: path.join(OUT, '01-editor.png') })
    await page.close()
  })

  it('静态图：段落审阅结果（2x）', async () => {
    const page = await newPage(browser, 1440, 900, 2)
    await openEditor(page, docId)
    const arrow = await findText(page, '›')
    if (arrow) {
      await page.mouse.click(arrow.x, arrow.y)
      await wait(700)
    }
    const para = await findText(page, '段落 2')
    if (para) {
      await page.mouse.click(para.x, para.y)
      await wait(900)
    }
    const btn = await centerOfText(page, '审阅')
    if (!btn) throw new Error('找不到「审阅」按钮')
    await page.mouse.click(btn.x, btn.y)

    // 等审阅意见出完（mock 流结束的标志句）
    let ok = false
    for (let i = 0; i < 40 && !ok; i++) {
      await wait(500)
      const t = String(await page.evaluate(() => document.body.innerText))
      ok = t.includes('分寸感')
    }
    if (!ok) throw new Error('审阅意见没有出完，静态图会是半截状态')
    await wait(900)
    await dumpDom(page, 'still-review')
    await page.screenshot({ path: path.join(OUT, '02-review.png') })
    await page.close()
  })

  it('录像：展开章节 → 选中段落 → 点审阅 → AI 流式给出意见', async () => {
    const page = await newPage(browser, 1280, 800, 1)
    await openEditor(page, docId)
    await dumpDom(page, 'video-before')

    // 动作排在录制时间轴上，而不是"先做完再录"——否则录到的全是等待画面。
    // 间隔刻意压紧：动作之间的空等会变成 GIF 里的长定格。
    const { count, marks } = await record(page, 'review', RECORD_MS, [
      {
        atMs: 300,
        label: '展开第一章',
        run: async () => {
          const a = await findText(page, '›')
          if (a) await page.mouse.click(a.x, a.y)
          await wait(350)
          return a
        },
      },
      {
        atMs: 1100,
        label: '选中「段落 2」',
        run: async () => {
          const p = await findText(page, '段落 2')
          if (p) await page.mouse.click(p.x, p.y)
          await wait(450)
          return p
        },
      },
      {
        atMs: 2100,
        label: '点「审阅」',
        run: async () => {
          const p = await centerOfText(page, '审阅')
          if (!p) throw new Error('找不到「审阅」按钮')
          await page.mouse.click(p.x, p.y)
          return p
        },
      },
    ])

    const after = await dumpDom(page, 'video-after')
    // 录到静止画面/静默失败就等于没录成——直接失败，别把废素材发出去
    const body = String(after.innerText)
    if (!/这一段的|仿佛|分寸感|建议/.test(body)) {
      throw new Error(`审阅意见没有出现在界面上（录到的可能是静止画面）。尾部：${body.slice(-200)}`)
    }
    if (count < 20) throw new Error(`只录到 ${count} 帧，screencast 可能没工作`)
    console.log(`[capture] 录到 ${count} 帧，动作标记:`, marks)
    await page.close()
  })
})
