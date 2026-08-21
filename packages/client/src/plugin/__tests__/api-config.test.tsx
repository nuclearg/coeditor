// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type React } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Simulate } from 'react-dom/test-utils'

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: () => Promise.reject(new Error('mocked')),
  },
}))

vi.mock('@/api/client', () => ({
  api: {
    rpc: vi.fn(async (action: string, params: Record<string, unknown>) => {
      if (action === 'settings.update') {
        return { style: params.style, apiKey: '', apiBaseUrl: '', model: '' }
      }
      if (action === 'settings.get') {
        return { style: 'gentle', apiKey: '', apiBaseUrl: '', model: '' }
      }
      return null
    }),
  },
}))

vi.mock('@tarojs/components', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Props = Record<string, any> & { children?: React.ReactNode }
  const view = (props: Props) => createElement('div', props, props.children)
  const text = (props: Props) => createElement('span', props, props.children)
  const input = (props: Props) => createElement('input', { ...props, onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onInput?.({ detail: { value: e.target.value } }) })
  const textarea = (props: Props) => createElement('textarea', { ...props, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => props.onInput?.({ detail: { value: e.target.value } }) })
  return { View: view, Text: text, ScrollView: view, Input: input, Textarea: textarea }
})

// 注册真实 api-config 插件，验证 menuItems action → dialog 打开链路
vi.mock('@plugin-registry', async () => {
  const { apiConfigPlugin } = await import('../../plugins/api-config/index')
  return { plugins: [apiConfigPlugin] }
})

import { SettingsMenu } from '../../components/settings/SettingsMenu'
import { SlotHost } from '../../plugin/SlotHost'
import { useApiConfigStore } from '../../plugins/api-config/store'
import { useSettingsStore } from '../../stores/settingsStore'

describe('API 配置菜单项 → Dialog 打开链路', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    useApiConfigStore.setState({ openDialog: false })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    document.body.removeChild(container)
  })

  const render = async () => {
    await act(async () => {
      root.render(
        <>
          <SettingsMenu showReviewStyle />
          <SlotHost slot="root" ctx={{}} />
        </>,
      )
    })
  }

  it('点击设置按钮打开菜单', async () => {
    await render()
    const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
    expect(span).toBeTruthy()
    await act(async () => { Simulate.click(span.parentElement!) })
    expect(container.textContent).toContain('API 配置')
  })

  it('点击 API 配置菜单项后 Dialog 打开', async () => {
    await render()
    await act(async () => {
      const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
      Simulate.click(span.parentElement!)
    })
    expect(container.textContent).toContain('API 配置')

    // 点击菜单项（文本在 div 内）
    await act(async () => {
      const item = [...container.querySelectorAll<HTMLElement>('.menu-item')].find((el) => el.textContent === 'API 配置')!
      Simulate.click(item)
    })

    expect(useApiConfigStore.getState().openDialog).toBe(true)
    expect(container.textContent).toContain('AI 接口配置')
  })

  it('单选框点击后菜单保持打开且状态生效（回归：mousedown 误关菜单）', async () => {
    await render()
    await act(async () => {
      const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
      Simulate.click(span.parentElement!)
    })
    expect(container.textContent).toContain('审阅风格')

    // 模拟真实浏览器点击序列：mousedown 先于 click 触发
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    // 点击审阅风格"严厉"单选框
    await act(async () => {
      const strict = [...container.querySelectorAll<HTMLElement>('.menu-radio')].find((el) => el.textContent === '严厉')!
      Simulate.click(strict)
    })

    // 菜单不应关闭，风格应切换
    expect(container.textContent).toContain('审阅风格')
    expect(useSettingsStore.getState().style).toBe('strict')
  })
})
