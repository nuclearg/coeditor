import { plugins } from '@plugin-registry'
import { mergePluginI18n, t } from '@/lib/i18n'
import { runInitFor, getCurrentUserFor } from './lifecycle-core'
import type { CoEditorPlugin, UserInfo } from './types'

export type {
  CoEditorPlugin, PluginMenuItem, RadioOption, UserInfo, LocalizedLabel,
  PluginSlot, SlotCtxMap, SlotCtx, SlotRenderer, RpcResponse,
} from './types'

export function getPlugins(): CoEditorPlugin[] {
  return plugins
}

/** 依次执行所有插件的 app.onInit 启动钩子 */
export async function runInit(): Promise<void> {
  return runInitFor(plugins)
}

/** 合并所有插件的 i18n 字典（key 加 plugin.<id>. 前缀） */
export function mergePluginDictionaries(): void {
  mergePluginI18n(plugins)
}

/** 获取当前用户（排他：第一个返回非 null 的插件生效） */
export async function getCurrentUser(): Promise<UserInfo | null> {
  return getCurrentUserFor(plugins)
}

/**
 * 设置页标题 + 齿轮下拉底部"进入设置页"菜单项文案：
 * 首个注册 settingsPageLabel 的插件生效（惰性求值——语言切换后重新读取），
 * 缺省为内置"高级设置"/"Advanced Settings"。
 */
export function getSettingsPageLabel(): string {
  for (const plugin of plugins) {
    const label = plugin.settingsPageLabel
    if (label) {
      return typeof label === 'function' ? label() : label
    }
  }
  return t('settings.advanced')
}
