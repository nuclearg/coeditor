import { describe, it, expect } from 'vitest'
import type { ReactNode } from 'react'
import { computeSlotNode, resolveRenderer } from '../slot-core'
import type { CoEditorPlugin, PluginSlot, SlotCtxMap } from '../types'

const slot = 'topbar-settings' as PluginSlot
const ctx: SlotCtxMap['topbar-settings'] = {
  open: () => {},
  renderSettingsButton: () => null,
}

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

describe('resolveRenderer — 兼容别名', () => {
  it('slots 优先于 ui.host（root）', () => {
    const p = {
      id: 'p',
      ui: { host: () => 'HOST', slots: { root: () => 'SLOT' } },
    } as unknown as CoEditorPlugin
    expect(resolveRenderer(p, 'root')!(null, {} as never)).toBe('SLOT')
  })

  it('无 slots 时 ui.host 映射到 root', () => {
    const p = { id: 'p', ui: { host: () => 'HOST' } } as unknown as CoEditorPlugin
    expect(resolveRenderer(p, 'root')!(null, {} as never)).toBe('HOST')
  })

  it('slots 优先于 settings.trigger（topbar-settings）', () => {
    const p = {
      id: 'p',
      settings: { trigger: () => 'TRIGGER' },
      ui: { slots: { 'topbar-settings': () => 'SLOT' } },
    } as unknown as CoEditorPlugin
    expect(resolveRenderer(p, 'topbar-settings')!(null, ctx)).toBe('SLOT')
  })

  it('无 slots 时 settings.trigger 映射到 topbar-settings 并传入 open', () => {
    const open = () => 'OPENED'
    const p = {
      id: 'p',
      settings: { trigger: (c: { open: () => string }) => `TRIGGER:${c.open()}` },
    } as unknown as CoEditorPlugin
    const render = resolveRenderer(p, 'topbar-settings')!
    const out = render(null, { open } as unknown as SlotCtxMap['topbar-settings'])
    expect(out).toBe('TRIGGER:OPENED')
  })

  it('无任何实现时返回 undefined', () => {
    const p = { id: 'p' } as CoEditorPlugin
    expect(resolveRenderer(p, 'root')).toBeUndefined()
    expect(resolveRenderer(p, 'editor-bottom')).toBeUndefined()
  })

  it('root 与 topbar-settings 之外无别名', () => {
    const p = {
      id: 'p',
      ui: { host: () => 'HOST' },
      settings: { trigger: () => 'TRIGGER' },
    } as unknown as CoEditorPlugin
    expect(resolveRenderer(p, 'editor-bottom')).toBeUndefined()
    expect(resolveRenderer(p, 'sidebar-bottom')).toBeUndefined()
  })
})
