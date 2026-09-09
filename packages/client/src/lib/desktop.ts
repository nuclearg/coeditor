/**
 * 平台能力（核心只保留环境探测与"可注入动作"的兜底壳）。
 *
 * 桌面壳（Tauri）的行为适配全部收敛在 desktop 插件里
 * （src/plugins/desktop，仅桌面注册表 registry.desktop.ts 注册）：
 * - window.open 适配 / 桌面标记 / 快捷键 / 原生菜单事件 / 窗口标题跟随 → 插件 onInit；
 * - 系统"选择文件夹"对话框的实现 → 插件通过 registerDirectoryPicker 注入，
 *   核心 DataDirSection 只调用 pickDataDirectory 兜底壳，不引用任何 Tauri API。
 * Web / 小程序：不注册插件，此处探测恒为 false、picker 为空 → 一切原样。
 */

/** 是否运行在 Tauri 桌面壳内（同步版；非 H5 环境恒为 false） */
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
}

/** 是否运行在 Tauri 桌面壳内（异步版，兼容旧调用方） */
export async function isDesktopRuntime(): Promise<boolean> {
  return isDesktop()
}

type DirectoryPicker = () => Promise<string | null>

/** 目录选择器实现（桌面插件注入；Web/小程序不注册） */
let directoryPicker: DirectoryPicker | undefined

export function registerDirectoryPicker(fn: DirectoryPicker): void {
  directoryPicker = fn
}

/**
 * 弹出系统「选择文件夹」对话框：实现由 desktop 插件注入。
 * 非桌面环境或未注入时返回 null（调用方隐藏入口即可）。
 */
export async function pickDataDirectory(): Promise<string | null> {
  if (!isDesktop() || !directoryPicker) return null
  return directoryPicker()
}
