import type { CoEditorPlugin, UserInfo } from './types'

/** 依次执行所有插件的 app.onInit 启动钩子（单个插件异常不阻断其余插件） */
export async function runInitFor(pluginList: CoEditorPlugin[]): Promise<void> {
  for (const plugin of pluginList) {
    if (plugin.app?.onInit) {
      try {
        await plugin.app.onInit()
      } catch (err) {
        console.error(`[plugin] onInit failed (${plugin.id}):`, err)
      }
    }
  }
}

/** 获取当前用户：排他——第一个返回非 null 的插件生效（单个插件异常跳过） */
export async function getCurrentUserFor(pluginList: CoEditorPlugin[]): Promise<UserInfo | null> {
  for (const plugin of pluginList) {
    if (plugin.user?.get) {
      try {
        const user = await plugin.user.get()
        if (user) return user
      } catch (err) {
        console.error(`[plugin] user.get failed (${plugin.id}):`, err)
      }
    }
  }
  return null
}
