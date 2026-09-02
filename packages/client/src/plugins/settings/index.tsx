import type { CoEditorPlugin } from '@/plugin'
import { SettingsPage } from './SettingsPage'

/**
 * 设置页插件（开源版默认注册表）：
 * settings.body = 偏好（主题/语言/审阅风格/CoT）+ API 配置（BYOK）+ 数据目录。
 * SaaS 注册表不注册本插件，由 saas 插件提供 settings.body（账户内容）。
 */
export const settingsPlugin: CoEditorPlugin = {
  id: 'settings',
  ui: {
    slots: {
      'settings.body': () => <SettingsPage />,
    },
  },
}
