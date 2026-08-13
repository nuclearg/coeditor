import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { SettingsMenu } from '@/components/settings/SettingsMenu'
import { SlotHost } from '@/plugin/SlotHost'
import { getCurrentUser } from '@/plugin'
import { isH5 } from '@/lib/utils'
import type { TopbarLeftCtx, TopbarRightCtx, UserInfo } from '@/plugin'

interface HeaderProps {
  onNavigateHome?: () => void
}

export function Header({ onNavigateHome }: HeaderProps) {
  const [user, setUser] = useState<UserInfo | null>(null)

  useEffect(() => {
    getCurrentUser().then(setUser)
  }, [])

  // === topbar-left 插槽的默认实现（renderBrand 积木） ===
  const handleLogoClick = () => {
    if (onNavigateHome) onNavigateHome()
    else Taro.reLaunch({ url: '/pages/index/index' })
  }

  const renderBrand: TopbarLeftCtx['renderBrand'] = (opts) => (
    <View
      className="flex items-center gap-2 font-semibold"
      style={{ fontSize: isH5() ? 20 : 34 }}
      onClick={handleLogoClick}
    >
      <Icon name={opts?.logo ?? 'file'} size={isH5() ? 24 : 36} />
      <View>{opts?.title ?? 'CoEditor'}</View>
    </View>
  )

  // === topbar-right 插槽的默认实现 ===
  const renderSettingsBadge: TopbarRightCtx['renderSettingsBadge'] = (opts) => {
    if (!user && !opts?.label) return null
    return (
      <View className="flex items-center gap-1 px-2 text-muted text-sm">
        <Icon name={opts?.icon ?? 'gear'} size={24} />
        <View>{opts?.label ?? user?.name}</View>
      </View>
    )
  }

  return (
    <View className="flex items-center justify-between px-3 shrink-0" style={{ height: isH5() ? 56 : 100, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
      <SlotHost
        slot="topbar-left"
        ctx={{ nav: { to: handleLogoClick }, renderBrand }}
        defaults={renderBrand()}
      />

      <View className="flex items-center gap-1">
        {/* 默认无内容（主题切换已移入设置菜单） */}
        <SlotHost
          slot="topbar-right"
          ctx={{ user, renderSettingsBadge }}
        />

        <SettingsMenu />
      </View>
    </View>
  )
}
