// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, act, type React } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { hideToast, showErrorToast, showToast } from '@/lib/toast'

vi.mock('@tarojs/components', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Props = Record<string, any> & { children?: React.ReactNode }
  const view = (props: Props) => createElement('div', props, props.children)
  const text = (props: Props) => createElement('span', props, props.children)
  return { View: view, Text: text }
})

import { ToastHost } from '../Toast'

/**
 * 宿主只负责画：从 store 渲染当前提示，并带上 kind 对应的 class。
 * 颜色本身由 CSS 变量决定（`--popover` / `--destructive`），故这里只断言"选了哪个皮肤"，
 * 颜色值由构建产物 + 截图取色验证。
 */
describe('ToastHost', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    hideToast()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    hideToast()
  })

  it('无提示时不渲染任何节点', () => {
    act(() => root.render(createElement(ToastHost)))
    expect(container.querySelector('.toast-panel')).toBeNull()
  })

  it('展示中性提示：弹出面板并带 `toast-panel`（不带错误皮肤）', () => {
    act(() => root.render(createElement(ToastHost)))
    act(() => showToast('已复制'))

    const panel = container.querySelector('.toast-panel')
    expect(panel).not.toBeNull()
    expect(panel?.className).toBe('toast-panel')
    expect(panel?.textContent).toBe('已复制')
    // 宿主铺满屏幕但不拦点击
    expect(container.querySelector('.toast-host')).not.toBeNull()
  })

  it('错误提示带 `toast-error` 皮肤', () => {
    act(() => root.render(createElement(ToastHost)))
    act(() => showErrorToast('保存失败'))

    expect(container.querySelector('.toast-panel')?.className).toBe('toast-panel toast-error')
  })

  it('到点自动消失（React 侧也同步卸载）', () => {
    vi.useFakeTimers()
    try {
      act(() => root.render(createElement(ToastHost)))
      act(() => showToast('稍纵即逝', 2000))
      expect(container.querySelector('.toast-panel')).not.toBeNull()

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(container.querySelector('.toast-panel')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('第二次提示替换第一次并重建节点（key=id，入场动画重播）', () => {
    act(() => root.render(createElement(ToastHost)))
    act(() => showToast('第一条'))
    const first = container.querySelector('.toast-panel')

    act(() => showToast('第二条'))
    const second = container.querySelector('.toast-panel')
    expect(second?.textContent).toBe('第二条')
    // 节点被重建而不是复用（否则 CSS 入场动画不会重播）
    expect(second).not.toBe(first)
  })
})
