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
  /** 批量删除草稿版本（tab 右键菜单：关闭右侧/关闭其它） */
  onDeleteDrafts?: (draftIds: string[]) => void
  dirty: boolean
  saving: boolean
  doSave: () => Promise<boolean>
  /** 只读视图（全文/章节）的 tab 标题（与面包屑一致） */
  viewTitle?: string
}

/**
 * editorpanel 区块：head/body/foot 为插件扩展点（ctx 恒空，docs/plugin.md §6）。
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
  onDeleteDrafts,
  dirty,
  saving,
  doSave,
  viewTitle,
}: EditorPanelProps) {
  const t = useT()
  // PC 宽屏占满 body；H5 窄屏/wxapp 用 autoHeight（随内容增长）
  const isMobile = useIsMobile()

  const headbarMiddleDefaults = isEditable ? (
    <DraftTabs drafts={activeDrafts} currentDraftId={activeCurrentDraftId} onSelect={onSelectDraft} onDelete={onDeleteDraft} onDeleteMany={onDeleteDrafts} />
  ) : viewTitle ? (
    <View className="tab active" style={{ display: 'flex', alignItems: 'center', userSelect: 'none' }}>{viewTitle}</View>
  ) : undefined


  return (
    <View className="flex flex-col" style={isMobile ? undefined : { flex: 1, minHeight: 0 }}>
      {/* editorpanel.head：左=留空 / 中=draft tabs 或只读视图 tab（左对齐，贴底使指示条紧贴内容）/ 右=留空（固定高度，无边框） */}
      {/* middle 必须 flex:1 + minWidth:0：draft tab 多时由内部 ScrollView scrollX 横向滚动，
          否则 nowrap 的 tab 会撑开 head → 页面出现横向滚动条（与 AiPanel 会话 tab 同款处理） */}
      <SlotHost
        slot="editorpanel.head"
        defaults={
          <View className="flex items-end gap-2 shrink-0" style={{ height: isH5() ? 30 : 50 }}>
            <SlotHost slot="editorpanel.head.left" />
            <View style={{ flex: 1, minWidth: 0, display: 'flex' }}>
              <SlotHost slot="editorpanel.head.middle" defaults={headbarMiddleDefaults} />
            </View>
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
                  // 与后端一致：附件（大纲/世界观/人设）200000 字符，段落 100000
                  maxLength={editingAttachmentId ? 200000 : 100000}
                  style={isMobile
                    ? { border: '1px solid var(--border)' }
                    : { height: '100%', minHeight: 0, border: '1px solid var(--border)' }}
                  disabled={contentLoading}
                />
              ) : (
                // 只读视图（全文/章节）：无圆角，高度撑满 body，内容多时自身滚动
                <View style={{ height: '100%', minHeight: 0, overflowY: 'auto', padding: isH5() ? 12 : 16, border: '1px solid var(--border)' }}>
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
                {/* foot.left 扩展点（插件可装饰；导出入口已移至首页文档卡片菜单） */}
                <SlotHost slot="editorpanel.foot.left" />
              </View>
              <SlotHost slot="editorpanel.foot.middle" />
              <View className="flex-1" />
              <SlotHost
                slot="editorpanel.foot.right"
                defaults={
                  <>
                    {isEditable && (
                      <Button onClick={() => doSave()} disabled={!dirty || saving} variant="outline" style={{ height: isH5() ? 38 : 60, padding: isH5() ? '0 24px' : undefined }}>
                        {t('common.save')}
                      </Button>
                    )}
                    <SlotHost
                      slot="review-button"
                      defaults={
                        // 保存并审阅：审阅链路本身会先保存再发起（edit 页 autoSubmit 前置 doSave）
                        <Button onClick={() => useReviewStore.getState().startReview()} variant="primary" style={{ height: isH5() ? 38 : 60, padding: isH5() ? '0 24px' : undefined }}>
                          {t('editor.reviewAndSave')}
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
