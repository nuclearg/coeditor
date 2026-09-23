import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect } from 'react'
import { LayoutShell } from '@/plugin/LayoutShell'
import { SlotHost } from '@/plugin/SlotHost'
import { getSettingsPageLabel } from '@/plugin'
import { useLayoutStore } from '@/stores/layoutStore'
import { t, useT } from '@/lib/i18n'
import { isWebView } from '@/lib/utils'

/**
 * 设置页（page.settings）：固定页面形态 variant="settings"（与 home/editor 齐名）。
 * 壳与首页（index）一致——main.head 显示 logo + 页面标题（settingsPageLabel，文案可由插件自定义），
 * 内容全宽滚动。内容区开放 settings.body 插槽（链式装饰机制，与其它 slot 一致；整页式自定义内容
 * 忽略 defaults 返回自身布局即可）。
 *
 * 页面标题：与编辑页同款机制——面包屑（main.head.left 渲染）+ H5 浏览器标签 / 小程序导航栏；
 * 离开页面恢复面包屑与 H5 默认标题（品牌名）。
 */
export default function SettingsPage() {
  /**
   * 必须用 useT()（订阅语言）而不是模块级 t：本页有几处自己的文案（页脚版权、浏览器标签页、
   * 小程序导航栏标题、面包屑），不订阅语言的话切语言后本组件根本不重渲染，它们会一直停在旧语言
   * （实测：切成英文后标题仍是「个人中心」、页脚仍是「© 2026 校书郎」）。
   */
  const t = useT()
  // settingsPageLabel 惰性求值：它支持函数，本组件因 useT() 会在切语言时重渲染，于是重读生效
  const title = getSettingsPageLabel()
  // 面包屑 effect 的依赖用**文案本身**，不能用 `t`：t 的函数身份恒定（useT 也返回同一个），
  // `[t]` 是死依赖 —— 那样即使组件重渲染了，effect 也不会重跑，面包屑照样停在旧语言
  const brandName = t('brand.name')

  useEffect(() => {
    useLayoutStore.getState().setBreadcrumb(title)
    if (isWebView()) {
      if (typeof document !== 'undefined') document.title = title
    } else {
      Taro.setNavigationBarTitle({ title }).catch(() => {})
    }
    return () => {
      useLayoutStore.getState().setBreadcrumb('')
      // H5 返回后恢复默认标签页标题（品牌名）；小程序导航栏随页面栈自动
      if (isWebView() && typeof document !== 'undefined') {
        document.title = brandName
      }
    }
  }, [title, brandName])

  return (
    <LayoutShell
      variant="settings"
      content={<SlotHost slot="settings.body" />}
      footer={
        <View className="text-xs text-muted" style={{ fontSize: isWebView() ? 12 : 22 }}>{t('footer.copyright')}</View>
      }
    />
  )
}
