import { View } from '@tarojs/components'
import { ApiConfigSection } from './ApiConfigSection'
import { DataDirSection } from './DataDirSection'

/**
 * 设置页（高级设置）内容：AI 接口配置（BYOK）+ 数据目录。
 * 主题/语言/审阅风格等轻量偏好由齿轮下拉菜单（SettingsMenu）承载，
 * 此页只保留与服务端相关的技术配置，样式采用统一的卡片式分区。
 * 注册到 settingsPlugin.ui.slots['settings.body']（设置页内容区插槽）。
 */
export function SettingsPage() {
  return (
    <View className="settings-page">
      <ApiConfigSection />
      <DataDirSection />
    </View>
  )
}
