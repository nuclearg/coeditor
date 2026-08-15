import { View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Dialog } from '@/components/ui/Dialog'
import { Sidebar } from '@/components/layout/Sidebar'
import { EditorPanel } from '@/components/editor/EditorPanel'
import { AiPanel } from '@/components/conversation/AiPanel'
import { LayoutShell } from '@/plugin/LayoutShell'
import { useAttachmentStore, useLayoutStore, useEditorStore, useReviewStore } from '@/stores'
import { useI18nStore } from '@/stores/i18nStore'
import { useViewMode, useDraftManager, useUnsavedGuard } from '@/hooks'
import { t, localize } from '@/lib/i18n'
import { api } from '@/api/client'
import type { Document } from '@coeditor/shared'

export default function DocumentEditPage() {
  const router = useRouter()
  const docId = router.params.docId || ''

  const [doc, setDoc] = useState<Document | null>(null)
  const [submittingForAI, setSubmittingForAI] = useState(false)

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

  // Default to the full-text view on document entry
  useEffect(() => {
    if (!docId || selection || editingAttachmentId || viewingChapterId || viewingFullText) return
    switchToFullText()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  // Submit for AI review：订阅 startReview（公开 action，docs/plugin-v2.md §4）。
  // 流程保持：先保存（失败即止），再走 AiPanel autoSubmit 链路。
  const reviewSeq = useReviewStore((s) => s.seq)
  useEffect(() => {
    if (reviewSeq === 0 || !docId) return
    const run = async () => {
      if (dirty) {
        const saved = await doSave()
        if (!saved) return // save failed — doSave already surfaced the error
      }
      setSubmittingForAI(true)
    }
    void run()
  }, [reviewSeq, docId, dirty, doSave])

  // 保存状态/动作同步到 editorStore（插件替换 editorpanel.foot 时使用）
  const syncEditorState = useEditorStore((s) => s.syncEditorState)
  useEffect(() => {
    syncEditorState(dirty, saving, doSave)
  }, [dirty, saving, doSave, syncEditorState])

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

  // Derived values
  const chapter = selection ? chapters.find((c) => c.id === selection.chapterId) : null
  const viewingChapter = viewingChapterId ? chapters.find((c) => c.id === viewingChapterId) : null
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
  else if (selection && chapter) titleBar = `${doc?.title || ''} - ${chapter.title}`

  // 面包屑同步到 layoutStore（main.head.left 默认实现渲染；离开编辑页清空回首页态）
  const setBreadcrumb = useLayoutStore((s) => s.setBreadcrumb)
  useEffect(() => {
    setBreadcrumb(titleBar)
    return () => setBreadcrumb('')
  }, [titleBar, setBreadcrumb])

  // 只读视图（全文/章节）tab 标题：只显示视图名，不带文档级面包屑
  let viewTitle = t('sidebar.fulltext')
  if (editingAttachmentId) viewTitle = editingAttachmentName
  else if (viewingChapterId && viewingChapter) viewTitle = viewingChapter.title
  else if (viewingFullText) viewTitle = t('sidebar.fulltext')

  // Full-page loading overlay
  if (booting) {
    return (
      <LayoutShell
        editor={
          <View className="flex items-center justify-center" style={{ flex: 1 }}>
            <View className="flex flex-col items-center gap-2">
              <View className="spinner" />
              <View className="text-sm text-muted">{t('common.loading')}</View>
            </View>
          </View>
        }
      />
    )
  }

  return (
    <LayoutShell
      sidebar={
        <Sidebar
          docId={docId || ''} doc={doc} template={template} open
          onNavigateHome={handleNavigateHome}
          selectedParagraphId={selection?.paragraphId || null}
          viewingChapterId={viewingChapterId} viewingFullText={viewingFullText}
          editingAttachmentId={editingAttachmentId}
          onSelectParagraph={handleSelectParagraph} onSelectChapter={handleSelectChapter}
          onSelectAttachment={handleSelectAttachment} onSelectFullText={handleSelectFullText}
        />
      }
      editor={
        <EditorPanel
          isEditable={isEditable}
          selectionContext={!!selectionContext}
          contentLoading={contentLoading}
          content={content}
          onChange={handleChange}
          displayContent={displayContent}
          editingAttachmentId={editingAttachmentId}
          editingAttachmentName={editingAttachmentName}
          activeDrafts={activeDrafts}
          activeCurrentDraftId={activeCurrentDraftId}
          onSelectDraft={handleSelectDraft}
          onDeleteDraft={handleDeleteDraft}
          dirty={dirty}
          saving={saving}
          doSave={doSave}
          viewTitle={!isEditable ? viewTitle : undefined}
        />
      }
      ai={
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
        />
      }
    >
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
    </LayoutShell>
  )
}
