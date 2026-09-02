import { useState, useCallback } from 'react'
import { showErrorToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import type { DocumentTemplate } from '@coeditor/shared'

export type SelectionState = { chapterId: string; paragraphId: string } | null

export type ViewContext = 'paragraph' | 'attachment' | 'chapter' | 'fulltext' | null

export interface ViewModeState {
  selection: SelectionState
  editingAttachmentId: string | null
  viewingChapterId: string | null
  viewingFullText: boolean
  selectionContext: ViewContext
  isEditable: boolean
}

export interface ViewModeActions {
  clearView: () => void
  switchToParagraph: (chapterId: string, paragraphId: string) => void
  switchToAttachment: (type: string) => Promise<void>
  switchToChapter: (chapterId: string) => void
  switchToFullText: () => void
}

interface UseViewModeParams {
  docId: string | undefined
  template: DocumentTemplate | null
  ensureAttachment: (docId: string, type: string) => Promise<unknown>
}

export function useViewMode({ docId, template, ensureAttachment }: UseViewModeParams): ViewModeState & ViewModeActions {
  const [selection, setSelection] = useState<SelectionState>(null)
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null)
  const [viewingChapterId, setViewingChapterId] = useState<string | null>(null)
  const [viewingFullText, setViewingFullText] = useState(false)

  const clearView = useCallback(() => {
    setSelection(null)
    setEditingAttachmentId(null)
    setViewingChapterId(null)
    setViewingFullText(false)
  }, [])

  const switchToParagraph = useCallback((chapterId: string, paragraphId: string) => {
    clearView()
    setSelection({ chapterId, paragraphId })
  }, [clearView])

  const switchToAttachment = useCallback(async (type: string) => {
    if (docId && ensureAttachment && template?.attachments.some((a) => a.type === type)) {
      try {
        await ensureAttachment(docId, type)
      } catch {
        showErrorToast(t('error.loadFailed'))
        return
      }
    }
    clearView()
    setEditingAttachmentId(type)
  }, [clearView, docId, ensureAttachment, template])

  const switchToChapter = useCallback((chapterId: string) => {
    clearView()
    setViewingChapterId(chapterId)
  }, [clearView])

  const switchToFullText = useCallback(() => {
    clearView()
    setViewingFullText(true)
  }, [clearView])

  const selectionContext: ViewContext = viewingFullText
    ? 'fulltext'
    : editingAttachmentId
      ? 'attachment'
      : viewingChapterId
        ? 'chapter'
        : selection
          ? 'paragraph'
          : null

  const isEditable = selectionContext === 'attachment' || selectionContext === 'paragraph'

  return {
    selection, editingAttachmentId, viewingChapterId, viewingFullText,
    selectionContext, isEditable,
    clearView, switchToParagraph, switchToAttachment, switchToChapter, switchToFullText,
  }
}
