import type { ReactNode } from 'react'
import type { CoEditorPlugin, PluginSlot, SlotCtxMap, SlotRenderer } from './types'

/**
 * 解析插槽渲染函数（仅支持 ui.slots 命名插槽）。
 */
export function resolveRenderer<K extends PluginSlot>(
  plugin: CoEditorPlugin,
  slot: K,
): SlotRenderer<K> | undefined {
  return plugin.ui?.slots?.[slot] as SlotRenderer<K> | undefined
}

/**
 * 链式计算插槽节点：所有插件的渲染函数按注册顺序依次作用于 node。
 * 单个插件异常不阻断整链（跳过该插件继续）。
 */
export function computeSlotNode<K extends PluginSlot>(
  plugins: CoEditorPlugin[],
  slot: K,
  ctx: SlotCtxMap[K],
  defaults: ReactNode = null,
): ReactNode {
  let node: ReactNode = defaults
  for (const plugin of plugins) {
    const render = resolveRenderer(plugin, slot)
    if (!render) continue
    try {
      node = render(node, ctx) ?? node
    } catch (err) {
      console.error(`[SlotHost] plugin "${plugin.id}" slot "${slot}" render error:`, err)
    }
  }
  return node
}
