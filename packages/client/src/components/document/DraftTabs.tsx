import { ScrollView, View } from '@tarojs/components'
import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { ParagraphDraft, AttachmentDraft } from '@coeditor/shared'

export type DraftItem = ParagraphDraft | AttachmentDraft

interface DraftTabsProps {
  drafts: DraftItem[]
  currentDraftId: string
  onSelect: (draft: DraftItem) => void
  onDelete: (draftId: string) => void
}

export function DraftTabs({ drafts, currentDraftId, onSelect, onDelete }: DraftTabsProps) {
  const t = useT()
  const sorted = [...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const [confirming, setConfirming] = useState<string | null>(null)

  const handleDelete = (draftId: string) => {
    // The draft store mirrors the server's currentDraftId switch when the
    // deleted draft was current, so no manual neighbour selection is needed.
    onDelete(draftId)
    setConfirming(null)
  }

  if (sorted.length === 0) {
    return (
      <View className="flex items-center px-3 py-1 text-xs text-muted" style={{ borderBottom: '1px solid var(--border)' }}>
        {t("drafts.noHistory")}
      </View>
    )
  }

  return (
    <View className="shrink-0">
      <ScrollView scrollX className="flex" style={{ width: '100%' }}>
        {sorted.map((draft) => {
          const isCurrent = draft.id === currentDraftId
          return (
            <View
              key={draft.id}
              className="flex items-center shrink-0"
              style={{ borderRight: '1px solid var(--border)' }}
            >
              <View
                className={cn('tab flex items-center gap-1', isCurrent && 'active')}
                style={{ display: 'flex', alignItems: 'center' }}
                onClick={() => onSelect(draft)}
              >
                <View>{formatDraftTime(draft.createdAt, t)}</View>
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
    </View>
  )
}

function formatDraftTime(iso: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)

  if (diffMin < 1) return t('drafts.justNow')
  if (diffMin < 60) return t("drafts.minutesAgo", { n: diffMin })
  if (diffHour < 24) return t("drafts.hoursAgo", { n: diffHour })

  const month = d.getMonth() + 1
  const day = d.getDate()
  const hour = d.getHours().toString().padStart(2, '0')
  const min = d.getMinutes().toString().padStart(2, '0')
  return `${month}/${day} ${hour}:${min}`
}
