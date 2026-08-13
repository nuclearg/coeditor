import { plugins } from '@plugin-registry'
import { mergePluginI18n } from '@/lib/i18n'
import { runInitFor, getCurrentUserFor } from './lifecycle-core'
import type { CoEditorPlugin, UserInfo } from './types'

export type {
  CoEditorPlugin, PluginMenuItem, RadioOption, UserInfo, LocalizedLabel,
  PluginSlot, SlotCtxMap, SlotRenderer, RpcResponse,
  TopbarLeftCtx, TopbarRightCtx, TopbarSettingsCtx,
  SidebarTopCtx, SidebarBottomCtx,
  EditorTopCtx, EditorBottomCtx,
  AiTopCtx, AiBottomCtx,
  SettingsMenuCtx, RootCtx,
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
