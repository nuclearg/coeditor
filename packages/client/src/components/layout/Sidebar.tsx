import { View } from '@tarojs/components'
import { memo, useEffect, useMemo, useState, useRef } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useChapterStore, useParagraphStore, useParagraphDraftStore, useDocumentStore, useAttachmentStore } from '@/stores'
import { SlotHost } from '@/plugin/SlotHost'
import { charCount, cn, getCurrentDraft, isH5 } from '@/lib/utils'
import { useT, localize } from '@/lib/i18n'
import { showErrorToast } from '@/lib/toast'
import type { Document, DocumentTemplate, Attachment, AttachmentDef } from '@coeditor/shared'

interface SidebarProps {
  docId: string
  doc: Document | null
  template: DocumentTemplate | null
  open: boolean
  selectedParagraphId: string | null
  viewingChapterId: string | null
  viewingFullText: boolean
  editingAttachmentId: string | null
  onSelectParagraph: (chapterId: string, paragraphId: string) => void
  onSelectChapter: (chapterId: string) => void
  onSelectAttachment: (type: string) => void
  onSelectFullText: () => void
}

/**
 * 附件展示名：
 * - 模板默认名集合 = [type, name.zh, name.en]（含旧数据 ensure 时可能存的 type/zh 名）
 * - 名称不在集合内（用户显式重命名过）→ 显示重命名值
 * - 否则按当前语言显示模板本地化名
 */
function attachmentDisplayName(def: AttachmentDef, att: Attachment | undefined): string {
  if (att?.name) {
    const defaults = new Set([
      def.type,
      typeof def.name === 'string' ? def.name : def.name.zh,
      typeof def.name === 'string' ? def.name : def.name.en,
    ])
    if (!defaults.has(att.name)) return att.name
  }
  return typeof def.name === 'string' ? def.name : localize(def.name)
}

/** H5 端图标缩小（web 尺寸），小程序保持移动尺寸 */
const iconSize = (size: number) => (isH5() ? Math.max(14, Math.round(size * 0.6)) : size)

