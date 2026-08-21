import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { getPlugins } from '@/plugin'
import { SlotHost } from '@/plugin/SlotHost'
import type { LocalizedLabel } from '@/plugin'
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

/** 菜单文案求值：函数（插件惰性文案）则调用，字符串原样 */
function resolveLabel(label: LocalizedLabel): string {
  return typeof label === 'function' ? label() : label
}

interface SettingsMenuProps {
  /**
   * 是否显示「审阅风格」选项。
   * 审阅风格只对编辑场景有意义：仅在编辑页（LayoutShell 收到 sidebar）时为 true，
   * 首页/其他页面不渲染，避免误导。
   */
  showReviewStyle?: boolean
}

export function SettingsMenu({ showReviewStyle = false }: SettingsMenuProps) {
  const { style, loadStyle, setStyle } = useSettingsStore()
  const { language, setLanguage } = useI18nStore()
  const { theme, setTheme } = useTheme()
  const plugins = getPlugins()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    loadStyle()
  }, [loadStyle])

  const closeAnd = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  // 设置入口按钮（main.headbar.right 的默认实现）
  const renderSettingsButton = (opts?: { icon?: string; label?: string }) => (
    <View
      className="hover-accent"
      style={{ padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}
      onClick={() => setOpen((v) => !v)}
    >
      <Icon name={opts?.icon ?? 'gear'} size={isH5() ? 24 : 36} />
      {opts?.label && <Text style={{ fontSize: isH5() ? 24 : 34 }}>{opts.label}</Text>}
    </View>
  )

  return (
    <>
      {renderSettingsButton()}

      {open && (
        <>
          {/* 点击外部关闭（跨端一致的遮罩层） */}
          <View
            style={{ position: 'fixed', inset: 0, zIndex: 790 }}
            onClick={() => setOpen(false)}
          />
          <View className="menu-panel">
            {/* 审阅风格：仅编辑页显示（showReviewStyle） */}
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

            {/* 数据目录等扩展设置由插件提供（data-dir 插件，开源版注册；SaaS 版不注册即无此入口） */}

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

            {plugins.some((p) => p.settings?.menuItems?.length) && <View className="menu-sep" />}

            {plugins.map((plugin) => (
              <View key={plugin.id}>
                {plugin.settings?.menuItems?.map((item) => {
                  const itemLabel = resolveLabel(item.label)
                  if (item.type === 'action') {
                    return (
                      <View key={itemLabel} className="menu-item" onClick={closeAnd(item.onClick)}>
                        {itemLabel}
                      </View>
                    )
                  }
                  if (item.type === 'link') {
                    return (
                      <View
                        key={itemLabel}
                        className="menu-item"
                        onClick={closeAnd(() => {
                          if (process.env.TARO_ENV === 'h5') {
                            window.open(item.url, '_blank', 'noopener')
                          }
                        })}
                      >
                        {itemLabel}
                      </View>
                    )
                  }
                  return (
                    <View key={itemLabel}>
                      <View className="menu-label">{resolveLabel(item.label)}</View>
                      {item.options.map((option) => (
                        <View
                          key={option.value}
                          className={cn('menu-radio', item.value === option.value && 'checked')}
                          onClick={() => item.onChange(option.value)}
                        >
                          <View className="dot" />
                          <View>{option.label}</View>
                        </View>
                      ))}
                    </View>
                  )
                })}
              </View>
            ))}

            {/* 插件自定义菜单区（排在所有 menuItems 之后） */}
            <SlotHost slot="settings-menu" ctx={{}} />
          </View>
        </>
      )}
    </>
  )
}
