import { Input as TaroInput } from '@tarojs/components'
import { useEffect, useRef } from 'react'
import { cn, isH5 } from '@/lib/utils'

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
  const coreRef = useRef<HTMLElement | null>(null)

  // H5：`focus` prop 依赖 React 的 autoFocus 提交路径；React 18 的
  // "flushSync was called during render"（如新建章节回车后 Taro 内部
  // finishEventHandler 触发）之后该路径失效，input 不再自动聚焦。
  // 改为手动聚焦原生 <input>（taro-input-core 的内部元素在 React commit
  // 后才渲染，需等一帧），绕过 React 的 autoFocus 机制。
  useEffect(() => {
    if (!isH5() || !focus) return
    const id = setTimeout(() => {
      const native = coreRef.current?.querySelector?.('input') as HTMLInputElement | null
      if (native && document.activeElement !== native) native.focus()
    }, 0)
    return () => clearTimeout(id)
  }, [focus])

  return (
    <TaroInput
      ref={coreRef as never}
      className={cn('input', className)}
      value={value}
      placeholder={placeholder}
      password={type === 'password'}
      disabled={disabled}
      focus={isH5() ? false : focus}
      onInput={(e) => onChange?.(e.detail.value)}
      onConfirm={() => onEnter?.()}
      onBlur={(e) => onBlur?.(e.detail.value)}
    />
  )
}
