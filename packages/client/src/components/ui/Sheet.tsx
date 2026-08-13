import { View } from '@tarojs/components'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from './Icon'

interface SheetProps {
  open: boolean
  onClose?: () => void
  className?: string
  children?: ReactNode
}

/** 移动端左侧滑出面板 */
export function Sheet({ open, onClose, className, children }: SheetProps) {
  if (!open) return null
  return (
    <>
      <View className="sheet-mask" onClick={onClose} />
      <View className={cn('sheet-panel', className)}>
        {children}
        <View
          className="absolute"
          style={{ top: 16, right: 16, zIndex: 2, padding: 8 }}
          onClick={onClose}
        >
          <Icon name="close" size={28} color="var(--muted-fg)" />
        </View>
      </View>
    </>
  )
}
