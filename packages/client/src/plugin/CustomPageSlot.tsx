import { View, Text } from '@tarojs/components'
import type { ComponentType } from 'react'
import { getPlugins } from '@/plugin'
import { useI18nStore } from '@/stores/i18nStore'

/**
 * 自定义页面位渲染器：page.custom.{index}（pages/custom/{index}）。
 * 从插件注册表聚合 pages.custom[index]，缺省显示占位提示（无插件填充时）。
 */
export function CustomPageSlot({ index }: { index: number }) {
  const Component = resolveCustomPage(index)
  if (Component) {
    return <Component />
  }
  const lang = useI18nStore((s) => s.language)
  return (
    <View className="flex items-center justify-center" style={{ height: '100%', minHeight: 200 }}>
      <Text className="text-muted">{lang === 'en' ? `Custom page ${index} is not registered` : `扩展页面 ${index} 未注册`}</Text>
    </View>
  )
}

const cache = new Map<number, ComponentType | null>()

/** 聚合所有插件的 pages.custom[index]（首个注册者生效）。 */
function resolveCustomPage(index: number): ComponentType | null {
  if (cache.has(index)) return cache.get(index) ?? null
  let resolved: ComponentType | null = null
  for (const plugin of getPlugins()) {
    const comp = plugin.pages?.custom?.[index]
    if (comp) {
      resolved = comp
      break
    }
  }
  cache.set(index, resolved)
  return resolved
}
