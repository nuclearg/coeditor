import { Textarea as TaroTextarea } from '@tarojs/components'
import { useEffect, useId } from 'react'
import { cn, isH5 } from '@/lib/utils'

interface TextareaProps {
  value?: string
  placeholder?: string
  disabled?: boolean
  autoHeight?: boolean
  /**
   * 输入上限（字符）。Taro Textarea 默认 maxlength=140（微信小程序原生默认），
   * 会悄悄截断长文——这里显式放宽到与服务端一致的附件上限；
   * 调用处可按场景覆盖（AI 输入 50000 / 段落 100000 / 附件 200000）。
   */
  maxLength?: number
  onChange?: (value: string) => void
  onEnter?: (withShift: boolean) => void
  className?: string
  style?: React.CSSProperties
}

export function Textarea({
  value,
  placeholder,
  disabled,
  autoHeight,
  maxLength = 200000,
  onChange,
  onEnter,
  className,
  style,
}: TextareaProps) {
  const id = useId().replace(/[:]/g, '')

  // H5：原生 textarea 上监听 Enter（小程序端用 onConfirm）
  useEffect(() => {
    if (!isH5() || typeof document === 'undefined') return
    const el = document.getElementById(id)
    if (!el) return
    const onKeyDown = (e: KeyboardEvent) => {
      // IME 组合态（中文输入法组词回车）不触发发送
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        // 仅当有 onEnter 时拦截 Enter（发送语义）；无 onEnter 时保留默认换行
        if (onEnter) {
          e.preventDefault()
          onEnter(false)
        }
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [id, onEnter])

  return (
    <TaroTextarea
      id={id}
      className={cn('textarea', className)}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoHeight={autoHeight}
      maxlength={maxLength}
      style={style}
      onInput={(e) => onChange?.(e.detail.value)}
      onConfirm={isH5() ? undefined : () => onEnter?.(false)}
      confirmType={onEnter ? 'send' : 'return'}
    />
  )
}
