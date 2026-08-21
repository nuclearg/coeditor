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
    rpc: vi.fn(async (action: string) => {
      if (action === 'settings.get') {
        return { dataDir: '/tmp/coeditor-data', apiKey: '', apiBaseUrl: '', model: '', style: 'gentle' }
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
  return { View: view, Text: text, Input: input }
})

// 注册真实 data-dir 插件，验证菜单入口 → 对话框打开链路
vi.mock('@plugin-registry', async () => {
  const { dataDirPlugin } = await import('../../plugins/data-dir/index')
  return { plugins: [dataDirPlugin] }
})

import { SettingsMenu } from '../../components/settings/SettingsMenu'
import { SlotHost } from '../../plugin/SlotHost'
import { useDataDirStore } from '../../plugins/data-dir/store'

describe('数据目录插件 → 设置菜单入口', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    useDataDirStore.setState({ openDialog: false })
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

  it('设置菜单包含数据目录入口', async () => {
    await render()
    await act(async () => {
      const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
      Simulate.click(span.parentElement!)
    })
    expect(container.textContent).toContain('数据目录')
  })

  it('点击数据目录入口后对话框打开并展示当前目录', async () => {
    await render()
    await act(async () => {
      const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
      Simulate.click(span.parentElement!)
    })
    await act(async () => {
      const item = [...container.querySelectorAll<HTMLElement>('.menu-item')].find(
        (el) => el.textContent === '数据目录',
      )!
      Simulate.click(item)
    })
    expect(useDataDirStore.getState().openDialog).toBe(true)
    expect(container.textContent).toContain('/tmp/coeditor-data')
  })
})
