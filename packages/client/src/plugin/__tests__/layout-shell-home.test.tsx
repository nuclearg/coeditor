// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, act, type React } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useLayoutStore } from '@/stores/layoutStore'

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    reLaunch: () => Promise.resolve(),
    navigateTo: () => Promise.resolve(),
    redirectTo: () => Promise.resolve(),
    setNavigationBarTitle: () => Promise.resolve(),
    setNavigationBarColor: () => Promise.resolve(),
    getAppBaseInfo: () => ({ theme: 'light' }),
    onThemeChange: () => {},
    offThemeChange: () => {},
    getCurrentInstance: () => ({ router: { params: {} } }),
  },
  useDidShow: () => {},
  useLaunch: () => {},
  useRouter: () => ({ params: {} }),
}))

vi.mock('@tarojs/components', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Props = Record<string, any> & { children?: React.ReactNode }
  const view = (props: Props) => createElement('div', props, props.children)
  const text = (props: Props) => createElement('span', props, props.children)
  const image = (props: Props) => createElement('img', props)
  return { View: view, Text: text, Image: image, ScrollView: view }
})

vi.mock('@plugin-registry', () => ({ plugins: [] }))
// 静态资源：vitest 不认识 .png，给个占位
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))

import { LayoutShell } from '@/plugin/LayoutShell'

/**
 * 小程序首页顶栏（方案 A：保留原生导航栏，在它下面加一行「logo | 公告 | 设置」）。
 *
 * 这条行为在真实小程序里我才看不到（这里只有 jsdom），所以钉住两件最容易回归的事：
 * 1. 小程序首页**要**渲染壳头（此前 home 与 settings 一起被隐藏），且左侧**只有 logo、没有文字**；
 * 2. H5/桌面首页**不受影响**（仍然 logo + 品牌名）。
 * 齿轮/公告分别由 SettingsMenu 与 saas 的公告插件填 main.head.right / middle，
 * 这里只断言右侧那个可点区域存在（公告需要登录态拉数据，不在组件测试范围内）。
 */
describe('LayoutShell 首页顶栏', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    useLayoutStore.setState({ breadcrumb: '校书郎' })
    // jsdom 没有 matchMedia，而 H5 分支的 useIsMobile 会用它（视口判断）
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllEnvs()
  })

  const renderHome = () =>
    act(() =>
      root.render(
        createElement(LayoutShell, {
          variant: 'home',
          content: createElement('div', { className: 'home-content' }),
        }),
      ),
    )

  it('小程序：首页渲染壳头，左侧只有 logo、没有品牌文字，右侧有设置按钮', () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    renderHome()

    const head = container.querySelector('.shell-head')
    expect(head).not.toBeNull()
    expect(head!.querySelector('img')).not.toBeNull()
    // "不要字"：品牌名不在这条顶栏里（原生导航栏已经显示标题）
    expect(head!.textContent).not.toContain('校书郎')
    // 右侧设置入口（SettingsMenu 的齿轮触发区）
    expect(head!.querySelectorAll('.hover-accent').length).toBe(1)
  })

  it('小程序：个人中心仍然不渲染壳头（内容即页面）', () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    act(() =>
      root.render(
        createElement(LayoutShell, {
          variant: 'settings',
          content: createElement('div', { className: 'settings-content' }),
        }),
      ),
    )
    expect(container.querySelector('.shell-head')).toBeNull()
  })

  it('H5/桌面：首页保持原样——壳头里 logo 与品牌名都在', () => {
    vi.stubEnv('TARO_ENV', 'h5')
    renderHome()

    const head = container.querySelector('.shell-head')
    expect(head).not.toBeNull()
    expect(head!.querySelector('img')).not.toBeNull()
    expect(head!.textContent).toContain('校书郎')
  })
})
