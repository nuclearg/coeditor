import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { computeSlotNode, resolveRenderer } from '../slot-core'
import type { CoEditorPlugin, PluginSlot, SlotCtxMap } from '../types'

const slot = 'main.head.left' as PluginSlot
// ctx 恒空纪律（docs/plugin.md §2）：调用方不再传 ctx
const ctx = {} as SlotCtxMap['main.head.left']

function plugin(id: string, render: (defaults: ReactNode, ctx: unknown) => ReactNode): CoEditorPlugin {
  return {
    id,
    ui: { slots: { [slot]: render as never } },
  } as unknown as CoEditorPlugin
}

describe('computeSlotNode — 链式装饰', () => {
  it('无插件时返回 defaults', () => {
    const node = computeSlotNode([], slot, ctx, 'DEFAULT')
    expect(node).toBe('DEFAULT')
  })

  it('单插件替换：不渲染 defaults', () => {
    const p = plugin('a', () => 'A')
    expect(computeSlotNode([p], slot, ctx, 'DEFAULT')).toBe('A')
  })

  it('单插件包裹：渲染 defaults 并包一层', () => {
    const p = plugin('a', (d) => `wrap(${d})`)
    expect(computeSlotNode([p], slot, ctx, 'D')).toBe('wrap(D)')
  })

  it('单插件追加：defaults + 自己的内容', () => {
    const p = plugin('a', (d) => `${d}+mine`)
    expect(computeSlotNode([p], slot, ctx, 'D')).toBe('D+mine')
  })

  it('多插件按注册顺序链式叠加（后注册包裹先注册）', () => {
    const a = plugin('a', (d) => `A(${d})`)
    const b = plugin('b', (d) => `B(${d})`)
    expect(computeSlotNode([a, b], slot, ctx, 'D')).toBe('B(A(D))')
  })

  it('链中替换不影响后续插件继续包裹', () => {
    const a = plugin('a', () => 'X') // 替换
    const b = plugin('b', (d) => `B(${d})`)
    expect(computeSlotNode([a, b], slot, ctx, 'D')).toBe('B(X)')
  })

  it('无插槽实现的插件跳过', () => {
    const idle: CoEditorPlugin = { id: 'idle' }
    const a = plugin('a', (d) => `A(${d})`)
    expect(computeSlotNode([idle, a], slot, ctx, 'D')).toBe('A(D)')
  })

  it('单个插件抛错不阻断整链', () => {
    const bad = plugin('bad', () => { throw new Error('boom') })
    const a = plugin('a', (d) => `A(${d})`)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(computeSlotNode([bad, a], slot, ctx, 'D')).toBe('A(D)')
    spy.mockRestore()
  })
})

describe('resolveRenderer', () => {
  it('ui.slots 命中返回渲染函数', () => {
    const p = { id: 'p', ui: { slots: { [slot]: () => 'X' } } } as unknown as CoEditorPlugin
    expect(resolveRenderer(p, slot)).toBeDefined()
  })

  it('无任何实现时返回 undefined', () => {
    const p = { id: 'p' } as CoEditorPlugin
    expect(resolveRenderer(p, 'root')).toBeUndefined()
    expect(resolveRenderer(p, 'editorpanel/footbar/right')).toBeUndefined()
  })

  it('不再支持 ui.host / settings.trigger 兼容别名', () => {
    const p = {
      id: 'p',
      ui: { host: () => 'HOST' },
      settings: { trigger: () => 'TRIGGER' },
    } as unknown as CoEditorPlugin
    expect(resolveRenderer(p, 'root')).toBeUndefined()
    expect(resolveRenderer(p, 'main.head.right')).toBeUndefined()
  })
})
