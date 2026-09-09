/**
 * E2E 全局 setup：启动后端（独立数据目录 + mock AI 配置）、mock AI 上游、
 * H5 dev server（独立端口，compress:false 保证 SSE 流式），全部就绪后跑测试；
 * teardown 负责回收。
 *
 * 端口：E2E_BACKEND_PORT（默认 3101）/ E2E_DEV_PORT（默认 5175）/ E2E_MOCK_PORT（默认 3199）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockAI } from './fixtures/mock-ai'
import { getE2EEnv } from './helpers/env'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(__dirname, '..')
const SERVER_DIR = path.resolve(__dirname, '../../server')

interface ReadyServer {
  proc: ChildProcess
  logFile: string
}

/**
 * 找可用的 node 可执行文件。正常环境 process.execPath 就是 node；
 * 在嵌入式 Node 运行时（如 DSH Desktop 等宿主应用内跑 vitest）里 execPath 指向
 * 宿主应用而非 node，必须回退到 PATH 上的 node（或 E2E_NODE_BIN 显式指定）。
 */
function findNodeBin(): string {
  if (process.env.E2E_NODE_BIN) return process.env.E2E_NODE_BIN
  if (process.execPath.endsWith('node')) return process.execPath
  return 'node'
}

async function waitForHttp(
  probe: () => Promise<boolean>,
  label: string,
  timeoutMs: number,
  logFile?: string,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await probe()) return
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  let tail = ''
  if (logFile && existsSync(logFile)) {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
    tail = `\n--- ${label} 日志尾部 ---\n${lines.slice(-20).join('\n')}`
  }
  throw new Error(`e2e 等待 ${label} 超时（${timeoutMs}ms）${tail}`)
}

/** 追加进程日志（尽力而为，teardown 清理日志目录时可能偶发写失败，不能崩掉测试） */
function appendLog(file: string, data: unknown): void {
  try {
    writeFileSync(file, String(data), { flag: 'a' })
  } catch {
    /* best-effort */
  }
}

export default async function setup() {
  const env = getE2EEnv()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'coeditor-e2e-data-'))
  const logDir = mkdtempSync(path.join(tmpdir(), 'coeditor-e2e-logs-'))
  const servers: ReadyServer[] = []
  let mock: Awaited<ReturnType<typeof startMockAI>> | null = null

  const backendPort = env.backendPort
  const devPort = env.devPort
  const mockPort = env.mockPort

  // 诊断：记录解析路径（vitest 可能对 globalSetup 做转译，__dirname 未必是源码目录）
  writeFileSync(
    path.join(logDir, 'setup.log'),
    JSON.stringify({
      __dirname,
      SERVER_DIR,
      CLIENT_DIR,
      execPath: process.execPath,
      cwd: process.cwd(),
      nodeVersion: process.version,
    }, null, 1),
  )

  // 端口占用预检：避免复用上一次残留的进程导致状态脏
  for (const [label, port] of [['backend', backendPort], ['dev', devPort], ['mock', mockPort]] as const) {
    if (await new Promise<boolean>((resolve) => {
      const sock = connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); resolve(true) })
      sock.once('error', () => resolve(false))
    })) {
      throw new Error(`e2e 端口 ${port}（${label}）已被占用，请先停掉残留进程或改用 E2E_*_PORT`)
    }
  }

  try {
    // 1) mock AI 上游
    mock = await startMockAI(mockPort)

    // 2) 后端：独立数据目录。
    // 注意必须把 NODE_ENV 从 vitest 的 "test" 覆盖掉：server 在 NODE_ENV==='test'
    // 时只做初始化、不监听端口（供单测直接调 app.fetch），会静默退出 0。
    const backendLog = path.join(logDir, 'backend.log')
    const backend = spawn(findNodeBin(), ['--import', 'tsx', 'src/index.ts'], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(backendPort),
        COEDITOR_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    backend.stdout?.on('data', (d) => appendLog(backendLog, d))
    backend.stderr?.on('data', (d) => appendLog(backendLog, d))
    backend.on('error', (e) => appendLog(backendLog, `[spawn error] ${e.message}\n`))
    backend.on('exit', (code, signal) =>
      appendLog(backendLog, `[exit code=${code} signal=${signal}]\n`))
    servers.push({ proc: backend, logFile: backendLog })
    await waitForHttp(
      async () => {
        const res = await fetch(`http://localhost:${backendPort}/api/settings.get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        return res.ok
      },
      '后端就绪',
      60_000,
      backendLog,
    )
    // 配置 AI 上游指向 mock
    const settingsRes = await fetch(`http://localhost:${backendPort}/api/settings.update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'e2e-key',
        apiBaseUrl: `http://127.0.0.1:${mockPort}`,
        model: 'e2e-model',
      }),
    })
    if (!settingsRes.ok) throw new Error(`settings.update 失败: ${await settingsRes.text()}`)

    // 3) H5 dev server（独立端口；config 读 E2E_DEV_PORT/E2E_BACKEND_PORT）
    const devLog = path.join(logDir, 'dev.log')
    const dev = spawn('pnpm', ['dev'], {
      cwd: CLIENT_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        E2E_DEV_PORT: String(devPort),
        E2E_BACKEND_PORT: String(backendPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    dev.stdout?.on('data', (d) => appendLog(devLog, d))
    dev.stderr?.on('data', (d) => appendLog(devLog, d))
    dev.on('error', (e) => appendLog(devLog, `[spawn error] ${e.message}\n`))
    dev.on('exit', (code, signal) =>
      appendLog(devLog, `[exit code=${code} signal=${signal}]\n`))
    servers.push({ proc: dev, logFile: devLog })
    await waitForHttp(async () => {
      const res = await fetch(`http://localhost:${devPort}/`)
      return res.ok
    }, 'dev server 就绪', 180_000, devLog)
    // 等编辑页 chunk 编译完成（首屏 bundle 就绪，否则浏览器加载会等编译）
    await waitForHttp(async () => {
      const res = await fetch(`http://localhost:${devPort}/chunk/src_pages_edit_index_tsx.js`)
      return res.ok
    }, '编辑页 bundle 编译完成', 180_000, devLog)

    return async () => {
      for (const s of servers) {
        try {
          s.proc.kill('SIGTERM')
        } catch {
          /* ignore */
        }
      }
      mock?.close()
      rmSync(dataDir, { recursive: true, force: true })
      // 日志目录留在系统临时目录便于失败排查，由系统清理
    }
  } catch (err) {
    for (const s of servers) {
      try { s.proc.kill('SIGTERM') } catch { /* ignore */ }
    }
    mock?.close()
    rmSync(dataDir, { recursive: true, force: true })
    // 失败时保留日志目录便于排查（路径随错误信息输出）
    const logTail = Object.fromEntries(
      readdirSync(logDir).map((f) => [f, readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).slice(-15)]),
    )
    const err2 = new Error(`${(err as Error).message}\n--- 进程日志 ---\n${JSON.stringify(logTail, null, 1)}`)
    throw err2
  }
}
