import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { getPlugins, getSettingsPageLabel } from '@/plugin'
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
   * 审阅风格只对编辑场景有意义：仅在编辑页（LayoutShell variant=editor）时为 true，
   * 首页/其他页面不渲染，避免误导。
   */
  showReviewStyle?: boolean
}

/**
 * 设置下拉菜单（齿轮 → 轻量偏好 + 高级设置入口）：
 * - 语言 / 日间夜间模式：直接生效（轻量偏好）
 * - 高级设置：跳转 page.settings（设置页内容由 ui.slots['settings.body'] 提供）
 * - 仅编辑页：审阅风格 + CoT 开关
 * - 插件 menuItems / settings-menu 插槽：扩展点保留（追加区）
 */
export function SettingsMenu({ showReviewStyle = false }: SettingsMenuProps) {
  const { style, setStyle, showThinking, setShowThinking, cotSelectable } = useSettingsStore()
  const { language, setLanguage } = useI18nStore()
  const { theme, setTheme } = useTheme()
  const plugins = getPlugins()
  const [open, setOpen] = useState(false)

  const closeAnd = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  const goSettings = () => {
    setOpen(false)
    Taro.navigateTo({ url: '/pages/settings/index' }).catch(() => {})
  }

  return (
    <>
      <View
        className="hover-accent"
        style={{ padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="gear" size={isH5() ? 24 : 36} />
      </View>

      {open && (
        <>
          {/* 点击外部关闭（跨端一致的遮罩层） */}
          <View
            style={{ position: 'fixed', inset: 0, zIndex: 790 }}
            onClick={() => setOpen(false)}
          />
          <View className="menu-panel">
            {/* 语言 */}
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

            <View className="menu-sep" />

            {/* 主题（日间/夜间） */}
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

            {/* 编辑页专属：审阅风格（主题之后、设置页入口之前） */}
            {showReviewStyle && <View className="menu-sep" />}
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
              </>
            )}

            {/* 编辑页专属：CoT 思考开关（部署方可隐藏 cotSelectable=false，如 SaaS 固定不请求思考省 token） */}
            {showReviewStyle && cotSelectable && <View className="menu-sep" />}
            {showReviewStyle && cotSelectable && (
              <>
                <View className="menu-label">{t('settings.showThinking')}</View>
                {[
                  { value: true, label: t('common.enable') },
                  { value: false, label: t('common.disable') },
                ].map((option) => (
                  <View
                    key={String(option.value)}
                    className={cn('menu-radio', showThinking === option.value && 'checked')}
                    onClick={() => void setShowThinking(option.value)}
                  >
                    <View className="dot" />
                    <View>{option.label}</View>
                  </View>
                ))}
              </>
            )}

            {/* 插件扩展点（menuItems + settings-menu 插槽）：无内容时整个省略，
                避免空区两侧残留分隔线（主题 ↔ 个人中心之间出现多余横线的根因） */}
            {plugins.some((p) => (p.settings?.menuItems?.length ?? 0) > 0 || Boolean(p.ui?.slots?.['settings-menu'])) && <View className="menu-sep" />}
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

            {/* 设置页入口（个人中心）：固定放菜单最底（文案与设置页标题共用，见 getSettingsPageLabel） */}
            <View className="menu-sep" />
            <View className="menu-item" onClick={goSettings}>
              <View className="flex-1">{getSettingsPageLabel()}</View>
              <Icon name="chevronRight" size={isH5() ? 20 : 28} color="var(--muted-fg)" />
            </View>
          </View>
        </>
      )}
    </>
  )
}
