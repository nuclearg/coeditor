import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { getTestDir } from './helpers'
import { defaultDataRoot, getDataDirPrefFile, setDataRoot } from '../src/store/file-paths'
import { repo } from '../src/store/index'

setupTestEnv()

// 把偏好文件重定向到临时路径，避免污染用户真实的 ~/.config/coeditor/data-dir.json。
// getDataDirPrefFile() 运行时求值，settings.update 持久化时读取该 env。
const PREF_FILE = path.join(tmpdir(), `coeditor-data-pref-${process.pid}-${Date.now()}.json`)
const NEW_DIR = path.join(tmpdir(), `coeditor-data-switch-${process.pid}-${Date.now()}`)

beforeAll(() => {
  process.env.COEDITOR_DATA_DIR_FILE = PREF_FILE
})

afterAll(async () => {
  delete process.env.COEDITOR_DATA_DIR_FILE
  await fs.rm(PREF_FILE, { force: true })
  await fs.rm(NEW_DIR, { recursive: true, force: true })
})

const { rpcOk, rpcFail } = createRpcHelpers(app)

describe('数据目录（settings.dataDir）', () => {
  it('指针文件默认位置 = 平台默认数据目录/data-dir.json（用户感知不到配置目录）', () => {
    const saved = process.env.COEDITOR_DATA_DIR_FILE
    delete process.env.COEDITOR_DATA_DIR_FILE
    try {
      expect(getDataDirPrefFile()).toBe(path.join(defaultDataRoot(), 'data-dir.json'))
    } finally {
      if (saved !== undefined) process.env.COEDITOR_DATA_DIR_FILE = saved
    }
  })

  it('settings.get — 返回当前数据目录', async () => {
    const s = await rpcOk<{ dataDir: string }>('settings.get')
    expect(s.dataDir).toBe(path.resolve(getTestDir()))
  })

  it('initialize — 首次运行写入内置模板种子（含内置 prompts）', async () => {
    const fresh = path.join(tmpdir(), `coeditor-fresh-${process.pid}-${Date.now()}`)
    try {
      setDataRoot(fresh)
      await repo.initialize()
      await expect(fs.stat(path.join(fresh, 'templates/novel.json'))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(fresh, 'templates/essay.json'))).resolves.toBeTruthy()
      // 审阅 prompt 已内置于模板（顶层 prompts + 附件级 prompts），不再有独立 prompts 目录
      const novel = JSON.parse(await fs.readFile(path.join(fresh, 'templates/novel.json'), 'utf8'))
      expect(novel.prompts?.fulltext?.gentle).toBeTruthy()
      expect(novel.attachments[0].prompts?.strict).toBeTruthy()
      await expect(fs.stat(path.join(fresh, 'prompts'))).rejects.toThrow()
      // 幂等：重复 initialize 不报错、不覆盖
      const content = await fs.readFile(path.join(fresh, 'templates/novel.json'), 'utf8')
      await repo.initialize()
      expect(await fs.readFile(path.join(fresh, 'templates/novel.json'), 'utf8')).toBe(content)
    } finally {
      setDataRoot(path.resolve(getTestDir()))
      await fs.rm(fresh, { recursive: true, force: true })
    }
  })

  it('settings.update({ dataDir }) — 拒绝相对路径', async () => {
    const err = await rpcFail('settings.update', { dataDir: 'relative/path' })
    expect(err).toContain('绝对路径')
  })

  it('settings.update({ dataDir }) — 切换根目录、迁移种子、持久化偏好', async () => {
    const res = await rpcOk<{ dataDir: string }>('settings.update', { dataDir: NEW_DIR })
    expect(res.dataDir).toBe(path.resolve(NEW_DIR))

    // 切换后新目录立即生效：创建文档落到新根目录
    await rpcOk('documents.create', { id: 'doc_after_switch', title: '切换后' })
    const newDocDir = path.join(path.resolve(NEW_DIR), 'users/default_user/docs/doc_after_switch')
    await expect(fs.stat(newDocDir)).resolves.toBeTruthy()

    // 种子迁移：templates 从旧目录复制到新目录（prompts 已并入模板，不再单独迁移）
    await expect(fs.stat(path.join(path.resolve(NEW_DIR), 'templates/novel.json'))).resolves.toBeTruthy()

    // 旧目录数据保留
    await expect(fs.stat(path.join(path.resolve(getTestDir()), 'users/default_user'))).resolves.toBeTruthy()

    // 偏好已持久化（写到重定向的 PREF_FILE）
    const pref = JSON.parse(await fs.readFile(PREF_FILE, 'utf8')) as { dataDir: string }
    expect(pref.dataDir).toBe(path.resolve(NEW_DIR))

    // 清理：切回原目录，避免影响同 worker 内后续文件
    const back = await rpcOk<{ dataDir: string }>('settings.update', { dataDir: getTestDir() })
    expect(back.dataDir).toBe(path.resolve(getTestDir()))
  })

  it('改回平台默认目录时删除偏好文件（用户没手工改过就不留配置文件）', async () => {
    // 先手工改成自定义目录 → 偏好文件生成
    await rpcOk('settings.update', { dataDir: NEW_DIR })
    await expect(fs.stat(PREF_FILE)).resolves.toBeTruthy()

    // 把 HOME 指向临时目录，让「平台默认目录」落在临时位置，避免污染真实机器
    const fakeHome = path.join(tmpdir(), `coeditor-home-${process.pid}`)
    const savedHome = process.env.HOME
    process.env.HOME = fakeHome
    try {
      const back = await rpcOk<{ dataDir: string }>('settings.update', { dataDir: defaultDataRoot() })
      expect(back.dataDir).toBe(path.resolve(defaultDataRoot()))
      // 改回默认目录后，偏好文件应被删除
      await expect(fs.stat(PREF_FILE)).rejects.toThrow()
    } finally {
      process.env.HOME = savedHome
      await fs.rm(fakeHome, { recursive: true, force: true })
    }

    // 恢复数据目录，避免影响同文件后续用例
    await rpcOk('settings.update', { dataDir: getTestDir() })
  })
})
