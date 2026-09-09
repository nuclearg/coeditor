import { useState, useEffect } from 'react'
import { isH5 } from '@/lib/utils'

/**
 * 是否窄屏（移动布局）。小程序端恒为 true，H5 跟随媒体查询。
 */
export function useIsMobile(maxWidth = 1023): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (!isH5() || typeof window === 'undefined') return true
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches
  })

  useEffect(() => {
    if (!isH5() || typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [maxWidth])

  return isMobile
}
