import { Text, View } from '@tarojs/components'
import { Icon } from '@/components/ui/Icon'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18nStore } from '@/stores/i18nStore'
import { useTheme } from '@/stores/theme'
import { t } from '@/lib/i18n'
import { cn, isH5 } from '@/lib/utils'

const STYLE_OPTIONS = [
  { value: 'gentle', label: () => t('settings.gentle') },
  { value: 'strict', label: () => t('settings.strict') },
  { value: 'praise', label: () => t('settings.praise') },
]

const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const THEME_OPTIONS = [
  { value: 'light', label: () => t('settings.light') },
  { value: 'dark', label: () => t('settings.dark') },
]

/**
 * 偏好设置区（审阅风格 / 思考过程 / 主题 / 语言）：
 * 齿轮下拉与设置页共用。审阅风格仅编辑页显示（showReviewStyle）。
 */
export function SettingsPrefs({ showReviewStyle = false }: { showReviewStyle?: boolean }) {
  const { style, setStyle, showThinking, setShowThinking } = useSettingsStore()
  const { language, setLanguage } = useI18nStore()
  const { theme, setTheme } = useTheme()

  return (
    <View className="settings-prefs">
      {showReviewStyle && (
        <>
          <View className="menu-label">{t('settings.reviewStyle')}</View>
          {STYLE_OPTIONS.map((option) => (
            <View
              key={option.value}
              className={cn('menu-radio', style === option.value && 'checked')}
              onClick={() => setStyle(option.value)}
            >
              <View className="dot" />
              <View>{option.label()}</View>
            </View>
          ))}
          <View className="menu-sep" />
        </>
      )}

      {/* 是否查询/展示 AI 思考过程（cot） */}
      <View className="menu-item" onClick={() => void setShowThinking(!showThinking)}>
        <View className="flex-1">{t('settings.showThinking')}</View>
        <View className="text-xs text-muted">{showThinking ? t('common.on') : t('common.off')}</View>
      </View>

      <View className="menu-sep" />

      <View className="menu-label">{t('settings.theme')}</View>
      {THEME_OPTIONS.map((option) => (
        <View
          key={option.value}
          className={cn('menu-radio', theme === option.value && 'checked')}
          onClick={() => setTheme(option.value as 'light' | 'dark')}
        >
          <View className="dot" />
          <View>{option.label()}</View>
        </View>
      ))}

      <View className="menu-sep" />

      <View className="menu-label">语言 / Language</View>
      {LANGUAGE_OPTIONS.map((option) => (
        <View
          key={option.value}
          className={cn('menu-radio', language === option.value && 'checked')}
          onClick={() => setLanguage(option.value as 'zh' | 'en')}
        >
          <View className="dot" />
          <View>{option.label}</View>
        </View>
      ))}
    </View>
  )
}

/** 设置页入口按钮（main.headbar.right 默认实现；点击跳转设置页） */
export function renderSettingsButton(opts?: { icon?: string; label?: string }) {
  return (
    <View
      className="hover-accent"
      style={{ padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}
      onClick={() => { /* 跳转由调用方注入；此处仅渲染样式 */ }}
    >
      <Icon name={opts?.icon ?? 'gear'} size={isH5() ? 24 : 36} />
      {opts?.label && <Text style={{ fontSize: isH5() ? 24 : 34 }}>{opts.label}</Text>}
    </View>
  )
}
