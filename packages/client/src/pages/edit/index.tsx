import { View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNavBar } from '@/components/layout/MobileNavBar'
import { Layout } from '@/components/layout/Layout'
import { AiPanel } from '@/components/conversation/AiPanel'
import { DraftTabs } from '@/components/document/DraftTabs'
import { SlotHost } from '@/plugin/SlotHost'
import { ResizablePanel } from '@/components/ui/Resizable'
import { Dialog } from '@/components/ui/Dialog'
import { Sheet } from '@/components/ui/Sheet'
import { useUIStore, useAttachmentStore } from '@/stores'
import { useI18nStore } from '@/stores/i18nStore'
import { useViewMode, useDraftManager, useUnsavedGuard, useIsMobile } from '@/hooks'
import { t, localize } from '@/lib/i18n'
import { isH5 } from '@/lib/utils'
import { api } from '@/api/client'
import type { Document } from '@coeditor/shared'

export default function DocumentEditPage() {
  const router = useRouter()
  const docId = router.params.docId || ''

  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)

  const [doc, setDoc] = useState<Document | null>(null)
  const [submittingForAI, setSubmittingForAI] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const isMobile = useIsMobile()

  // --- Template ---
  const templates = useAttachmentStore((s) => s.templates)
  const loadTemplates = useAttachmentStore((s) => s.loadTemplates)
  const ensureAttachment = useAttachmentStore((s) => s.ensureAttachment)
  // 订阅语言：附件名等本地化内容随语言切换即时更新
  useI18nStore((s) => s.language)

  useEffect(() => {
    loadTemplates().catch(() => {})
  }, [loadTemplates])

  const template = useMemo(
    () => templates.find((t) => t.id === (doc?.templateId || 'novel')) || null,
    [templates, doc?.templateId],
  )

  // --- View Mode ---
  const viewMode = useViewMode({
    docId,
    template,
    ensureAttachment,
  })

  const { selection, editingAttachmentId, viewingChapterId, viewingFullText, selectionContext, isEditable } = viewMode
  const { switchToParagraph, switchToAttachment, switchToChapter, switchToFullText, clearView } = viewMode

  // --- Draft Manager (with actual view state) ---
  const draftMgr = useDraftManager({
    docId, template, selection, editingAttachmentId, viewingChapterId, viewingFullText,
  })

  const {
    chapters, paragraphsByChapter,
    booting, contentLoading,
    content, saving, dirty, setDirty,
    reviewContext, displayContent,
    activeDrafts, activeCurrentDraftId,
    doSave, handleDraftSelect, handleDraftDelete, handleChange,
  } = draftMgr

  // --- Unsaved Guard ---
  const guard = useUnsavedGuard({
    dirty, doSave, switchToParagraph, switchToAttachment, switchToChapter, switchToFullText,
    selectDraft: handleDraftSelect, deleteDraft: handleDraftDelete, setDirty,
  })

  const {
    showUnsavedDialog, setShowUnsavedDialog, setPendingTarget,
    handleSelectParagraph, handleSelectChapter, handleSelectAttachment, handleSelectFullText,
    handleSelectDraft, handleDeleteDraft,
    handleUnsavedSave, handleUnsavedDiscard,
  } = guard

  // Navigate home with unsaved guard
  const handleNavigateHome = useCallback(() => {
    if (dirty) {
      setShowUnsavedDialog(true)
      setPendingTarget({ type: 'home' })
    } else {
      Taro.redirectTo({ url: '/pages/index/index' })
    }
  }, [dirty, setShowUnsavedDialog, setPendingTarget])

  // Load document on mount
  useEffect(() => {
    if (!docId) return
    api.rpc<Document>('documents.get', { docId }).then(setDoc).catch((err) => console.error('[loadDoc]', err))
  }, [docId])

  // Sync sidebar state with viewport size
  useEffect(() => {
    setSidebarOpen(!isMobile)
  }, [isMobile, setSidebarOpen])

  // Default to the full-text view on document entry
  useEffect(() => {
    if (!docId || selection || editingAttachmentId || viewingChapterId || viewingFullText) return
    switchToFullText()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  // Submit for AI review
  const handleSubmitAIReview = useCallback(async () => {
    if (!docId) return
    if (dirty) {
      const saved = await doSave()
      if (!saved) return // save failed — doSave already surfaced the error
    }
    setSubmittingForAI(true)
  }, [docId, dirty, doSave])

  // Clear view when the selected entity was deleted
  useEffect(() => {
    if (!selection) return
    const paras = paragraphsByChapter[selection.chapterId]
    if (paras && !paras.some((p) => p.id === selection.paragraphId)) clearView()
  }, [selection, paragraphsByChapter, clearView])

  useEffect(() => {
    if (!viewingChapterId || chapters.length === 0) return
    if (!chapters.some((c) => c.id === viewingChapterId)) clearView()
  }, [viewingChapterId, chapters, clearView])

  // Mobile helpers
  const handleMobileSelectChapter = (chapterId: string) => {
    handleSelectChapter(chapterId)
    setMobileSidebarOpen(false)
  }
  const handleToggleMobileSidebar = () => setMobileSidebarOpen((prev) => !prev)

  // Derived values
  const chapter = selection ? chapters.find((c) => c.id === selection.chapterId) : null
  const viewingChapter = viewingChapterId ? chapters.find((c) => c.id === viewingChapterId) : null
  const paraName = selection
    ? paragraphsByChapter[selection.chapterId]?.find((p) => p.id === selection.paragraphId)?.name || ''
    : ''
  const editingAttachmentName = editingAttachmentId
    ? (() => {
        const def = template?.attachments.find((a) => a.type === editingAttachmentId)
        if (!def) return editingAttachmentId
        return typeof def.name === 'string' ? def.name : localize(def.name)
      })()
    : ''

  // Title
  let titleBar = doc?.title || t('common.loading')
  if (viewingFullText) titleBar = `${doc?.title || ''} - ${t('sidebar.fulltext')}`
  else if (editingAttachmentId) titleBar = `${doc?.title || ''} - ${editingAttachmentName}`
  else if (viewingChapterId && viewingChapter) titleBar = `${doc?.title || ''} - ${viewingChapter.title}`
  else if (selection && chapter) titleBar = `${doc?.title || ''} - ${chapter.title} - ${paraName || t('sidebar.paragraphN', { n: 1 })}`

  const renderWritingArea = () => (
    <View className="flex flex-col" style={!isMobile ? { flex: 1, minHeight: 0 } : undefined}>
      {/* editor-top 插槽（默认：DraftTabs 版本行） */}
      {isEditable && (
        <SlotHost
          slot="editor-top"
          ctx={{
            activeDrafts,
            currentDraftId: activeCurrentDraftId,
            renderDraftTabs: () => (
              <DraftTabs drafts={activeDrafts} currentDraftId={activeCurrentDraftId} onSelect={handleSelectDraft} onDelete={handleDeleteDraft} />
            ),
          }}
          defaults={
            <DraftTabs drafts={activeDrafts} currentDraftId={activeCurrentDraftId} onSelect={handleSelectDraft} onDelete={handleDeleteDraft} />
          }
        />
      )}

      <View className="p-4" style={!isMobile ? { flex: 1, minHeight: 0, overflow: 'auto' } : undefined}>
        {selectionContext ? (
          isEditable ? (
            <Textarea
              className="text-base editor-textarea"
              placeholder={contentLoading ? t('common.loading') : (editingAttachmentId ? t('editor.writeAttachment', { name: editingAttachmentName }) : t('editor.startWriting'))}
              value={content}
              onChange={handleChange}
              autoHeight
              disabled={contentLoading}
            />
          ) : (
            <View>
              <View className="whitespace-pre-wrap text-sm text-muted">{displayContent || t('common.empty')}</View>
            </View>
          )
        ) : (
          <View className="flex items-start justify-center text-muted" style={{ paddingTop: 100 }}>
            <View className="text-sm font-medium">{t("editor.writingArea")}</View>
          </View>
        )}
      </View>

      {selectionContext && (
        <View className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <SlotHost
            slot="editor-bottom"
            ctx={{
              dirty, saving, doSave,
              submitReview: handleSubmitAIReview,
              renderSaveButton: (opts) => (
                <Button onClick={() => doSave()} disabled={!dirty || saving} style={{ height: isH5() ? 40 : 76, padding: isH5() ? '0 24px' : undefined }}>
                  {opts?.label ?? t('common.save')}
                </Button>
              ),
              renderReviewButton: () => (
                <Button onClick={handleSubmitAIReview} variant="outline" style={{ height: isH5() ? 40 : 76, padding: isH5() ? '0 24px' : undefined }}>
                  {t('editor.review')}
                </Button>
              ),
            }}
            defaults={
              <>
                <View className="flex-1" />
                {isEditable && (
                  <Button onClick={() => doSave()} disabled={!dirty || saving} style={{ height: isH5() ? 40 : 76, padding: isH5() ? '0 24px' : undefined }}>
                    {t('common.save')}
                  </Button>
                )}
                <Button onClick={handleSubmitAIReview} variant="outline" style={{ height: isH5() ? 40 : 76, padding: isH5() ? '0 24px' : undefined }}>
                  {t('editor.review')}
                </Button>
              </>
            }
          />
        </View>
      )}
    </View>
  )

  const renderAiPanel = () => (
    <AiPanel
      docId={docId || ''}
      selection={selection}
      currentContent={reviewContext}
      isAttachment={!!editingAttachmentId}
      attachmentId={editingAttachmentId || undefined}
      isChapter={!!viewingChapterId}
      chapterId={viewingChapterId || undefined}
      isFullText={viewingFullText}
      autoSubmit={submittingForAI}
      onAutoSubmitDone={() => setSubmittingForAI(false)}
      fill={!isMobile}
    />
  )

  // Full-page loading overlay
  if (booting) {
    return (
      <Layout onNavigateHome={handleNavigateHome}>
        <View className="flex items-center justify-center" style={{ height: '100%' }}>
          <View className="flex flex-col items-center gap-2">
            <View className="spinner" />
            <View className="text-sm text-muted">{t('common.loading')}</View>
          </View>
        </View>
      </Layout>
    )
  }

  return (
    <Layout onNavigateHome={handleNavigateHome}>
      <View className="flex flex-1" style={{ minHeight: 0 }}>
      {/* Desktop Sidebar */}
      {!isMobile && sidebarOpen && (
        <Sidebar
          docId={docId || ''} doc={doc} template={template} open={sidebarOpen}
          selectedParagraphId={selection?.paragraphId || null}
          viewingChapterId={viewingChapterId} viewingFullText={viewingFullText}
          editingAttachmentId={editingAttachmentId}
          onSelectParagraph={handleSelectParagraph} onSelectChapter={handleSelectChapter}
          onSelectAttachment={handleSelectAttachment} onSelectFullText={handleSelectFullText}
        />
      )}

      <View className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
        {/* Title bar */}
        {!isMobile && (
          <View className="flex items-center gap-2 px-4 shrink-0" style={{ height: isH5() ? 48 : 84, borderBottom: '1px solid var(--border)' }}>
            <View className="hover-accent" style={{ padding: 8, borderRadius: 8 }} onClick={toggleSidebar}>
              <Icon name="menu" size={28} />
            </View>
            <View className="flex-1 font-medium text-sm truncate">{titleBar}</View>
            {dirty && <View className="text-amber text-xs" style={{ fontSize: 20 }}>{t("editor.unsaved")}</View>}
            {saving && <View className="text-xs text-muted">{t("editor.saving")}</View>}
          </View>
        )}

        {/* Mobile: merged title + chapter nav bar */}
        {isMobile && (
          <MobileNavBar
            chapters={chapters}
            title={titleBar}
            dirty={dirty}
            saving={saving}
            viewContext={selection ? 'paragraph' : viewingChapterId ? 'chapter' : viewingFullText ? 'fulltext' : editingAttachmentId ? 'attachment' : null}
            currentChapterId={viewingChapterId || selection?.chapterId || null}
            selection={selection}
            paragraphsByChapter={paragraphsByChapter}
            onSelectParagraph={handleSelectParagraph}
            onSelectChapter={handleMobileSelectChapter}
            onToggleSidebar={handleToggleMobileSidebar}
          />
        )}

        {/* Desktop: side-by-side */}
        {!isMobile && (
          <View className="flex-1" style={{ minHeight: 0, display: 'flex' }}>
            <ResizablePanel storageKey="coeditor-editor-split" defaultRatio={0.5}>
              {renderWritingArea()}
              {renderAiPanel()}
            </ResizablePanel>
          </View>
        )}

        {/* Mobile: stacked */}
        {isMobile && (
          <View className="flex-1 overflow-y-auto">
            <View>{renderWritingArea()}</View>
            <View style={{ borderTop: '1px solid var(--border)' }}>{renderAiPanel()}</View>
          </View>
        )}
      </View>

      {/* Mobile Sidebar Sheet */}
      <Sheet open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)}>
        <Sidebar
          docId={docId || ''} doc={doc} template={template} open={true}
          selectedParagraphId={selection?.paragraphId || null}
          viewingChapterId={viewingChapterId} viewingFullText={viewingFullText}
          editingAttachmentId={editingAttachmentId}
          onSelectParagraph={(chId, pId) => { handleSelectParagraph(chId, pId); setMobileSidebarOpen(false) }}
          onSelectChapter={(chId) => { handleSelectChapter(chId); setMobileSidebarOpen(false) }}
          onSelectAttachment={(type) => { handleSelectAttachment(type); setMobileSidebarOpen(false) }}
          onSelectFullText={() => { handleSelectFullText(); setMobileSidebarOpen(false) }}
        />
      </Sheet>

      {/* Unsaved dialog */}
      <Dialog
        open={showUnsavedDialog}
        title={
          <>
            <Icon name="warn" size={30} color="#a8823f" />
            <View>{t('editor.unsavedTitle')}</View>
          </>
        }
        onClose={() => setShowUnsavedDialog(false)}
      >
        <View className="text-sm text-muted">{t('editor.unsavedHint')}</View>
        <View className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={() => setShowUnsavedDialog(false)}>{t('common.cancel')}</Button>
          <Button variant="outline" size="sm" onClick={handleUnsavedDiscard}>{t('editor.discard')}</Button>
          <Button size="sm" onClick={handleUnsavedSave}> {t("editor.saveAndSwitch")} </Button>
        </View>
      </Dialog>
      </View>
    </Layout>
  )
}
