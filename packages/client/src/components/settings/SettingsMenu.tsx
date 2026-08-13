import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { getPlugins } from '@/plugin'
import { SlotHost } from '@/plugin/SlotHost'
import type { LocalizedLabel, TopbarSettingsCtx } from '@/plugin'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18nStore } from '@/stores/i18nStore'
import { useTheme } from '@/stores/theme'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

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

export function SettingsMenu() {
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

  // === topbar-settings 插槽的默认实现（renderSettingsButton 积木） ===
  const renderSettingsButton: TopbarSettingsCtx['renderSettingsButton'] = (opts) => (
    <View
      className="hover-accent"
      style={{ padding: 10, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}
      onClick={() => setOpen((v) => !v)}
    >
      <Icon name={opts?.icon ?? 'gear'} size={28} />
      {opts?.label && <Text style={{ fontSize: 24 }}>{opts.label}</Text>}
    </View>
  )

  return (
    <>
      <SlotHost
        slot="topbar-settings"
        ctx={{ open: () => setOpen(true), renderSettingsButton }}
        defaults={renderSettingsButton()}
      />

      {open && (
        <>
          {/* 点击外部关闭（跨端一致的遮罩层） */}
          <View
            style={{ position: 'fixed', inset: 0, zIndex: 790 }}
            onClick={() => setOpen(false)}
          />
          <View className="menu-panel">
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
