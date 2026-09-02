import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect } from 'react'
import { LayoutShell } from '@/plugin/LayoutShell'
import { SlotHost } from '@/plugin/SlotHost'
import { getSettingsPageLabel } from '@/plugin'
import { useLayoutStore } from '@/stores/layoutStore'
import { t } from '@/lib/i18n'
import { isH5 } from '@/lib/utils'

/**
 * 设置页（page.settings）：固定页面形态 variant="settings"（与 home/editor 齐名）。
 * 壳与首页（index）一致——main.head 显示 logo + 页面标题（settingsPageLabel，如 SaaS 的"个人中心"），
 * 内容全宽滚动。内容区开放 settings.body 插槽（链式装饰机制，与其它 slot 一致；整页式内容如账户中心
 * 忽略 defaults 返回自身布局即可）。
 *
 * 页面标题：与编辑页同款机制——面包屑（main.head.left 渲染）+ H5 浏览器标签 / 小程序导航栏；
 * 离开页面恢复面包屑与 H5 默认标题（品牌名）。
 */
export default function SettingsPage() {
  // 惰性求值：settingsPageLabel 支持函数，语言切换后重读生效
  const title = getSettingsPageLabel()

  useEffect(() => {
    useLayoutStore.getState().setBreadcrumb(title)
    if (isH5()) {
      if (typeof document !== 'undefined') document.title = title
    } else {
      Taro.setNavigationBarTitle({ title }).catch(() => {})
    }
    return () => {
      useLayoutStore.getState().setBreadcrumb('')
      // H5 返回后恢复默认标签页标题（品牌名）；小程序导航栏随页面栈自动
      if (isH5() && typeof document !== 'undefined') {
        document.title = t('brand.name')
      }
    }
  }, [title, t])

  return (
    <LayoutShell
      variant="settings"
      content={<SlotHost slot="settings.body" />}
      footer={
        <View className="text-xs text-muted" style={{ fontSize: isH5() ? 12 : 22 }}>{t('footer.copyright')}</View>
      }
    />
  )
}
