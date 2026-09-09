// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyResponse } from '@/api/client'
import type { CoEditorPlugin } from '@/plugin/types'

// Taro 运行时需要编译期常量（ENABLE_INNER_HTML 等），单测中 mock 掉
vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: () => Promise.reject(new Error('mocked')),
  },
}))

/**
 * onResponse 契约测试：
 * - boolean true = 已处理（不重试）
 * - { retry: true } = 已处理且请求方应用新状态重试一次（如静默续期换新 token）
 * - false / 无插件 = 未处理
 */
vi.mock('@plugin-registry', () => {
  const mutable: { plugins: CoEditorPlugin[] } = { plugins: [] }
  return { plugins: mutable.plugins }
})

import { getPlugins } from '@/plugin'

function pluginWith(onResponse: CoEditorPlugin['request'] extends infer R ? NonNullable<R>['onResponse'] : never): CoEditorPlugin {
  return { id: 'test', request: { onResponse } } as CoEditorPlugin
}

describe('notifyResponse onResponse 契约', () => {
  beforeEach(() => {
    getPlugins().splice(0, getPlugins().length)
  })

  it('无插件 → { handled: false, retry: false }', async () => {
    const r = await notifyResponse({ success: false, error: 'x', action: 'a' })
    expect(r).toEqual({ handled: false, retry: false })
  })

  it('返回 true → handled，不重试', async () => {
    getPlugins().push(pluginWith(() => true))
    const r = await notifyResponse({ success: false, error: 'x', action: 'a' })
    expect(r).toEqual({ handled: true, retry: false })
  })

  it('返回 { retry: true } → handled 且请求方应重试', async () => {
    getPlugins().push(pluginWith(() => ({ retry: true })))
    const r = await notifyResponse({ success: false, error: 'x', action: 'a' })
    expect(r).toEqual({ handled: true, retry: true })
  })

  it('返回 { retry: false } → handled，不重试', async () => {
    getPlugins().push(pluginWith(() => ({ retry: false })))
    const r = await notifyResponse({ success: false, error: 'x', action: 'a' })
    expect(r).toEqual({ handled: true, retry: false })
  })

  it('返回 false → 未处理', async () => {
    getPlugins().push(pluginWith(() => false))
    const r = await notifyResponse({ success: false, error: 'x', action: 'a' })
    expect(r).toEqual({ handled: false, retry: false })
  })

  it('首个处理插件生效（后续插件不再调用）', async () => {
    const calls: string[] = []
    getPlugins().push(
      pluginWith(() => { calls.push('first'); return { retry: true } }),
      pluginWith(() => { calls.push('second'); return true }),
    )
    const r = await notifyResponse({ success: false, error: 'x', action: 'a' })
    expect(r).toEqual({ handled: true, retry: true })
    expect(calls).toEqual(['first'])
  })
})
