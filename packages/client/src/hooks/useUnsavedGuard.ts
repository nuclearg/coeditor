import { useState, useCallback, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { isH5 } from '@/lib/utils'
import type { DraftItem } from '@/components/document/DraftTabs'

export type PendingTarget =
  | { type: 'paragraph'; chapterId: string; paragraphId: string }
  | { type: 'chapter'; chapterId: string }
  | { type: 'attachment'; attachmentType: string }
  | { type: 'fulltext' }
  | { type: 'home' }
  | { type: 'draft'; draft: DraftItem }
  | { type: 'draftDelete'; draftId: string }
  | { type: 'draftDeleteMany'; draftIds: string[] }
  | null

interface UseUnsavedGuardParams {
  dirty: boolean
  doSave: () => Promise<boolean>
  switchToParagraph: (chapterId: string, paragraphId: string) => void
  switchToChapter: (chapterId: string) => void
  switchToAttachment: (type: string) => Promise<void>
  switchToFullText: () => void
  selectDraft: (draft: DraftItem) => void
  deleteDraft: (draftId: string) => void
  /** 批量删除（tab 右键菜单） */
  deleteDrafts: (draftIds: string[]) => void
  setDirty: (dirty: boolean) => void
}

export function useUnsavedGuard({
  dirty, doSave, switchToParagraph, switchToChapter, switchToAttachment, switchToFullText,
  selectDraft, deleteDraft, deleteDrafts, setDirty,
}: UseUnsavedGuardParams) {
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>(null)

  // Warn on page close/refresh while there are unsaved changes (H5 only)
  useEffect(() => {
    if (!dirty || !isH5()) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const handleSelectParagraph = useCallback((chapterId: string, paragraphId: string) => {
    if (dirty) { setPendingTarget({ type: 'paragraph', chapterId, paragraphId }); setShowUnsavedDialog(true); return }
    switchToParagraph(chapterId, paragraphId)
  }, [dirty, switchToParagraph])

  const handleSelectChapter = useCallback((chapterId: string) => {
    if (dirty) { setPendingTarget({ type: 'chapter', chapterId }); setShowUnsavedDialog(true); return }
    switchToChapter(chapterId)
  }, [dirty, switchToChapter])

  const handleSelectAttachment = useCallback(async (type: string) => {
    if (dirty) { setPendingTarget({ type: 'attachment', attachmentType: type }); setShowUnsavedDialog(true); return }
    await switchToAttachment(type)
  }, [dirty, switchToAttachment])

  const handleSelectFullText = useCallback(() => {
    if (dirty) { setPendingTarget({ type: 'fulltext' }); setShowUnsavedDialog(true); return }
    switchToFullText()
  }, [dirty, switchToFullText])

  const handleSelectDraft = useCallback((draft: DraftItem) => {
    if (dirty) { setPendingTarget({ type: 'draft', draft }); setShowUnsavedDialog(true); return }
    selectDraft(draft)
  }, [dirty, selectDraft])

  const handleDeleteDraft = useCallback((draftId: string) => {
    if (dirty) { setPendingTarget({ type: 'draftDelete', draftId }); setShowUnsavedDialog(true); return }
    deleteDraft(draftId)
  }, [dirty, deleteDraft])

  const handleDeleteDrafts = useCallback((draftIds: string[]) => {
    if (dirty) { setPendingTarget({ type: 'draftDeleteMany', draftIds }); setShowUnsavedDialog(true); return }
    deleteDrafts(draftIds)
  }, [dirty, deleteDrafts])

  const executePending = useCallback(() => {
    setShowUnsavedDialog(false)
    const target = pendingTarget
    setPendingTarget(null)
    if (!target) return
    switch (target.type) {
      case 'paragraph': switchToParagraph(target.chapterId, target.paragraphId); break
      case 'chapter': switchToChapter(target.chapterId); break
      case 'attachment': switchToAttachment(target.attachmentType); break
      case 'fulltext': switchToFullText(); break
      case 'home': Taro.redirectTo({ url: '/pages/index/index' }); break
      case 'draft': selectDraft(target.draft); break
      case 'draftDelete': deleteDraft(target.draftId); break
      case 'draftDeleteMany': deleteDrafts(target.draftIds); break
    }
  }, [pendingTarget, switchToParagraph, switchToChapter, switchToAttachment, switchToFullText, selectDraft, deleteDraft, deleteDrafts])

  const handleUnsavedSave = useCallback(async () => {
    const saved = await doSave()
    // On failure doSave already surfaced an error toast; keep the dialog open
    // so the user can retry or discard instead of silently losing the switch.
    if (saved) executePending()
  }, [doSave, executePending])

  const handleUnsavedDiscard = useCallback(() => {
    setDirty(false)
    executePending()
  }, [executePending, setDirty])

  return {
    showUnsavedDialog, setShowUnsavedDialog,
    setPendingTarget,
    handleSelectParagraph, handleSelectChapter, handleSelectAttachment, handleSelectFullText,
    handleSelectDraft, handleDeleteDraft, handleDeleteDrafts,
    handleUnsavedSave, handleUnsavedDiscard,
  }
}
