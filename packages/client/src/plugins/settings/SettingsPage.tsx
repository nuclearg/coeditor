import { View } from '@tarojs/components'
import { SettingsPrefs } from '@/components/settings/SettingsPrefs'
import { ApiConfigSection } from './ApiConfigSection'
import { DataDirSection } from './DataDirSection'

/**
 * 开源版设置页内容：偏好区（主题/语言/风格/CoT）+ API 配置（BYOK）+ 数据目录。
 * 注册到 settingsPlugin.ui.slots['settings.body']（设置页内容区插槽）。
 */
export function SettingsPage() {
  return (
    <View className="settings-page">
      <SettingsPrefs showReviewStyle />
      <ApiConfigSection />
      <DataDirSection />
    </View>
  )
}
