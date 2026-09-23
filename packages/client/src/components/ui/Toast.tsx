import { Text, View } from '@tarojs/components'
import { useSyncExternalStore } from 'react'
import { getToast, subscribeToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/**
 * 轻提示宿主 —— 渲染 `lib/toast.ts` 里的当前提示。
 *
 * 挂在 **LayoutShell** 的骨架根上（home/editor/settings/扩展页每页都渲染它），
 * 而不是 app.tsx 的 `root` 插槽：小程序端每页只绘制自己那棵 WXML 子树，
 * "App 组件里、页面之外的兄弟节点"是最可疑的位置；挂骨架根则两端都确定会被绘制，
 * 并且能继承 `.shell-root` 上的调色板变量（日/夜主题随之生效）。
 *
 * 只渲染，不管理计时（计时在 lib/toast.ts，纯状态可单测）。
 */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribeToast, getToast, getToast)

  if (!toast) return null
  return (
    <View className="toast-host">
      {/* key=id：同一条提示位置连续换文案时强制重建节点，入场动画重播（否则第二次静默替换） */}
      <View key={toast.id} className={cn('toast-panel', toast.kind === 'error' && 'toast-error')}>
        <Text>{toast.message}</Text>
      </View>
    </View>
  )
}
