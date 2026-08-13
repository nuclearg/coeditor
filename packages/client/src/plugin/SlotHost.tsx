import { Component, Fragment, type ReactNode } from 'react'
import { getPlugins } from './index'
import { computeSlotNode } from './slot-core'
import type { PluginSlot, SlotCtxMap } from './types'

/**
 * React 渲染期错误边界：捕获插件返回组件在渲染阶段的异常，避免单个插件
 * 击穿整个应用（slot-core 的 try/catch 只能覆盖渲染函数体本身的异常）。
 */
class SlotErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[SlotHost] render error:', error)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

/**
 * 区块插槽：所有插件的渲染函数按注册顺序链式作用于 defaults。
 * 后注册的插件包裹先注册的输出；单个插件异常不阻断整链。
 */
export function SlotHost<K extends PluginSlot>({ slot, ctx, defaults }: {
  slot: K
  ctx: SlotCtxMap[K]
  defaults?: ReactNode
}) {
  return (
    <SlotErrorBoundary>
      <Fragment>{computeSlotNode(getPlugins(), slot, ctx, defaults ?? null)}</Fragment>
    </SlotErrorBoundary>
  )
}
