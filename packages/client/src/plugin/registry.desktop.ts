import { plugins as defaultPlugins } from './registry'
import { desktopPlugin } from '@/plugins/desktop'
import type { CoEditorPlugin } from './types'

/**
 * 桌面壳专用注册表（编译期经 PLUGIN_REGISTRY_PATH 选用，见 config/index.ts）：
 * = 默认插件（settings/user…）+ desktop 插件。
 * 桌面形态的所有适配（首页 head 重写、设置弹窗、快捷键/原生菜单事件、
 * 窗口标题跟随等）都由 desktop 插件承载，核心代码不感知桌面。
 */
export const plugins: CoEditorPlugin[] = [...defaultPlugins, desktopPlugin]
