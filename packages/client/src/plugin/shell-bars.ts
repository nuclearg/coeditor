/**
 * 外壳"吊顶/吊底"可见性策略 —— 纯函数，不依赖 Taro/React，便于单测。
 *
 * 背景：手机上有原生导航栏（标题 + 右上角胶囊），再叠一条自绘顶栏/底栏通常是冗余，
 * 所以小程序端默认对"内容即页面"的形态隐藏外壳栏。
 */

import type { PageVariant } from '@/stores/layoutStore'

/**
 * 小程序端**吊顶与吊底一起隐藏**的页面形态。
 *
 * - 个人中心（settings）：内容即页面，顶栏底栏都不要
 * - 首页（home）：**只隐藏吊底**（版权条），吊顶要留——顶栏要放「logo | 公告 | 设置」，
 *   而原生导航栏放不下 logo、公告也没有位置。判断请用 {@link shellHeadVisible}
 *
 * 编辑页不在列内：它的吊顶承载面包屑（"文档 - 章节 - 段落"）。
 */
export const SHELL_BARS_HIDDEN_VARIANTS: PageVariant[] = ['home', 'settings']

/**
 * 小程序端是否渲染壳头（吊顶）。
 *
 * 与 {@link SHELL_BARS_HIDDEN_VARIANTS} 的差别就在首页：首页在小程序上要一条
 * 「logo | 公告 | 设置」的顶栏，所以吊顶显示、吊底不显示。H5/桌面恒定显示。
 *
 * 抽成纯函数是为了能被单测钉住——head/foot 分离这条规则很容易被后来者改回"一起隐藏"。
 */
export function shellHeadVisible(variant: PageVariant, webview: boolean): boolean {
  if (webview) return true
  return variant === 'home' || !SHELL_BARS_HIDDEN_VARIANTS.includes(variant)
}
