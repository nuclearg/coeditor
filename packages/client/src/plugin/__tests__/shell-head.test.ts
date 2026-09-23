import { describe, it, expect } from 'vitest'
import { shellHeadVisible } from '@/plugin/shell-bars'
import type { PageVariant } from '@/stores/layoutStore'

/**
 * 壳头（吊顶）可见性规则。
 *
 * 小程序上吊顶与吊底**不再同进同出**：首页要顶栏（logo | 公告 | 设置），但不要吊底（版权），
 * 所以这条规则值得被钉住——它很容易被后来者"顺手改回一起隐藏"。
 */
describe('shellHeadVisible', () => {
  it('H5/桌面：任何页面形态都渲染壳头', () => {
    const variants: PageVariant[] = ['home', 'editor', 'settings', 'custom']
    for (const v of variants) expect(shellHeadVisible(v, true)).toBe(true)
  })

  it('小程序·首页：渲染壳头（顶栏要放 logo/公告/设置）', () => {
    expect(shellHeadVisible('home', false)).toBe(true)
  })

  it('小程序·个人中心：不渲染壳头（内容即页面）', () => {
    expect(shellHeadVisible('settings', false)).toBe(false)
  })

  it('小程序·编辑页与扩展页：渲染壳头（面包屑/齿轮）', () => {
    expect(shellHeadVisible('editor', false)).toBe(true)
    expect(shellHeadVisible('custom', false)).toBe(true)
  })
})
