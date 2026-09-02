import { View } from '@tarojs/components'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from './Icon'

interface DialogProps {
  open: boolean
  title?: ReactNode
  onClose?: () => void
  className?: string
  children?: ReactNode
}

export function Dialog({ open, title, onClose, className, children }: DialogProps) {
  if (!open) return null
  return (
    <View className="dialog-mask" onClick={onClose}>
      <View className={cn('dialog-panel', className)} onClick={(e) => e.stopPropagation()}>
        {title && (
          <View className="dialog-title">
            {title}
            <View className="flex-1" />
            <View className="hover-accent" style={{ padding: 8 }} onClick={onClose}>
              <Icon name="close" size={24} color="var(--muted-fg)" />
            </View>
          </View>
        )}
        {children}
      </View>
    </View>
  )
}
