import { View } from '@tarojs/components'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'outline' | 'ghost' | 'destructive'
type Size = 'default' | 'sm' | 'icon'

interface ButtonProps {
  variant?: Variant
  size?: Size
  disabled?: boolean
  onClick?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  className?: string
  style?: React.CSSProperties
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'default',
  disabled = false,
  onClick,
  onMouseDown,
  className,
  style,
  children,
}: ButtonProps) {
  return (
    <View
      className={cn(
        'btn',
        `btn-${variant}`,
        `btn-${size}`,
        disabled && 'btn-disabled',
        className,
      )}
      style={style}
      onClick={() => {
        if (!disabled) onClick?.()
      }}
      {...({ onMouseDown } as object)}
    >
      {children}
    </View>
  )
}
