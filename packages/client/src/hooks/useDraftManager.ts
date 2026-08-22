import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  useChapterStore, useParagraphStore, useParagraphDraftStore,
  useAttachmentStore,
} from '@/stores'
import type { SelectionState } from './useViewMode'
import type { DraftItem } from '@/components/document/DraftTabs'
import { t } from '@/lib/i18n'
import { getCurrentDraft, isH5 } from '@/lib/utils'
import { showErrorToast, showToast } from '@/lib/toast'
import { getDraftSnapshot, saveDraftSnapshot, clearDraftSnapshot } from '@/lib/draftPersistence'
import type { DocumentTemplate, Attachment } from '@coeditor/shared'

/** Run async tasks with bounded concurrency (default 5). */
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, limit = 5): Promise<void> {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await worker(item)
    }
  })
  await Promise.all(runners)
}

interface UseDraftManagerParams {
  docId: string | undefined
  template: DocumentTemplate | null
  selection: SelectionState
  editingAttachmentId: string | null
  viewingChapterId: string | null
  viewingFullText: boolean
}

export function useDraftManager({
  docId, template, selection, editingAttachmentId, viewingChapterId, viewingFullText,
}: UseDraftManagerParams) {
  const chapters = useChapterStore((s) => s.chapters)
  const loadChapters = useChapterStore((s) => s.loadChapters)
  const paragraphsByChapter = useParagraphStore((s) => s.paragraphsByChapter)
  const loadParagraphs = useParagraphStore((s) => s.loadParagraphs)
  const updateParagraphDraftId = useParagraphStore((s) => s.updateParagraphDraftId)
  const draftsByParagraph = useParagraphDraftStore((s) => s.draftsByParagraph)
  const loadDrafts = useParagraphDraftStore((s) => s.loadDrafts)
  const createDraft = useParagraphDraftStore((s) => s.createDraft)
  const deleteDraft = useParagraphDraftStore((s) => s.deleteDraft)
  const attachments = useAttachmentStore((s) => s.attachments)
  const draftsByAttachment = useAttachmentStore((s) => s.draftsByAttachment)
  const loadAttachments = useAttachmentStore((s) => s.loadAttachments)
  const ensureAttachment = useAttachmentStore((s) => s.ensureAttachment)
  const loadAttachmentDrafts = useAttachmentStore((s) => s.loadDrafts)
  const createAttachmentDraft = useAttachmentStore((s) => s.createDraft)
  const switchAttachmentDraft = useAttachmentStore((s) => s.switchDraft)
  const deleteAttachmentDraft = useAttachmentStore((s) => s.deleteDraft)

  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [booting, setBooting] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)

  // Full eager load on mount: chapters → outline → every chapter's paragraphs
  // → every paragraph's drafts. Only then does the UI unlock.
  const bootingDocIdRef = useRef<string | undefined>(undefined)
  // Chapters already fully loaded (by boot or incremental) — prevents the
  // incremental effect from re-loading drafts the boot already fetched.
  const preloadedChaptersRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    preloadedChaptersRef.current = new Set()
  }, [docId])
  useEffect(() => {
    if (!docId) return
    if (bootingDocIdRef.current !== docId) {
      bootingDocIdRef.current = docId
      setBooting(true)
    }
    let cancelled = false
    ;(async () => {
      try {
        await loadChapters(docId)
        await loadAttachments(docId)
        // Freshness guard: if a newer doc switch already took over the stores,
        // stop issuing loads for this (now stale) doc.
        const stillCurrent = () => !cancelled && useChapterStore.getState().docId === docId
        const chs = useChapterStore.getState().chapters
        if (!stillCurrent()) return
        chs.forEach((ch) => preloadedChaptersRef.current.add(ch.id))
        await runPool(chs, async (ch) => { await loadParagraphs(docId, ch.id) })
        if (!stillCurrent()) return
        const paraJobs: Array<[string, string]> = []
        for (const ch of chs) {
          const paras = useParagraphStore.getState().paragraphsByChapter[ch.id] || []
          for (const p of paras) paraJobs.push([ch.id, p.id])
        }
        await runPool(paraJobs, async ([chId, pId]) => { await loadDrafts(docId, chId, pId) })
        // Ensure every template attachment exists and load its drafts
        if (template && stillCurrent()) {
          await runPool(template.attachments, async (def) => {
            await ensureAttachment(docId, def.type)
            await loadAttachmentDrafts(docId, def.type)
          })
        }
        if (!cancelled) setBooting(false)
      } catch (err) {
        // Never leave the page stuck on the loading spinner.
        console.error('[boot] failed to load document', err)
        if (!cancelled) {
          setBooting(false)
          showErrorToast(t('error.loadFailed'))
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  // Load attachment drafts when template arrives later (async templates.list)
  useEffect(() => {
    if (!docId || !template) return
    ;(async () => {
      for (const def of template.attachments) {
        // Freshness guard — see the boot effect above.
        if (useAttachmentStore.getState().docId !== null && useAttachmentStore.getState().docId !== docId) return
        if (draftsByAttachment[def.type] === undefined) {
          await ensureAttachment(docId, def.type)
          await loadAttachmentDrafts(docId, def.type)
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, template?.id])

  // Incremental load for chapters added AFTER the initial boot
  useEffect(() => {
    // Wait for boot to finish so the incremental effect doesn't re-load
    // chapters the boot already fetched (paragraphDraftStore.loadDrafts has no
    // in-flight dedupe, so a concurrent double-load doubles the requests).
    if (booting) return
    if (!docId || chapters.length === 0) return
    // Freshness guard: `chapters` may still belong to the previous doc right
    // after a fast switch (loadChapters for the new doc hasn't returned).
    if (useChapterStore.getState().docId !== docId) return
    const newChapters = chapters.filter((ch) => !preloadedChaptersRef.current.has(ch.id))
    newChapters.forEach((ch) => preloadedChaptersRef.current.add(ch.id))
    ;(async () => {
      await runPool(newChapters, async (ch) => {
        if (useChapterStore.getState().docId !== docId) return
        await loadParagraphs(docId, ch.id)
        const paras = useParagraphStore.getState().paragraphsByChapter[ch.id] || []
        await runPool(paras, async (p) => { await loadDrafts(docId, ch.id, p.id) })
      })
    })().catch(() => {})
  }, [booting, docId, chapters, loadParagraphs, loadDrafts])

  // Derived: paragraph current draft
  const drafts = useMemo(
    () => (selection ? draftsByParagraph[selection.paragraphId] || [] : []),
    [selection, draftsByParagraph],
  )
  const currentDraft = useMemo(() => {
    if (!selection) return null
    const para = paragraphsByChapter[selection.chapterId]?.find((p) => p.id === selection.paragraphId)
    if (!para?.currentDraftId) return null
    return getCurrentDraft(drafts, para.currentDraftId) || null
  }, [selection, paragraphsByChapter, drafts])

  // Derived: current attachment + its current draft
  const currentAttachment: Attachment | null = editingAttachmentId ? attachments[editingAttachmentId] || null : null
  const attachmentDrafts = useMemo(
    () => (editingAttachmentId ? draftsByAttachment[editingAttachmentId] || [] : []),
    [editingAttachmentId, draftsByAttachment],
  )
  const currentAttachmentDraft = useMemo(() => {
    if (!editingAttachmentId) return null
    const att = attachments[editingAttachmentId]
    if (!att) return null
    return getCurrentDraft(attachmentDrafts, att.currentDraftId) || null
  }, [editingAttachmentId, attachments, attachmentDrafts])

  // Content ref for snapshot comparison in doSave (avoids making doSave depend on content)
  const contentRef = useRef(content)
  contentRef.current = content

  // === 本地草稿持久化（防误刷新丢内容） ===
  // 当前编辑目标 key（`p:ch/para` 或 `a:type`），由内容同步 effect 维护
  const targetKeyRef = useRef('')
  // 待写入 storage 的最新内容（handleChange 时更新，防抖后落盘）
  const pendingSnapshotRef = useRef<{ targetKey: string; content: string } | null>(null)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPendingSnapshot = useCallback(() => {
    if (snapshotTimerRef.current !== null) {
      clearTimeout(snapshotTimerRef.current)
      snapshotTimerRef.current = null
    }
    const pending = pendingSnapshotRef.current
    if (!pending || !docId) return
    pendingSnapshotRef.current = null
    saveDraftSnapshot(docId, pending.targetKey, pending.content)
  }, [docId])

  // 卸载/页面隐藏（H5 刷新/关闭前）立即把最后一次编辑落盘
  useEffect(() => {
    const onPageHide = () => flushPendingSnapshot()
    if (isH5() && typeof window !== 'undefined') {
      window.addEventListener('pagehide', onPageHide)
      window.addEventListener('beforeunload', onPageHide)
    }
    return () => {
      if (isH5() && typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide)
        window.removeEventListener('beforeunload', onPageHide)
      }
      flushPendingSnapshot()
    }
  }, [flushPendingSnapshot])

  // 切换编辑目标时，把上一个目标尚未落盘的编辑立即写入，避免丢失
  const scheduleSnapshot = useCallback((targetKey: string, value: string) => {
    pendingSnapshotRef.current = { targetKey, content: value }
    if (snapshotTimerRef.current !== null) clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null
      flushPendingSnapshot()
    }, 500)
  }, [flushPendingSnapshot])

  // Sync content with active draft
  const dirtyRef = useRef(false)
  const prevSelectionKeyRef = useRef('')
  useEffect(() => {
    const selectionKey = selection
      ? `p:${selection.chapterId}/${selection.paragraphId}`
      : editingAttachmentId
        ? `a:${editingAttachmentId}`
        : ''
    const selectionChanged = prevSelectionKeyRef.current !== selectionKey
    prevSelectionKeyRef.current = selectionKey
    targetKeyRef.current = selectionKey

    if (selectionChanged) {
      // 离开上一个编辑目标前，把尚未落盘的编辑写入本地存储
      flushPendingSnapshot()
      dirtyRef.current = false
      setDirty(false)
    } else if (dirtyRef.current) {
      return
    }

    if (selectionChanged && selection && draftsByParagraph[selection.paragraphId] === undefined) {
      setContent('')
      setContentLoading(true)
      return
    }

    const serverContent = editingAttachmentId
      ? currentAttachmentDraft?.content || ''
      : selection
        ? currentDraft?.content || ''
        : ''

    // 切到新目标时：若本地有未保存快照（误刷新/重进文档前的编辑），恢复它并标记未保存
    if (selectionChanged && selectionKey && docId) {
      const stored = getDraftSnapshot(docId, selectionKey)
      if (stored && stored.content !== serverContent) {
        setContent(stored.content)
        setDirty(true)
        dirtyRef.current = true
        setContentLoading(false)
        showToast(t('editor.draftRestored'))
        return
      }
    }

    setContent(serverContent)
    setContentLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDraft?.id, currentAttachmentDraft?.id, editingAttachmentId, selection, draftsByParagraph, draftsByAttachment])

  // Belt-and-braces: reload drafts for the selected paragraph on every switch
  useEffect(() => {
    if (!docId || !selection) return
    const targetKey = `p:${selection.chapterId}/${selection.paragraphId}`
    loadDrafts(docId, selection.chapterId, selection.paragraphId).catch(() => {
      // 只有当用户仍停留在该段落时才解锁（防止切段后旧请求失败竞态解锁新段落）
      if (prevSelectionKeyRef.current === targetKey) {
        setContentLoading(false)
        showErrorToast(t('error.loadFailed'))
      }
    })
  }, [docId, selection, loadDrafts])

  // Full text content (memoized)
  const fullTextContent = useMemo(() => {
    return chapters.map((ch) => {
      const paras = paragraphsByChapter[ch.id] || []
      const body = paras.map((p) => {
        const pDrafts = draftsByParagraph[p.id] || []
        return getCurrentDraft(pDrafts, p.currentDraftId)?.content || ''
      }).join('\n\n')
      return `# ${ch.title}\n\n${body || t('common.empty')}`
    }).join('\n\n')
  }, [chapters, paragraphsByChapter, draftsByParagraph])

  // Chapter preview content (memoized)
  const chapterPreviewContent = useMemo(() => {
    if (!viewingChapterId) return ''
    const paras = paragraphsByChapter[viewingChapterId] || []
    return paras.map((p) => {
      const pDrafts = draftsByParagraph[p.id] || []
      return getCurrentDraft(pDrafts, p.currentDraftId)?.content || ''
    }).join('\n\n')
  }, [viewingChapterId, paragraphsByChapter, draftsByParagraph])

  // Attachment context: 按模板顺序拼 [contextLabel]\ncontent（contextLabel 固定用 zh，与中文 prompts 一致）
  const attachmentsText = useMemo(() => {
    if (!template) return ''
    const parts: string[] = []
    for (const def of template.attachments) {
      const att = attachments[def.type]
      if (!att) continue
      const drafts = draftsByAttachment[def.type] || []
      const cur = getCurrentDraft(drafts, att.currentDraftId)
      if (!cur?.content) continue
      const label = typeof def.contextLabel === 'string' ? def.contextLabel : def.contextLabel.zh
      parts.push(`[${label}]\n${cur.content}`)
    }
    return parts.join('\n\n')
  }, [template, attachments, draftsByAttachment])

  // Review context (memoized)
  const reviewContext = useMemo(() => {
    if (viewingFullText) {
      const parts: string[] = []
      if (attachmentsText) parts.push(attachmentsText)
      parts.push(`[全文]\n${fullTextContent}`)
      return parts.join('\n\n---\n\n')
    }
    if (viewingChapterId) {
      const parts: string[] = []
      if (attachmentsText) parts.push(attachmentsText)
      parts.push(`[章节内容]\n${chapterPreviewContent}`)
      return parts.join('\n\n---\n\n')
    }
    if (selection) {
      const paras = paragraphsByChapter[selection.chapterId] || []
      const paraIdx = paras.findIndex((p) => p.id === selection.paragraphId)
      const prev = paras.slice(0, paraIdx)
      const prevText = prev.map((p) => {
        const pDrafts = draftsByParagraph[p.id] || []
        return getCurrentDraft(pDrafts, p.currentDraftId)?.content || ''
      }).join('\n\n')
      const parts: string[] = []
      if (attachmentsText) parts.push(attachmentsText)
      if (prevText) parts.push(`[前面段落]\n${prevText}`)
      parts.push(`[当前段落]\n${content}`)
      return parts.join('\n\n---\n\n')
    }
    return content
  }, [viewingFullText, viewingChapterId, selection, attachmentsText, fullTextContent, chapterPreviewContent, paragraphsByChapter, draftsByParagraph, content])

  // Save. Returns true on success; on failure shows a toast and returns
  // false so callers can branch (never throws — an uncaught rejection here
  // used to leave the user with zero feedback).
  const doSave = useCallback(async (): Promise<boolean> => {
    if (!docId || !dirty) return false
    const snapshot = contentRef.current
    setSaving(true)
    try {
      if (editingAttachmentId) await createAttachmentDraft(docId, editingAttachmentId, snapshot)
      else if (selection) await createDraft(docId, selection.chapterId, selection.paragraphId, snapshot)
      // 保存成功即清除本地未保存快照（内容已入服务端版本历史）
      if (targetKeyRef.current) clearDraftSnapshot(docId, targetKeyRef.current)
      // Only clear dirty if user hasn't typed more while saving
      if (contentRef.current === snapshot) {
        setDirty(false)
        dirtyRef.current = false
      }
      return true
    } catch (err) {
      console.error('[doSave] failed', err)
      showErrorToast(t('error.saveFailed'))
      return false
    } finally { setSaving(false) }
  }, [docId, dirty, editingAttachmentId, selection, createAttachmentDraft, createDraft])

  // Draft tab actions
  const handleDraftSelect = useCallback(async (draft: DraftItem) => {
    if (!docId) return
    const prevContent = contentRef.current
    setDirty(false)
    dirtyRef.current = false
    setContent(draft.content)
    try {
      if (editingAttachmentId && draft.id !== (currentAttachmentDraft?.id || '')) {
        await switchAttachmentDraft(docId, editingAttachmentId, draft.id)
      } else if (selection && draft.id !== (currentDraft?.id || '')) {
        await updateParagraphDraftId(docId, selection.chapterId, selection.paragraphId, draft.id)
      }
    } catch {
      // 回滚
      setContent(prevContent)
      setDirty(true)
      dirtyRef.current = true
    }
  }, [editingAttachmentId, docId, selection, currentDraft, currentAttachmentDraft, switchAttachmentDraft, updateParagraphDraftId])

  const handleDraftDelete = useCallback(async (draftId: string) => {
    if (!docId) return
    if (editingAttachmentId) await deleteAttachmentDraft(docId, editingAttachmentId, draftId)
    else if (selection) await deleteDraft(docId, selection.chapterId, selection.paragraphId, draftId)
    // Only clear dirty if we deleted the draft that was being edited (whose
    // content is currently in the editor). Deleting a historical draft should
    // not discard unsaved changes to the active one.
    const isCurrentDraft = editingAttachmentId
      ? draftId === currentAttachmentDraft?.id
      : draftId === currentDraft?.id
    if (isCurrentDraft) {
      setDirty(false)
      dirtyRef.current = false
    }
  }, [docId, editingAttachmentId, selection, deleteAttachmentDraft, deleteDraft, currentDraft, currentAttachmentDraft])

  const handleChange = useCallback((value: string) => {
    setContent(value)
    setDirty(true)
    dirtyRef.current = true
    // 编辑内容写入本地快照（防抖），误刷新后可恢复
    if (targetKeyRef.current) scheduleSnapshot(targetKeyRef.current, value)
  }, [scheduleSnapshot])

  // Display content
  const displayContent = viewingFullText ? fullTextContent : viewingChapterId ? chapterPreviewContent : content
  const activeDrafts: DraftItem[] = editingAttachmentId ? attachmentDrafts : drafts
  const activeCurrentDraftId = editingAttachmentId
    ? currentAttachmentDraft?.id || ''
    : currentDraft?.id || ''

  return {
    chapters, paragraphsByChapter, attachments, template,
    booting, contentLoading,
    content, saving, dirty, setDirty,
    currentDraft, currentAttachment, currentAttachmentDraft,
    fullTextContent, chapterPreviewContent, reviewContext,
    displayContent, activeDrafts, activeCurrentDraftId,
    doSave, handleDraftSelect, handleDraftDelete, handleChange,
  }
}
