import { View } from '@tarojs/components'
import { LayoutShell } from '@/plugin/LayoutShell'
import { CustomPageSlot } from '@/plugin/CustomPageSlot'

/**
 * 自定义扩展页面（page.custom.N）模板：由插件注册组件填充（缺省显示占位提示）。
 * 各页面文件（1.tsx ~ 10.tsx）传入自己的 index。
 */
export function CustomPageTemplate({ index }: { index: number }) {
  return (
    <LayoutShell
      variant="custom"
      content={
        <View style={{ height: '100%', overflowY: 'auto' }}>
          <CustomPageSlot index={index} />
        </View>
      }
    />
  )
}
