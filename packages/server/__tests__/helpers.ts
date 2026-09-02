import { beforeAll, afterAll, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Hono } from 'hono'

// COEDITOR_DATA_DIR is set by vitest.setup.ts (setupFiles) before anything
// imports app modules — DATA_ROOT is resolved at module-load time.
const TEST_DIR = process.env.COEDITOR_DATA_DIR as string

// 测试数据目录：复制随包提交的模板文件（resources/templates/*.json）
const REPO_TEMPLATES_DIR = path.resolve(import.meta.dirname, '../resources/templates')

export function getTestDir() {
  return TEST_DIR
}

export function setupTestEnv() {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true })
    await fs.cp(REPO_TEMPLATES_DIR, path.join(TEST_DIR, 'templates'), { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    delete process.env.COEDITOR_DATA_DIR
  })
}

/** Create RPC test helpers bound to a Hono app instance */
export function createRpcHelpers(app: Hono) {
  async function rpc<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<{ success: boolean; data?: T; error?: string }> {
    const res = await app.request(`/api/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return res.json() as Promise<{ success: boolean; data?: T; error?: string }>
  }

  async function rpcOk<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const result = await rpc<T>(action, params)
    expect(result.success).toBe(true)
    return result.data!
  }

  async function rpcFail(action: string, params: Record<string, unknown> = {}): Promise<string> {
    const result = await rpc(action, params)
    expect(result.success).toBe(false)
    return result.error!
  }

  return { rpc, rpcOk, rpcFail }
}
