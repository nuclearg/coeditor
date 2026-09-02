/**
 * E2E 专用 mock AI 上游（OpenAI 兼容 SSE）。
 *
 * 供 e2e 测试验证 AI 流式输出的吸底滚动等行为：流足够长、足够慢，
 * 让测试能在流式进行中执行"滚离底部"等操作。默认参数可通过环境变量覆盖：
 *   E2E_MOCK_CHUNKS 总块数（默认 70）
 *   E2E_MOCK_DELAY  每块间隔 ms（默认 100）
 *   E2E_MOCK_CHARS  每块字符数（默认 30）
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const CHUNKS = Number(process.env.E2E_MOCK_CHUNKS) || 100
const DELAY = Number(process.env.E2E_MOCK_DELAY) || 120
const CHARS = Number(process.env.E2E_MOCK_CHARS) || 30

/**
 * 非流式（documents.importText 分章）固定响应：切分指令的 startHint 必须与
 * e2e/import-export.test.ts 的 IMPORT_CONTENT 逐字匹配（后端按原文锚点定位）。
 */
const IMPORT_PLAN_JSON = JSON.stringify({
  chapters: [
    { title: '第一章 晨雾', startHint: '天刚蒙蒙亮，镇上还笼罩着一层薄雾。' },
    { title: '第二章 山神庙', startHint: '庙门半掩着，蛛网在梁间晃动。' },
    { title: '第三章 归途', startHint: '下山时太阳已经出来了。' },
  ],
})

function buildContent(chunks: number): string {
  const paragraphs: string[] = []
  for (let i = 0; i < chunks; i++) {
    paragraphs.push(
      `这是第 ${i + 1} 段 E2E 模拟 AI 输出的内容，用于撑高对话区域以验证流式输出的吸底滚动行为是否按预期工作。`,
    )
  }
  return paragraphs.join('\n\n')
}

export function startMockAI(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' })
        res.end()
        return
      }
      if (!req.url?.includes('/chat/completions')) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      // 非流式（stream:false，documents.importText 分章）：返回固定切分指令 JSON
      let body = ''
      req.on('data', (d: Buffer) => {
        body += d.toString('utf8')
      })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          if (parsed.stream === false) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ choices: [{ message: { content: IMPORT_PLAN_JSON } }] }))
            return
          }
        } catch {
          /* 非 JSON 或解析失败：回退 SSE（兼容旧行为） */
        }
        sendSse()
      })
      return

      function sendSse() {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        const text = buildContent(CHUNKS)
        const chunks = text.match(new RegExp(`.{1,${CHARS}}`, 'gs')) || []
        let i = 0
        const sendChunk = () => {
          if (i >= chunks.length) {
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          const delta = chunks[i++]
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
          setTimeout(sendChunk, DELAY)
        }
        sendChunk()
      }
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as AddressInfo).port
      // 允许 port=0（随机端口）：把实际端口写回供调用方使用
      ;(server as Server & { actualPort?: number }).actualPort = actual
      resolve(server)
    })
  })
}
