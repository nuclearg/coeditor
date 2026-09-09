/**
 * 通用能力注册表：插件可覆盖核心的"打开设置"行为。
 * 核心 SettingsMenu 齿轮/入口默认：轻量下拉 + 路由设置页；
 * 桌面插件在 app.onInit 里注册"直接打开设置弹窗"的启动器，核心无需感知平台。
 * 独立成模块避免 注册表 → 插件 → plugin/index 的循环依赖。
 */

let settingsLauncher: (() => void) | undefined

export function registerSettingsLauncher(fn: () => void): void {
  settingsLauncher = fn
}

export function getSettingsLauncher(): (() => void) | undefined {
  return settingsLauncher
}