export const Sidebar = memo(function Sidebar({
  docId,
  doc,
  template,
  open,
  selectedParagraphId,
  viewingChapterId,
  viewingFullText,
  editingAttachmentId,
  onSelectParagraph,
  onSelectChapter,
  onSelectAttachment,
  onSelectFullText,
}: SidebarProps) {
  const { chapters, createChapter, deleteChapter, updateChapter, reorderChapters } = useChapterStore()
  const { paragraphsByChapter, loadParagraphs, createParagraph, deleteParagraph, updateParagraphName, reorderParagraphs } = useParagraphStore()
  const { draftsByParagraph, loadDrafts } = useParagraphDraftStore()
  const { updateDocument } = useDocumentStore()
  const { attachments, draftsByAttachment } = useAttachmentStore()
  // 订阅语言：附件本地化名随语言切换即时更新
  const t = useT()

  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  const [newChapterTitle, setNewChapterTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')

  // Inline rename state
  const [renamingChapterId, setRenamingChapterId] = useState<string | null>(null)
  const [chapterRenameValue, setChapterRenameValue] = useState('')
  const [renamingParaId, setRenamingParaId] = useState<string | null>(null)
  const [paraRenameValue, setParaRenameValue] = useState('')
  // 整个作品行的操作菜单开关
  const [titleMenuOpen, setTitleMenuOpen] = useState(false)

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'chapter'; chapterId: string; name: string }
    | { kind: 'paragraph'; chapterId: string; paragraphId: string; name: string }
    | null
  >(null)

  // In-flight guards
  const [creatingChapter, setCreatingChapter] = useState(false)
  const creatingParagraphRef = useRef(false)
  const deletingRef = useRef(false)
  // 新建段落（与新建章节同款交互）：标题 + 输入框归属的章节
  const [newParagraphTitle, setNewParagraphTitle] = useState('')
  // 新建章节/段落：默认只显示"＋ xxx..."文本，点击后展开输入框，失焦恢复
  const [addingChapter, setAddingChapter] = useState(false)
  const [addingParagraphChapterId, setAddingParagraphChapterId] = useState<string | null>(null)

  // Floating action menu per row
  const [menuFor, setMenuFor] = useState<
    | { kind: 'chapter'; id: string }
    | { kind: 'paragraph'; chapterId: string; id: string }
    | null
  >(null)

  // Close the menu when switching documents
  useEffect(() => {
    setMenuFor(null)
  }, [docId])

  const confirmDeleteNow = async () => {
    if (!confirmDelete || deletingRef.current) return
    deletingRef.current = true
    try {
      if (confirmDelete.kind === 'chapter') {
        await deleteChapter(docId, confirmDelete.chapterId)
      } else {
        await deleteParagraph(docId, confirmDelete.chapterId, confirmDelete.paragraphId)
      }
      setConfirmDelete(null)
    } finally {
      deletingRef.current = false
    }
  }

  // Only load paragraphs for newly added chapters
  const prevChapterIdsRef = useRef<string[]>([])
  useEffect(() => {
    const currentIds = chapters.map((ch) => ch.id)
    const newIds = currentIds.filter((id) => !prevChapterIdsRef.current.includes(id))
    prevChapterIdsRef.current = currentIds
    if (newIds.length > 0 || (currentIds.length > 0 && Object.keys(paragraphsByChapter).length === 0)) {
      const idsToLoad = newIds.length > 0 ? newIds : currentIds
      idsToLoad.forEach((id) => loadParagraphs(docId, id).catch(() => {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters.length, docId])

  // Load drafts for paragraphs so the sidebar can show 字数。
  // draftsByParagraph 故意不作为依赖：否则每次草稿到达都会触发重新加载循环。
  useEffect(() => {
    const pending: Array<{ chapterId: string; paragraphId: string }> = []
    for (const [chapterId, paras] of Object.entries(paragraphsByChapter)) {
      for (const p of paras) {
        if (!draftsByParagraph[p.id]) pending.push({ chapterId, paragraphId: p.id })
      }
    }
    if (pending.length > 0) {
      pending.forEach(({ chapterId, paragraphId }) => loadDrafts(docId, chapterId, paragraphId).catch(() => {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, paragraphsByChapter, loadDrafts])

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(chapterId)) {
        next.delete(chapterId)
      } else {
        next.add(chapterId)
      }
      return next
    })
  }

  const handleCreateChapter = async () => {
    if (!newChapterTitle.trim() || creatingChapter) return
    setCreatingChapter(true)
    try {
      await createChapter(docId, newChapterTitle.trim())
      setNewChapterTitle('')
      setAddingChapter(false)
    } finally {
      setCreatingChapter(false)
    }
  }

  const handleCreateParagraph = async (chapterId: string) => {
    const title = addingParagraphChapterId === chapterId ? newParagraphTitle : ''
    if (creatingParagraphRef.current || !title.trim()) return
    creatingParagraphRef.current = true
    try {
      await createParagraph(docId, chapterId, title.trim())
      if (addingParagraphChapterId === chapterId) {
        setNewParagraphTitle('')
        setAddingParagraphChapterId(null)
      }
    } finally {
      creatingParagraphRef.current = false
    }
  }

  const handleTitleEdit = () => {
    setTitleValue(doc?.title || '')
    setEditingTitle(true)
  }

  const handleTitleSave = async () => {
    try {
      if (titleValue.trim() && doc) {
        await updateDocument(doc.id, { title: titleValue.trim() })
      }
    } catch {
      showErrorToast(t('error.saveFailed'))
    }
    setEditingTitle(false)
  }

  const startChapterRename = (chId: string, name: string) => {
    setRenamingChapterId(chId)
    setChapterRenameValue(name)
  }

  const saveChapterRename = async (chId: string) => {
    try {
      if (chapterRenameValue.trim()) {
        await updateChapter(docId, chId, { title: chapterRenameValue.trim() })
      }
    } catch {
      showErrorToast(t('error.saveFailed'))
    }
    setRenamingChapterId(null)
  }

  const startParaRename = (pId: string, name: string) => {
    setRenamingParaId(pId)
    setParaRenameValue(name || '')
  }

  const saveParaRename = async (chId: string, pId: string) => {
    try {
      if (paraRenameValue.trim()) {
        await updateParagraphName(docId, chId, pId, paraRenameValue.trim())
      }
    } catch {
      showErrorToast(t('error.saveFailed'))
    }
    setRenamingParaId(null)
  }

  // === Move handlers ===
  const moveChapter = (index: number, direction: -1 | 1) => {
    const order = chapters.map((c) => c.id)
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= order.length) return
    const tmp = order[index]
    order[index] = order[newIndex]
    order[newIndex] = tmp
    reorderChapters(docId, order)
  }

  const moveParagraph = (chapterId: string, index: number, direction: -1 | 1) => {
    const paras = paragraphsByChapter[chapterId] || []
    const order = paras.map((p) => p.id)
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= order.length) return
    const tmp = order[index]
    order[index] = order[newIndex]
    order[newIndex] = tmp
    reorderParagraphs(docId, chapterId, order)
  }

  // Word-count stats for the whole book and per chapter.
  // Memoized on the store slices so the (regex-heavy) charCount scans don't
  // run twice per render on every keystroke.
  // B8: a paragraph is "loaded" when its drafts key EXISTS in
  // draftsByParagraph — loadDrafts writes [] for zero-draft paragraphs, and
  // requiring length > 0 used to hide ALL counts whenever one empty
  // paragraph existed.
  const chapterStats = useMemo(() => {
    const byChapter: Record<string, { loaded: boolean; count: number }> = {}
    let allLoaded = true
    let total = 0
    for (const ch of chapters) {
      const paras = paragraphsByChapter[ch.id] || []
      let loaded = true
      let count = 0
      for (const p of paras) {
        const paraDrafts = draftsByParagraph[p.id]
        if (paraDrafts === undefined) loaded = false
        const cur = getCurrentDraft(paraDrafts || [], p.currentDraftId)
        if (cur) count += charCount(cur.content)
      }
      byChapter[ch.id] = { loaded, count }
      if (!loaded) allLoaded = false
      total += count
    }
    return { byChapter, allLoaded, total }
  }, [chapters, paragraphsByChapter, draftsByParagraph])
  const allParasLoaded = chapterStats.allLoaded
  const fullTextCount = chapterStats.total

  if (!open) return null

  // === sidebar-top 插槽的默认实现（renderTitle / renderAttachments / renderFulltextEntry 积木） ===
  const renderTitle = () => (
    editingTitle ? (
      <View className="flex items-center gap-1">
        <Input
          className="text-sm font-semibold"
          value={titleValue}
          focus
          onChange={setTitleValue}
          onEnter={handleTitleSave}
          onBlur={handleTitleSave}
        />
        <Button variant="ghost" size="icon" onClick={handleTitleSave}>
          <Icon name="save" size={iconSize(28)} />
        </Button>
      </View>
    ) : (
      <View className="flex items-center gap-1">
        <Icon name="outline" size={iconSize(30)} color="var(--muted-fg)" />
        <View className="flex-1 font-semibold text-sm truncate">{doc?.title || t('common.untitled')}</View>
        <View className="relative">
          <View
            className="hover-accent"
            style={{ padding: isH5() ? 3 : 6, display: 'flex' }}
            onClick={(e) => {
              e.stopPropagation()
              setTitleMenuOpen((v) => !v)
            }}
          >
            <Icon name="more" size={iconSize(24)} color="var(--muted-fg)" />
          </View>
          {titleMenuOpen && (
            <RowMenu
              items={[
                { label: t('sidebar.rename'), icon: 'edit', onClick: () => { setTitleMenuOpen(false); handleTitleEdit() } },
              ]}
              onClose={() => setTitleMenuOpen(false)}
            />
          )}
        </View>
      </View>
    )
  )

  const renderAttachments = () => (
    <>
      {template?.attachments.map((def) => {
        const att = attachments[def.type]
        const attDrafts = draftsByAttachment[def.type] || []
        const cur = att ? getCurrentDraft(attDrafts, att.currentDraftId) : undefined
        return (
          <View
            key={def.type}
            className={cn('flex items-center gap-2 px-1 py-1 text-sm rounded', editingAttachmentId === def.type && 'bg-accent')}
            style={{ marginTop: 4 }}
            onClick={() => onSelectAttachment(def.type)}
          >
            <Icon name="file" size={iconSize(28)} color="var(--muted-fg)" />
            <View className="flex-1 truncate">{attachmentDisplayName(def, att)}</View>
            {cur && (
              <View className="shrink-0 text-muted tabular-nums" style={{ fontSize: isH5() ? 12 : 20 }}>{t('sidebar.wordCount', { n: charCount(cur.content) })}</View>
            )}
          </View>
        )
      })}
    </>
  )

  const renderFulltextEntry = () => (
    <View
      className={cn('flex items-center gap-2 px-1 py-1 text-sm rounded', viewingFullText && 'bg-accent')}
      style={{ marginTop: 4 }}
      onClick={onSelectFullText}
    >
      <Icon name="book" size={iconSize(28)} color="var(--muted-fg)" />
      <View className="flex-1 truncate">{t('sidebar.fulltext')}</View>
      {allParasLoaded && (
        <View className="shrink-0 text-muted tabular-nums" style={{ fontSize: isH5() ? 12 : 20 }}>{t('sidebar.fulltextCount', { n: fullTextCount })}</View>
      )}
    </View>
  )

  return (
    <View className="flex flex-col shrink-0 h-full" style={{ width: isH5() ? 260 : 420, borderRight: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
      <View className="overflow-y-auto flex-1">
        {/* ========== 文档标题（sidebar-top 插槽） ========== */}
        <View style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <SlotHost
            slot="sidebar-top"
            ctx={{ docId, doc, template, renderTitle, renderAttachments, renderFulltextEntry }}
            defaults={<>{renderTitle()}{renderFulltextEntry()}{renderAttachments()}</>}
          />
        </View>

        {/* ========== 章节区 ========== */}
        <View style={{ padding: 16 }}>
          <View className="flex items-center gap-2 px-2 py-1 mb-1">
            <Icon name="outline" size={iconSize(28)} color="var(--muted-fg)" />
            <View className="text-xs font-semibold text-muted" style={{ letterSpacing: 2 }}>{t('sidebar.chapters')}</View>
          </View>

          <View>
            {chapters.map((chapter, chIndex) => {
              const paragraphs = paragraphsByChapter[chapter.id] || []
              const isExpanded = expandedChapters.has(chapter.id)
              const isChapRenaming = renamingChapterId === chapter.id
              const stats = chapterStats.byChapter[chapter.id] || { loaded: false, count: 0 }
              const allDraftsLoaded = stats.loaded
              const chapterCount = stats.count

              return (
                <View key={chapter.id}>
                  {/* Chapter row */}
                  <View className={cn('relative flex items-center gap-1 px-1 py-1 text-sm rounded', viewingChapterId === chapter.id && 'bg-accent')}>
                    <View className="hover-accent rounded" style={{ padding: 4 }} onClick={() => toggleChapter(chapter.id)}>
                      <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={iconSize(26)} color="var(--muted-fg)" />
                    </View>

                    {isChapRenaming ? (
                      <Input
                        className="flex-1"
                        value={chapterRenameValue}
                        focus
                        onChange={setChapterRenameValue}
                        onEnter={() => saveChapterRename(chapter.id)}
                        onBlur={() => saveChapterRename(chapter.id)}
                      />
                    ) : (
                      <View
                        className="flex-1 min-w-0 text-left truncate font-medium"
                        onClick={() => {
                          toggleChapter(chapter.id)
                          onSelectChapter(chapter.id)
                        }}
                      >
                        {chapter.title}
                      </View>
                    )}

                    {!isChapRenaming && (
                      <>
                        {allDraftsLoaded && (
                          <View className="shrink-0 text-muted tabular-nums" style={{ fontSize: isH5() ? 12 : 20 }}>{t("sidebar.wordCount", { n: chapterCount })}</View>
                        )}
                        <View
                          className="shrink-0 hover-accent rounded"
                          style={{ padding: isH5() ? 3 : 6 }}
                          onClick={() => setMenuFor(
                            menuFor?.kind === 'chapter' && menuFor.id === chapter.id ? null : { kind: 'chapter', id: chapter.id },
                          )}
                        >
                          <Icon name="more" size={iconSize(26)} color="var(--muted-fg)" />
                        </View>
                        {menuFor?.kind === 'chapter' && menuFor.id === chapter.id && (
                          <RowMenu
                            items={[
                              { label: t("sidebar.moveUp"), icon: "up", disabled: chIndex === 0, onClick: () => { moveChapter(chIndex, -1); setMenuFor(null) } },
                              { label: t("sidebar.moveDown"), icon: "down", disabled: chIndex === chapters.length - 1, onClick: () => { moveChapter(chIndex, 1); setMenuFor(null) } },
                              { label: t("sidebar.rename"), icon: "edit", onClick: () => { startChapterRename(chapter.id, chapter.title); setMenuFor(null) } },
                              { sep: true },
                              { label: t("sidebar.deleteChapter"), icon: "trash", danger: true, onClick: () => { setMenuFor(null); setConfirmDelete({ kind: 'chapter', chapterId: chapter.id, name: chapter.title }) } },
                            ]}
                            onClose={() => setMenuFor(null)}
                          />
                        )}
                      </>
                    )}
                  </View>

                  {/* Paragraphs */}
                  {isExpanded && (
                    <View style={{ marginLeft: 40 }}>
                      {paragraphs.map((para, pIndex) => {
                        const isRenaming = renamingParaId === para.id
                        const paraDrafts = draftsByParagraph[para.id] || []
                        const curDraft = getCurrentDraft(paraDrafts, para.currentDraftId)
                        const charCountNum = curDraft ? charCount(curDraft.content) : 0
                        return (
                          <View key={para.id} className={cn('relative flex items-center gap-1 px-1 py-1 text-sm rounded', selectedParagraphId === para.id && 'bg-accent')}>
                            {isRenaming ? (
                              <Input
                                className="flex-1"
                                value={paraRenameValue}
                                focus
                                onChange={setParaRenameValue}
                                onEnter={() => saveParaRename(chapter.id, para.id)}
                                onBlur={() => saveParaRename(chapter.id, para.id)}
                              />
                            ) : (
                              <View className="flex-1 min-w-0 text-left truncate" onClick={() => onSelectParagraph(chapter.id, para.id)}>
                                {para.name || t("sidebar.paragraphN", { n: pIndex + 1 })}
                              </View>
                            )}

                            {!isRenaming && (
                              <>
                                {paraDrafts.length > 0 && (
                                  <View className="shrink-0 text-muted tabular-nums" style={{ fontSize: isH5() ? 12 : 20 }}>{t("sidebar.wordCount", { n: charCountNum })}</View>
                                )}
                                <View
                                  className="shrink-0 hover-accent rounded"
                                  style={{ padding: isH5() ? 3 : 6 }}
                                  onClick={() => setMenuFor(
                                    menuFor?.kind === 'paragraph' && menuFor.id === para.id ? null : { kind: 'paragraph', chapterId: chapter.id, id: para.id },
                                  )}
                                >
                                  <Icon name="more" size={iconSize(26)} color="var(--muted-fg)" />
                                </View>
                                {menuFor?.kind === 'paragraph' && menuFor.id === para.id && (
                                  <RowMenu
                                    items={[
                                      { label: t("sidebar.moveUp"), icon: "up", disabled: pIndex === 0, onClick: () => { moveParagraph(chapter.id, pIndex, -1); setMenuFor(null) } },
                                      { label: t("sidebar.moveDown"), icon: "down", disabled: pIndex === paragraphs.length - 1, onClick: () => { moveParagraph(chapter.id, pIndex, 1); setMenuFor(null) } },
                                      { label: t("sidebar.rename"), icon: "edit", onClick: () => { startParaRename(para.id, para.name || ''); setMenuFor(null) } },
                                      { sep: true },
                                      { label: t("common.delete"), icon: "trash", danger: true, onClick: () => { setMenuFor(null); setConfirmDelete({ kind: 'paragraph', chapterId: chapter.id, paragraphId: para.id, name: para.name || t("sidebar.paragraphN", { n: pIndex + 1 }) }) } },
                                    ]}
                                    onClose={() => setMenuFor(null)}
                                  />
                                )}
                              </>
                            )}
                          </View>
                        )
                      })}
                      {addingParagraphChapterId === chapter.id ? (
                        <View className="flex items-center gap-1 px-1 mt-2">
                          <Input
                            className="text-sm"
                            placeholder={t('sidebar.newParagraph')}
                            value={newParagraphTitle}
                            focus
                            onChange={setNewParagraphTitle}
                            onEnter={() => handleCreateParagraph(chapter.id)}
                            onBlur={() => {
                              // 延迟关闭：小程序端 blur 先于 click 触发，若同步关闭会
                              // 卸载＋按钮导致 click 丢失；延迟让 click 先执行。
                              // 函数式校验：仅当仍是本行输入框时才关闭，避免跨行
                              // 竞争误关刚打开的其他行。
                              const cid = chapter.id
                              setTimeout(() => {
                                setAddingParagraphChapterId((prev) => (prev === cid ? null : prev))
                              }, 150)
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleCreateParagraph(chapter.id)}
                            disabled={creatingParagraphRef.current || !newParagraphTitle.trim()}
                          >
                            <Icon name="plus" size={iconSize(30)} />
                          </Button>
                        </View>
                      ) : (
                        <View
                          className="flex items-center gap-1 px-1 py-1 mt-2 text-xs text-muted rounded hover-accent"
                          onClick={() => { setNewParagraphTitle(''); setAddingParagraphChapterId(chapter.id) }}
                        >
                          <View>{`+ ${t('sidebar.newParagraph')}`}</View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )
            })}
          </View>

          {addingChapter ? (
            <View className="flex items-center gap-1 px-1 mt-2">
              <Input
                className="text-sm"
                placeholder={t("sidebar.newChapter")}
                value={newChapterTitle}
                focus
                onChange={setNewChapterTitle}
                onEnter={handleCreateChapter}
                onBlur={() => {
                  setTimeout(() => {
                    setAddingChapter(false)
                    setNewChapterTitle('')
                  }, 150)
                }}
              />
              <Button variant="ghost" size="icon" onMouseDown={(e) => e.preventDefault()} onClick={handleCreateChapter} disabled={creatingChapter || !newChapterTitle.trim()}>
                <Icon name="plus" size={iconSize(30)} />
              </Button>
            </View>
          ) : (
            <View
              className="flex items-center gap-1 px-1 py-1 mt-2 text-xs text-muted rounded hover-accent"
              onClick={() => { setNewChapterTitle(''); setAddingChapter(true) }}
            >
              <View>{`+ ${t('sidebar.newChapter')}`}</View>
            </View>
          )}
        </View>

        {/* sidebar-bottom 插槽（默认无内容） */}
        <View style={{ padding: 16 }}>
          <SlotHost slot="sidebar-bottom" ctx={{ docId }} />
        </View>
      </View>

      <Dialog
        open={confirmDelete !== null}
        title={t("common.delete")}
        onClose={() => setConfirmDelete(null)}
      >
        <View className="text-sm text-muted">
          {confirmDelete?.kind === 'chapter'
            ? t('sidebar.deleteChapterConfirm', { name: confirmDelete.name })
            : t('sidebar.deleteParagraphConfirm', { name: confirmDelete?.name ?? '' })}
        </View>
        <View className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</Button>
          <Button variant="destructive" size="sm" onClick={confirmDeleteNow}>{t('common.delete')}</Button>
        </View>
      </Dialog>
    </View>
  )
})

interface RowMenuProps {
  items: Array<{ label?: string; icon?: string; disabled?: boolean; danger?: boolean; sep?: boolean; onClick?: () => void }>
  onClose: () => void
}

/** 行操作浮层：透明遮罩 + 面板 */
function RowMenu({ items, onClose }: RowMenuProps) {
  return (
    <>
      <View style={{ position: 'fixed', inset: 0, zIndex: 700 }} onClick={onClose} />
      <View className="menu-panel" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 701, minWidth: 140 }}>
        {items.map((item, i) => {
          if (item.sep) return <View key={i} className="menu-sep" />
          return (
            <View
              key={i}
              className={cn('menu-item', item.danger && 'text-destructive')}
              style={{ opacity: item.disabled ? 0.3 : 1 }}
              onClick={() => { if (!item.disabled) item.onClick?.() }}
            >
              {item.icon && <Icon name={item.icon} size={iconSize(24)} />}
              <View>{item.label}</View>
            </View>
          )
        })}
      </View>
    </>
  )
}
