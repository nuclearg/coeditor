import { View } from '@tarojs/components'
import { Dialog } from '@/components/ui/Dialog'
import { SlotHost } from '@/plugin/SlotHost'
import { getSettingsPageLabel } from '@/plugin'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useTheme } from '@/stores/theme'
import { useI18nStore } from '@/stores/i18nStore'
import { useSettingsDialogStore } from './dialog-store'

const LANGUAGE_OPTIONS = [
  { value: 'zh' as const, label: '中文' },
  { value: 'en' as const, label: 'English' },
]

const THEME_OPTIONS = [
  { value: 'light' as const, label: () => t('settings.light') },
  { value: 'dark' as const, label: () => t('settings.dark') },
]

/**
 * 桌面设置弹窗：顶部「外观与语言」，下方复用 settings.body 插槽
 * （AI 接口配置 + 数据目录）。由 desktop 插件挂到 'root' 插槽。
 */
export function DesktopSettingsDialog() {
  const { open, setOpen } = useSettingsDialogStore()
  const { theme, setTheme } = useTheme()
  const { language, setLanguage } = useI18nStore()

  return (
    <Dialog
      open={open}
      title={getSettingsPageLabel()}
      onClose={() => setOpen(false)}
      className="settings-dialog"
    >
      <View className="settings-dialog-body">
        {/* 外观与语言（桌面首页无 head 齿轮，这里补上全局偏好的设置面） */}
        <View className="settings-section">
          <View className="settings-section-title">{t('settings.appearance')}</View>

          <View className="text-sm font-medium mb-1">语言 / Language</View>
          <View className="dlg-prefs-row">
            {LANGUAGE_OPTIONS.map((option) => (
              <View
                key={option.value}
                className={cn('dlg-pref-chip', language === option.value && 'on')}
                onClick={() => setLanguage(option.value)}
              >
                {option.label}
              </View>
            ))}
          </View>

          <View className="text-sm font-medium mb-1 mt-3">{t('settings.theme')}</View>
          <View className="dlg-prefs-row">
            {THEME_OPTIONS.map((option) => (
              <View
                key={option.value}
                className={cn('dlg-pref-chip', theme === option.value && 'on')}
                onClick={() => setTheme(option.value)}
              >
                {option.label()}
              </View>
            ))}
          </View>
        </View>

        <SlotHost slot="settings.body" />
      </View>
    </Dialog>
  )
}
