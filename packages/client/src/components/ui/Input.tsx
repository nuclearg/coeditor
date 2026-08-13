import { Input as TaroInput } from '@tarojs/components'
import { cn } from '@/lib/utils'

interface InputProps {
  value?: string
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  disabled?: boolean
  onChange?: (value: string) => void
  onEnter?: () => void
  onBlur?: (value: string) => void
  className?: string
  focus?: boolean
}

export function Input({
  value,
  placeholder,
  type = 'text',
  disabled,
  onChange,
  onEnter,
  onBlur,
  className,
  focus,
}: InputProps) {
  return (
    <TaroInput
      className={cn('input', className)}
      value={value}
      placeholder={placeholder}
      password={type === 'password'}
      disabled={disabled}
      focus={focus}
      onInput={(e) => onChange?.(e.detail.value)}
      onConfirm={() => onEnter?.()}
      onBlur={(e) => onBlur?.(e.detail.value)}
    />
  )
}
