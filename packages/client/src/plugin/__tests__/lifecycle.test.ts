import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runInitFor, getCurrentUserFor } from '../lifecycle-core'
import { runInit, getCurrentUser, getPlugins, mergePluginDictionaries } from '../index'
import { t } from '../../lib/i18n'
import { useI18nStore } from '../../stores/i18nStore'
import type { CoEditorPlugin, UserInfo } from '../types'

// 隔离默认注册表：用假插件验证 index 包装逻辑（避免加载真实组件链）
vi.mock('@plugin-registry', () => ({
  plugins: [
    {
      id: 'fake-a',
      app: { onInit: async () => { (globalThis as Record<string, unknown>).__initOrder = 'a' } },
      i18n: { zh: { greeting: '你好' }, en: { greeting: 'Hi' } },
    },
    { id: 'fake-b' },
    { id: 'fake-c', user: { get: async () => ({ name: 'C-User' }) } },
  ],
}))

// Taro storage mock（i18nStore 初始化会读 localStorage）
vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: () => Promise.reject(new Error('mocked')),
  },
}))

beforeEach(() => {
  useI18nStore.setState({ language: 'zh' })
  delete (globalThis as Record<string, unknown>).__initOrder
})

describe('runInitFor — 启动钩子聚合（纯逻辑）', () => {
  it('按注册顺序依次执行所有 onInit', async () => {
    const order: string[] = []
    const a: CoEditorPlugin = { id: 'a', app: { onInit: async () => { order.push('a') } } }
    const b: CoEditorPlugin = { id: 'b', app: { onInit: async () => { order.push('b') } } }
    const idle: CoEditorPlugin = { id: 'idle' }
    await runInitFor([a, idle, b])
    expect(order).toEqual(['a', 'b'])
  })

  it('onInit 的异步结果被等待', async () => {
    let done = false
    const p: CoEditorPlugin = { id: 'p', app: { onInit: async () => { await new Promise((r) => setTimeout(r, 10)); done = true } } }
    await runInitFor([p])
    expect(done).toBe(true)
  })
})

describe('getCurrentUserFor — 排他查询（纯逻辑）', () => {
  it('第一个返回非 null 的插件生效', async () => {
    const a: CoEditorPlugin = { id: 'a', user: { get: async () => null } }
    const b: CoEditorPlugin = { id: 'b', user: { get: async () => ({ name: 'B' }) } }
    const c: CoEditorPlugin = { id: 'c', user: { get: async () => ({ name: 'C' }) } }
    expect(await getCurrentUserFor([a, b, c])).toEqual({ name: 'B' })
  })

  it('全部返回 null 时结果为 null', async () => {
    const a: CoEditorPlugin = { id: 'a', user: { get: async () => null } }
    expect(await getCurrentUserFor([a])).toBeNull()
  })

  it('无 user.get 的插件跳过', async () => {
    const idle: CoEditorPlugin = { id: 'idle' }
    const b: CoEditorPlugin = { id: 'b', user: { get: async () => ({ name: 'B' } as UserInfo) } }
    expect(await getCurrentUserFor([idle, b])).toEqual({ name: 'B' })
  })
})

describe('plugin/index — registry 包装（mock 注册表回归）', () => {
  it('getPlugins 返回注册表插件', () => {
    expect(getPlugins().map((p) => p.id)).toEqual(['fake-a', 'fake-b', 'fake-c'])
  })

  it('runInit 依次执行全部 onInit', async () => {
    await runInit()
    expect((globalThis as Record<string, unknown>).__initOrder).toBe('a')
  })

  it('getCurrentUser 排他取第一个非 null', async () => {
    expect(await getCurrentUser()).toEqual({ name: 'C-User' })
  })

  it('mergePluginDictionaries 合并插件字典（plugin.<id>. 前缀）', () => {
    mergePluginDictionaries()
    expect(t('plugin.fake-a.greeting')).toBe('你好')
    useI18nStore.setState({ language: 'en' })
    expect(t('plugin.fake-a.greeting')).toBe('Hi')
  })
})
