import { View } from '@tarojs/components'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { DraftTabs, type DraftItem } from '@/components/document/DraftTabs'
import { SlotHost } from '@/plugin/SlotHost'
import { useReviewStore } from '@/stores/reviewStore'
import { isH5 } from '@/lib/utils'
import { useIsMobile } from '@/hooks'
import { useT } from '@/lib/i18n'

interface EditorPanelProps {
  isEditable: boolean
  /** 是否有可编辑上下文（段落/附件）；false 显示空态 */
  selectionContext: boolean
  contentLoading: boolean
  content: string
  onChange: (value: string) => void
  displayContent: string
  editingAttachmentId: string | null
  editingAttachmentName: string
  activeDrafts: DraftItem[]
  activeCurrentDraftId: string
  onSelectDraft: (draft: DraftItem) => void
  onDeleteDraft: (draftId: string) => void
  dirty: boolean
  saving: boolean
  doSave: () => Promise<boolean>
  /** 只读视图（全文/章节）的 tab 标题（与面包屑一致） */
  viewTitle?: string
}

/**
 * editorpanel 区块：head/body/foot 为插件扩展点（ctx 恒空，docs/plugin-v2.md §6）。
 * 默认实现用 props；插件替换 foot 时数据/动作走 stores（editorStore/reviewStore）。
 */
export function EditorPanel({
  isEditable,
  selectionContext,
  contentLoading,
  content,
  onChange,
  displayContent,
  editingAttachmentId,
  editingAttachmentName,
  activeDrafts,
  activeCurrentDraftId,
  onSelectDraft,
  onDeleteDraft,
  dirty,
  saving,
  doSave,
  viewTitle,
}: EditorPanelProps) {
  const t = useT()
  // PC 宽屏占满 body；H5 窄屏/wxapp 用 autoHeight（随内容增长）
  const isMobile = useIsMobile()

  const headbarMiddleDefaults = isEditable ? (
    <DraftTabs drafts={activeDrafts} currentDraftId={activeCurrentDraftId} onSelect={onSelectDraft} onDelete={onDeleteDraft} />
  ) : viewTitle ? (
    <View className="tab active" style={{ display: 'flex', alignItems: 'center', userSelect: 'none' }}>{viewTitle}</View>
  ) : undefined


  return (
    <View className="flex flex-col" style={isMobile ? undefined : { flex: 1, minHeight: 0 }}>
      {/* editorpanel.head：左=留空 / 中=draft tabs 或只读视图 tab（左对齐，贴底使指示条紧贴内容）/ 右=留空（固定高度，无边框） */}
      <SlotHost
        slot="editorpanel.head"
        defaults={
          <View className="flex items-end gap-2 shrink-0" style={{ height: isH5() ? 30 : 50 }}>
            <SlotHost slot="editorpanel.head.left" />
            <SlotHost slot="editorpanel.head.middle" defaults={headbarMiddleDefaults} />
            <View className="flex-1" />
            <SlotHost slot="editorpanel.head.right" />
          </View>
        }
      />

      {/* editorpanel.body：书写区（无容器 padding；textarea 内部自带留白，顶部贴紧 tabs） */}
      <SlotHost
        slot="editorpanel.body"
        defaults={
          <View style={isMobile
            ? { overflowX: 'hidden' }
            : { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {selectionContext ? (
              isEditable ? (
                <Textarea
                  className="text-base editor-textarea"
                  placeholder={contentLoading ? t('common.loading') : (editingAttachmentId ? t('editor.writeAttachment', { name: editingAttachmentName }) : t('editor.startWriting'))}
                  value={content}
                  onChange={onChange}
                  autoHeight={isMobile}
                  style={isMobile
                    ? { border: '1px solid var(--border)' }
                    : { height: '100%', minHeight: 0, border: '1px solid var(--border)' }}
                  disabled={contentLoading}
                />
              ) : (
                <View style={{ padding: isH5() ? 12 : 16, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <View className="whitespace-pre-wrap text-sm text-muted">{displayContent || t('common.empty')}</View>
                </View>
              )
            ) : (
              <View className="flex items-start justify-center text-muted" style={{ paddingTop: 100 }}>
                <View className="text-sm font-medium">{t('editor.writingArea')}</View>
              </View>
            )}
          </View>
        }
      />

      {/* editorpanel.foot：左/中空，右=保存 + 审阅按钮（审阅按钮为 review-button 组件级锚点） */}
      {selectionContext && (
        <SlotHost
          slot="editorpanel.foot"
          defaults={
            <View className="flex items-center gap-2 shrink-0" style={{ height: isH5() ? 38 : 60 }}>
              <View className="flex-1">
                <SlotHost slot="editorpanel.foot.left" />
              </View>
              <SlotHost slot="editorpanel.foot.middle" />
              <View className="flex-1" />
              <SlotHost
                slot="editorpanel.foot.right"
                defaults={
                  <>
                    {isEditable && (
                      <Button onClick={() => doSave()} disabled={!dirty || saving} style={{ height: isH5() ? 38 : 60, padding: isH5() ? '0 24px' : undefined }}>
                        {t('common.save')}
                      </Button>
                    )}
                    <SlotHost
                      slot="review-button"
                      defaults={
                        <Button onClick={() => useReviewStore.getState().startReview()} variant="outline" style={{ height: isH5() ? 38 : 60, padding: isH5() ? '0 24px' : undefined }}>
                          {t('editor.review')}
                        </Button>
                      }
                    />
                  </>
                }
              />
            </View>
          }
        />
      )}
    </View>
  )
}
