import type { CoEditorPlugin } from '@/plugin'
import { SettingsPage } from './SettingsPage'

/**
 * 设置页插件（默认注册表）：
 * settings.body = 偏好（主题/语言/审阅风格/CoT）+ API 配置（BYOK）+ 数据目录。
 * 其它部署形态可用自定义注册表替换本插件，由自己的插件提供 settings.body 内容。
 */
export const settingsPlugin: CoEditorPlugin = {
  id: 'settings',
  ui: {
    slots: {
      'settings.body': () => <SettingsPage />,
    },
  },
}
