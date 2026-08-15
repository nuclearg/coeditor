import { useRef, useCallback, useState, useEffect, useId, type ReactNode } from 'react'
import { View } from '@tarojs/components'
import { cn, isH5 } from '@/lib/utils'
import { getStorage, setStorage } from '@/lib/storage'

interface ResizablePanelProps {
  children: [ReactNode, ReactNode]
  defaultRatio?: number
  minRatio?: number
  maxRatio?: number
  storageKey?: string
  className?: string
}

/** 仅 H5 桌面端使用（小程序端布局为堆叠，不渲染本组件） */
export function ResizablePanel({
  children,
  defaultRatio = 0.5,
  minRatio = 0.15,
  maxRatio = 0.85,
  storageKey,
  className,
}: ResizablePanelProps) {
  const handleId = useId().replace(/[:]/g, '')
  const containerRef = useRef<HTMLDivElement>(null)
  const [ratio, setRatioState] = useState(() => {
    if (!storageKey) return defaultRatio
    const stored = getStorage(storageKey)
    const parsed = stored !== null ? parseFloat(stored) : NaN
    return Number.isFinite(parsed) ? parsed : defaultRatio
  })
  const dragging = useRef(false)
  const ratioRef = useRef(ratio)
  ratioRef.current = ratio

  const persistRatio = useCallback(
    (r: number) => {
      if (storageKey) setStorage(storageKey, String(r))
    },
    [storageKey],
  )

  const onMouseMove = useCallback((ev: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const r = Math.min(maxRatio, Math.max(minRatio, x / rect.width))
    ratioRef.current = r
    setRatioState(r)
  }, [minRatio, maxRatio])

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    persistRatio(ratioRef.current)
  }, [onMouseMove, persistRatio])

  const onMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [onMouseMove, onMouseUp])

  // H5 桌面端：原生 DOM 上绑定 mousedown（Taro View 类型不含 onMouseDown）
  useEffect(() => {
    if (!isH5() || typeof document === 'undefined') return
    const el = document.getElementById(handleId)
    if (!el) return
    el.addEventListener('mousedown', onMouseDown)
    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [handleId, onMouseDown, onMouseMove, onMouseUp])

  return (
    <View ref={containerRef} className={cn('flex', className)} style={{ width: '100%' }}>
      <View style={{ flexBasis: `${ratio * 100}%`, minWidth: 0, overflow: 'hidden' }} className="flex flex-col">
        {children[0]}
      </View>
      <View
        id={handleId}
        className="shrink-0"
        data-resizable-handle="true"
        style={{ width: 4, cursor: 'col-resize', background: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      />
      <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }} className="flex flex-col">
        {children[1]}
      </View>
    </View>
  )
}
