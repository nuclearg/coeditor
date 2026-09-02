import { View } from '@tarojs/components'
import { useEffect, useRef } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { cn, isH5 } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * tab 右键菜单状态。stage='menu' 显示菜单；选中菜单项后 stage='confirm'
 * 弹出二次确认（执行前必须确认）。index 为右键命中的 tab 在展示顺序中的下标。
 */
export interface TabMenuState {
  x: number
  y: number
  index: number
  stage: 'menu' | 'confirm'
  action: 'right' | 'others'
}

interface TabContextMenuProps {
  /** null=关闭 */
  state: TabMenuState | null
  /** 当前 tab 总数（用于计数与禁用无效项） */
  total: number
  /** 对象名词（会话/版本），用于确认文案 */
  noun: string
  /** 状态变更（menu→confirm / 关闭）。父组件持有 state。 */
  onChange: (next: TabMenuState | null) => void
  /** 确认后执行：关闭右侧（含 index 之后的全部） */
  onCloseRight: (index: number) => void
  /** 确认后执行：关闭其它（除 index 外全部） */
  onCloseOthers: (index: number) => void
}

/** tab 右键菜单 + 二次确认（H5 only：右键仅存在于 Web 端） */
export function TabContextMenu({ state, total, noun, onChange, onCloseRight, onCloseOthers }: TabContextMenuProps) {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)

  const open = state !== null
  const rightCount = state ? total - state.index - 1 : 0
  const othersCount = state ? total - 1 : 0
  const confirmCount = state?.action === 'right' ? rightCount : othersCount

  // 点击空白处关闭菜单（仅左键；右键会由 tab 的 contextmenu 重新打开新菜单）
  useEffect(() => {
    if (!open || !isH5()) return
    const onDocClick = (e: MouseEvent) => {
      if (e.button !== 0) return
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      onChange(null)
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [open, onChange])

  // 菜单贴边钳制：不超出视口
  useEffect(() => {
    if (!state || state.stage !== 'menu' || !isH5()) return
    const el = menuRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    el.style.left = `${Math.min(state.x, Math.max(0, window.innerWidth - w - 8))}px`
    el.style.top = `${Math.min(state.y, Math.max(0, window.innerHeight - h - 8))}px`
  }, [state])

  if (!state) return null

  const choose = (action: 'right' | 'others') => {
    const count = action === 'right' ? rightCount : othersCount
    if (count <= 0) return
    // 保持位置，仅切换阶段（确认框由 Dialog 居中展示）
    onChange({ ...state, stage: 'confirm', action })
  }
  const confirm = () => {
    if (state.action === 'right') onCloseRight(state.index)
    else onCloseOthers(state.index)
    onChange(null)
  }

  return (
    <>
      {state.stage === 'menu' && (
        <View
          ref={menuRef as React.Ref<HTMLDivElement>}
          className="tab-menu"
          style={{ left: state.x, top: state.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <View
            className={cn('menu-item', rightCount <= 0 && 'menu-item-disabled')}
            onClick={() => choose('right')}
          >
            {t('tabMenu.closeRight')}
          </View>
          <View
            className={cn('menu-item', othersCount <= 0 && 'menu-item-disabled')}
            onClick={() => choose('others')}
          >
            {t('tabMenu.closeOthers')}
          </View>
        </View>
      )}

      {state.stage === 'confirm' && (
        <Dialog
          open
          title={t(state.action === 'right' ? 'tabMenu.closeRight' : 'tabMenu.closeOthers')}
          onClose={() => onChange(null)}
        >
          <View className="text-sm text-muted">
            {t(state.action === 'right' ? 'tabMenu.closeRightConfirm' : 'tabMenu.closeOthersConfirm', {
              count: confirmCount,
              noun,
            })}
          </View>
          <View className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" size="sm" onClick={confirm}>{t('common.confirm')}</Button>
          </View>
        </Dialog>
      )}
    </>
  )
}
