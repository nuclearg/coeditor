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
  useLaunch: () => {},
}))

vi.mock('@tarojs/components', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Props = Record<string, any> & { children?: React.ReactNode }
  const view = (props: Props) => createElement('div', props, props.children)
  const text = (props: Props) => createElement('span', props, props.children)
  return { View: view, Text: text }
})

vi.mock('@plugin-registry', () => ({ plugins: [] }))

import App from '../../app'
import { SettingsMenu } from '../../components/settings/SettingsMenu'
import { useTheme } from '../../stores/theme'
import { useI18nStore } from '../../stores/i18nStore'

describe('主题与语言切换', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    useI18nStore.setState({ language: 'zh' })
    useTheme.setState({ theme: 'light' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    document.body.removeChild(container)
  })

  it('App 根 View 的主题 class 跟随 store（.app.dark）', async () => {
    useTheme.setState({ theme: 'light' })
    await act(async () => {
      root.render(<App>内容</App>)
    })
    expect(container.querySelector('div')!.className).toBe('app')

    await act(async () => { useTheme.setState({ theme: 'dark' }) })
    expect(container.querySelector('div')!.className).toContain('app dark')
  })

  it('切换语言后菜单标签翻译生效', async () => {
    useI18nStore.setState({ language: 'zh' })
    await act(async () => {
      root.render(<SettingsMenu showReviewStyle />)
    })
    await act(async () => {
      const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
      Simulate.click(span.parentElement!)
    })
    expect(container.textContent).toContain('审阅风格')
    expect(container.textContent).toContain('温和')

    // 切换为英文
    await act(async () => {
      const en = [...container.querySelectorAll<HTMLElement>('.menu-radio')].find((el) => el.textContent === 'English')!
      Simulate.click(en)
    })

    expect(container.textContent).toContain('Review Style')
    expect(container.textContent).toContain('Gentle')
  })

  it('非编辑页（showReviewStyle=false）不显示审阅风格选项', async () => {
    useI18nStore.setState({ language: 'zh' })
    await act(async () => {
      root.render(<SettingsMenu />)
    })
    await act(async () => {
      const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
      Simulate.click(span.parentElement!)
    })
    // 审阅风格（严厉/温和/鼓励）不出现
    expect(container.textContent).not.toContain('审阅风格')
    expect(container.textContent).not.toContain('温和')
    // 主题、语言等通用设置仍然可见
    expect(container.textContent).toContain('主题')
    expect(container.textContent).toContain('语言')
  })

  it('切换主题后 store 状态更新', async () => {
    useTheme.setState({ theme: 'light' })
    await act(async () => {
      root.render(<SettingsMenu />)
    })
    await act(async () => {
      const span = [...container.querySelectorAll('span')].find((el) => el.textContent === '⚙')!
      Simulate.click(span.parentElement!)
    })
    await act(async () => {
      const dark = [...container.querySelectorAll<HTMLElement>('.menu-radio')].find((el) => el.textContent === '夜间')!
      Simulate.click(dark)
    })
    expect(useTheme.getState().theme).toBe('dark')
  })
})
