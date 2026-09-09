import { ScrollView, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { TabContextMenu, type TabMenuState } from '@/components/ui/TabContextMenu'
import { cn, formatDateTime, isH5 } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { ParagraphDraft, AttachmentDraft } from '@coeditor/shared'

export type DraftItem = ParagraphDraft | AttachmentDraft

interface DraftTabsProps {
  drafts: DraftItem[]
  currentDraftId: string
  onSelect: (draft: DraftItem) => void
  onDelete: (draftId: string) => void
  /** 批量删除（右键菜单：关闭右侧/关闭其它）。未传时退化为逐个 onDelete。 */
  onDeleteMany?: (draftIds: string[]) => void
}

export function DraftTabs({ drafts, currentDraftId, onSelect, onDelete, onDeleteMany }: DraftTabsProps) {
  const t = useT()
  const sorted = [...drafts].sort((a, b) => b.timeCreated.localeCompare(a.timeCreated))
  const [confirming, setConfirming] = useState<string | null>(null)
  // tab 右键菜单（关闭右侧/关闭其它；H5 only）
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null)

  const handleDelete = (draftId: string) => {
    // The draft store mirrors the server's currentDraftId switch when the
    // deleted draft was current, so no manual neighbour selection is needed.
    onDelete(draftId)
    setConfirming(null)
  }

  // tab 右键菜单（H5）：命中版本 tab 行 → 打开菜单（位置=光标，index=展示顺序）。
  // 作用域限定在 draft-tab-bar 内，避免与 AI 会话 tab 的右键菜单互相干扰。
  useEffect(() => {
    if (!isH5()) return
    const onContextMenu = (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest?.('.draft-tab-bar .tab-row') as HTMLElement | null
      if (!row) return
      const bar = row.closest('.draft-tab-bar')
      if (!bar) return
      const rows = Array.from(bar.querySelectorAll('.tab-row'))
      const index = rows.indexOf(row)
      if (index < 0) return
      e.preventDefault()
      setTabMenu({ x: e.clientX, y: e.clientY, index, stage: 'menu', action: 'right' })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  const deleteMany = (ids: string[]) => {
    if (onDeleteMany) onDeleteMany(ids)
    else ids.forEach(onDelete)
  }
  // 右键菜单动作（index 为展示顺序下标，sorted 新→旧；确认后执行）
  const closeRight = (index: number) => deleteMany(sorted.slice(index + 1).map((d) => d.id))
  const closeOthers = (index: number) => deleteMany(sorted.filter((_, i) => i !== index).map((d) => d.id))

  if (sorted.length === 0) {
    return (
      <View className="flex items-center px-3 py-1 text-xs text-muted" style={{ borderBottom: '1px solid var(--border)' }}>
        {t("drafts.noHistory")}
      </View>
    )
  }

  return (
    // minWidth:0 + 允许压缩：tab 多时由内部 ScrollView scrollX 横向滚动，
    // 否则 nowrap 的 tab 撑开外层 → 页面横向滚动条
    <View style={{ minWidth: 0 }}>
      <ScrollView scrollX className="flex draft-tab-bar" style={{ width: '100%' }}>
        {sorted.map((draft) => {
          const isCurrent = draft.id === currentDraftId
          return (
            <View
              key={draft.id}
              className="flex items-end shrink-0"
              style={{ borderRight: '1px solid var(--border)' }}
            >
              <View
                className={cn('tab flex items-center gap-1 tab-row', isCurrent && 'active')}
                style={{ display: 'flex', alignItems: 'center' }}
                onClick={() => onSelect(draft)}
              >
                <View>{formatDateTime(draft.timeCreated)}</View>
                <View
                  className="hover-accent"
                  style={{ display: 'flex', alignItems: 'center', padding: '0 2px', marginLeft: 4 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirming(draft.id)
                  }}
                >
                  <Icon name="close" size={14} color="var(--muted-fg)" />
                </View>
              </View>
            </View>
          )
        })}
      </ScrollView>

      <Dialog
        open={confirming !== null}
        title={t("drafts.deleteTitle")}
        onClose={() => setConfirming(null)}
      >
        <View className="text-sm text-muted">{t("drafts.deleteConfirm")}</View>
        <View className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
          <Button variant="destructive" size="sm" onClick={() => confirming && handleDelete(confirming)}>{t('common.delete')}</Button>
        </View>
      </Dialog>

      {/* 版本 tab 右键菜单（关闭右侧/关闭其它，二次确认） */}
      <TabContextMenu
        state={tabMenu}
        total={sorted.length}
        noun={t('tabMenu.nounDraft')}
        onChange={setTabMenu}
        onCloseRight={closeRight}
        onCloseOthers={closeOthers}
      />
    </View>
  )
}
