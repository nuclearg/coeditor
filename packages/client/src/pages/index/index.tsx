import { Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { LayoutShell } from '@/plugin/LayoutShell'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { Markdown } from '@/components/markdown/Markdown'
import { useDocumentStore, useLayoutStore, useAttachmentStore } from '@/stores'
import { bus } from '@/plugin/bus'
import { t, localize } from '@/lib/i18n'
import { cn, isH5 } from '@/lib/utils'
import { useI18nStore } from '@/stores/i18nStore'
import { api } from '@/api/client'
import type { Document, DocumentTemplate, LocalizedText } from '@coeditor/shared'

/** 导入文本上限（字符）：与服务端一致，超限前端先拦 */
const MAX_IMPORT_CHARS = 100_000

export default function DocumentListPage() {
  const { documents, loading, loadDocuments, createDocument, deleteDocument, updateDocument } = useDocumentStore()
  const templates = useAttachmentStore((s) => s.templates)
  const loadTemplates = useAttachmentStore((s) => s.loadTemplates)
  const language = useI18nStore((s) => s.language)
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('') // 默认未选中模板
  const [templateOpen, setTemplateOpen] = useState(false) // 自绘下拉面板（双端一致，PC 上不用 wxapp 底部弹层）
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  // 导出单篇文档（H5）
  const [exportingDoc, setExportingDoc] = useState<string | null>(null)
  // 导入文字：弹层 textarea（粘贴/手输文本 → AI 分章）
  const [textImportOpen, setTextImportOpen] = useState(false)
  const [textContent, setTextContent] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null)
  // 文档卡片 ⋯ 下拉菜单（当前打开菜单的文档）
  const [menuDoc, setMenuDoc] = useState<Document | null>(null)
  // 重命名弹窗
  const [renameTarget, setRenameTarget] = useState<Document | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadDocuments().catch(() => {})
    loadTemplates().catch(() => {})
  }, [loadDocuments, loadTemplates])

  // SaaS 登录门场景：未登录进入首页时首次加载被 401 拦截（PluginHandled 静默），
  // 登录成功后页面不重新 mount、本 effect 不会重跑 → 文档/模板列表保持空。
  // 监听插件 bus 的 auth:changed（auth 插件登录成功时 emit authed=true）触发重载。
  useEffect(() => {
    return bus.on<{ authed: boolean }>('auth:changed', ({ authed }) => {
      if (!authed) return
      loadDocuments().catch(() => {})
      loadTemplates().catch(() => {})
    })
  }, [loadDocuments, loadTemplates])

  const selectedTemplate: DocumentTemplate | null =
    templates.find((x) => x.id === templateId) || null

  const templateName = (tpl: DocumentTemplate): string => localize(tpl.name)

  /** 本地化模板字段（后端统一为 LocalizedText 对象） */
  const tplField = (value: LocalizedText | null | undefined): string => localize(value)

  /** 下拉框选项文本：名称 - 一句话简介 */
  const templateOptionLabel = (tpl: DocumentTemplate): string => {
    const desc = tplField(tpl.desc)
    return desc ? `${templateName(tpl)} - ${desc}` : templateName(tpl)
  }

  const tplDesc = selectedTemplate ? tplField(selectedTemplate.desc) : ''
  const tplSummary = selectedTemplate ? tplField(selectedTemplate.summary) : ''

  const handleCreate = async () => {
    if (!title.trim() || !selectedTemplate) return
    setCreating(true)
    try {
      const doc = await createDocument(title.trim(), selectedTemplate.id)
      setTitle('')
      setTemplateId('')
      Taro.navigateTo({ url: `/pages/edit/index?docId=${doc.id}` })
    } catch (err) {
      console.error('[createDocument]', err)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDocument(deleteTarget.id)
    } catch (err) {
      console.error('[deleteDocument]', err)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  /** 重命名文档标题：documents.update（store 就地更新列表） */
  const handleRename = async () => {
    if (!renameTarget || !renameTitle.trim()) return
    try {
      await updateDocument(renameTarget.id, { title: renameTitle.trim() })
      setRenameTarget(null)
    } catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : t('common.renameFailed'), icon: 'none' })
    }
  }

  /** 提交导入（文件/文字共用）：服务端 AI 分章 → 跳转新文档 */
  const submitImport = async (docTitle: string, content: string) => {
    setImporting(true)
    try {
      const doc = await api.rpc<Document>('documents.importText', {
        title: docTitle,
        templateId: selectedTemplate?.id,
        content,
      })
      Taro.navigateTo({ url: `/pages/edit/index?docId=${doc.id}` })
    } catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : t('home.importFailed'), icon: 'none' })
    } finally {
      setImporting(false)
    }
  }

  /**
   * 导入文件（H5/桌面端）：文件选择 → 读文本 → AI 分章 → 跳转新文档。
   * 小程序端无文件选择能力，入口仅 H5 渲染。
   */
  const handleImport = () => {
    if (importing || !isH5()) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,.md,text/plain,text/markdown'
    // 必须挂到 DOM：游离节点在部分环境（headless/部分 WebView）下 click() 不触发文件选择
    document.body.appendChild(input)
    input.onchange = () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      void (async () => {
        const text = await file.text().catch(() => '')
        if (text.length === 0) {
          Taro.showToast({ title: t('home.importFailed'), icon: 'none' })
          return
        }
        if (text.length > MAX_IMPORT_CHARS) {
          Taro.showToast({ title: t('home.importTooLarge'), icon: 'none' })
          return
        }
        await submitImport(file.name.replace(/\.(txt|md)$/i, ''), text)
      })()
    }
    input.click()
  }

  /** 导入文字：粘贴/手输 → 校验 → AI 分章。标题优先用创建区已填标题，否则取文本首行。 */
  const handleTextImport = async () => {
    if (importing || !isH5()) return
    const text = textContent.trim()
    if (!text) return
    if (text.length > MAX_IMPORT_CHARS) {
      Taro.showToast({ title: t('home.importTooLarge'), icon: 'none' })
      return
    }
    setTextImportOpen(false)
    setTextContent('')
    const firstLine = text.split('\n')[0].trim().slice(0, 50)
    await submitImport(title.trim() || firstLine || t('home.importDefaultTitle'), text)
  }

  // 首页面包屑 = 品牌名（main.head.left 默认实现渲染）
  const setBreadcrumb = useLayoutStore((s) => s.setBreadcrumb)
  useEffect(() => {
    setBreadcrumb(t('brand.name'))
    return () => setBreadcrumb('')
  }, [setBreadcrumb, t])

  // 导出单篇文档为 markdown（H5）：POST documents.export → blob → a.download。
  // 文件名优先取响应头 Content-Disposition，否则用文档标题。
  const exportDoc = async (doc: Document) => {
    if (exportingDoc === doc.id || !isH5()) return
    setExportingDoc(doc.id)
    try {
      const res = await fetch(`${API_BASE_URL}/api/documents.export`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Language': language,
        },
        body: JSON.stringify({ docId: doc.id }),
      })
      const contentType = res.headers.get('Content-Type') || ''
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => null)
        throw new Error((err && err.error) || t('home.exportFailed'))
      }
      const blob = await res.blob()
      const m = (res.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/i)
      const name = m ? decodeURIComponent(m[1]) : `${doc.title || 'document'}.md`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : t('home.exportFailed'), icon: 'none' })
    } finally {
      setExportingDoc(null)
    }
  }

  // 文档卡片的元信息：模板名 · 更新时间（documents.list 已按时间倒序返回）
  const docMeta = (doc: Document): string => {
    const tpl = templates.find((x) => x.id === doc.templateId)
    const tplName = tpl ? templateName(tpl) : ''
    const date = new Date(doc.timeUpdated || doc.timeCreated).toLocaleDateString(
      language === 'zh' ? 'zh-CN' : 'en-US',
    )
    return [tplName, t('home.timeUpdated', { date })].filter(Boolean).join(' · ')
  }

  return (
    <LayoutShell
      variant="home"
      content={
        <View className="home-page">
          {/* ===== 上栏：创建作品 ===== */}
          <View className="create-card">
            <View className="create-card-title">{t('home.createWorks')}</View>

            {/* 行1：模板下拉（默认未选中，自绘面板替代 wxapp 底部弹层） */}
            <View className="mt-2">
              <View className="template-picker-wrap">
                <View
                  className={cn('input template-picker', !selectedTemplate && 'placeholder')}
                  onClick={() => setTemplateOpen((v) => !v)}
                >
                  <View className="truncate">
                    {selectedTemplate ? templateOptionLabel(selectedTemplate) : t('home.templatePlaceholder')}
                  </View>
                  <Icon name="chevronDown" size={isH5() ? 18 : 22} color="var(--muted-fg)" />
                </View>

                {templateOpen && (
                  <>
                    {/* 点击外部关闭（跨端一致的遮罩层） */}
                    <View
                      style={{ position: 'fixed', inset: 0, zIndex: 790 }}
                      onClick={() => setTemplateOpen(false)}
                    />
                    <View className="template-options">
                      {templates.length === 0 ? (
                        <View className="template-option muted">{t('common.empty')}</View>
                      ) : (
                        templates.map((tpl) => (
                          <View
                            key={tpl.id}
                            className={cn('template-option', tpl.id === templateId && 'checked')}
                            onClick={() => {
                              setTemplateId(tpl.id)
                              setTemplateOpen(false)
                            }}
                          >
                            <View className="flex-1 truncate">{templateOptionLabel(tpl)}</View>
                            {tpl.id === templateId && (
                              <Icon name="save" size={isH5() ? 14 : 22} color="var(--accent-warm)" />
                            )}
                          </View>
                        ))
                      )}
                    </View>
                  </>
                )}
              </View>
            </View>

            {/* 行2：模板介绍（desc 一句话 + summary markdown 详解各附件作用） */}
            {selectedTemplate && (tplDesc || tplSummary) && (
              <View className="template-desc">
                {tplDesc && <View className="template-desc-line">{tplDesc}</View>}
                {tplSummary && <Markdown content={tplSummary} />}
              </View>
            )}

            {/* 行3：标题 + 创建 + 导入文字（粘贴弹层） + 导入文件（H5 文件选择） */}
            <View className="flex gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
              <View className="flex-1" style={{ minWidth: 160 }}>
                <Input
                  placeholder={t('doc.newTitle')}
                  value={title}
                  onChange={setTitle}
                  onEnter={handleCreate}
                />
              </View>
              <Button
                onClick={handleCreate}
                disabled={creating || !title.trim() || !selectedTemplate}
              >
                {t('doc.create')}
              </Button>
              {isH5() && (
                <>
                  <Button variant="outline" onClick={() => setTextImportOpen(true)} disabled={importing}>
                    {importing ? t('home.importing') : t('home.importText')}
                  </Button>
                  <Button variant="outline" onClick={handleImport} disabled={importing}>
                    {t('home.importFile')}
                  </Button>
                </>
              )}
            </View>
          </View>

          {/* ===== 下栏：全部作品（时间倒序） ===== */}
          <View className="works-card">
            <View className="flex items-center justify-between">
              <View className="works-card-title">{t('home.allWorks')}</View>
              {!loading && documents.length > 0 && (
                <View className="home-count">{t('home.count', { n: documents.length })}</View>
              )}
            </View>

            <View className="doc-list">
              {loading ? (
                <View className="doc-loading">
                  <View className="spinner" />
                </View>
              ) : documents.length === 0 ? (
                <View className="empty-state">
                  <View className="empty-icon">
                    <Icon name="book" size={isH5() ? 40 : 72} color="var(--muted-fg)" />
                  </View>
                  <View className="empty-text">{t('doc.emptyHint')}</View>
                </View>
              ) : (
                documents.map((doc) => (
                  <View
                    key={doc.id}
                    className="doc-card"
                    onClick={() => Taro.navigateTo({ url: `/pages/edit/index?docId=${doc.id}` })}
                  >
                    <View className="doc-icon">
                      <Icon name="book" size={isH5() ? 18 : 30} color="var(--accent-warm)" />
                    </View>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <View className="doc-title truncate">{doc.title}</View>
                      <View className="doc-meta truncate">{docMeta(doc)}</View>
                      {doc.description ? (
                        <View className="doc-desc truncate">{doc.description}</View>
                      ) : null}
                    </View>
                    {/* 操作：⋯ 下拉菜单（导出/删除）——不直接暴露图标按钮，避免误解 */}
                    <View style={{ position: 'relative', flexShrink: 0 }}>
                      <View
                        className="doc-more"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuDoc(menuDoc?.id === doc.id ? null : doc)
                        }}
                      >
                        <Icon name="more" size={isH5() ? 16 : 26} color="var(--muted-fg)" />
                      </View>
                      {menuDoc?.id === doc.id && (
                        <>
                          {/* 点击外部关闭 */}
                          <View
                            className="doc-menu-mask"
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuDoc(null)
                            }}
                          />
                          <View className="doc-menu">
                            <View
                              className="doc-menu-item"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMenuDoc(null)
                                setRenameTarget(doc)
                                setRenameTitle(doc.title)
                              }}
                            >
                              {t('common.rename')}
                            </View>
                            {isH5() && (
                              <View
                                className="doc-menu-item"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMenuDoc(null)
                                  void exportDoc(doc)
                                }}
                              >
                                {t('common.export')}
                              </View>
                            )}
                            <View
                              className="doc-menu-item danger"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMenuDoc(null)
                                setDeleteTarget(doc)
                              }}
                            >
                              {t('common.delete')}
                            </View>
                          </View>
                        </>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>
      }
      footer={
        <View className="text-xs text-muted" style={{ fontSize: isH5() ? 12 : 22 }}>{t('footer.copyright')}</View>
      }
    >
      <Dialog
        open={deleteTarget !== null}
        title={t("doc.deleteTitle")}
        onClose={() => setDeleteTarget(null)}
      >
        <View className="text-sm text-muted">
          {t("doc.deleteConfirm", { title: deleteTarget?.title ?? "" })}
        </View>
        <View className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting ? t('doc.deleting') : t('common.confirm') + t('common.delete')}
          </Button>
        </View>
      </Dialog>

      {/* 导入文字：粘贴/手输 → AI 自动分章 */}
      <Dialog
        open={textImportOpen}
        title={t('home.importText')}
        onClose={() => {
          if (!importing) {
            setTextImportOpen(false)
            setTextContent('')
          }
        }}
      >
        <Textarea
          value={textContent}
          placeholder={t('home.importTextPlaceholder')}
          maxlength={-1}
          onInput={(e) => setTextContent(e.detail.value)}
          // Taro H5 textarea 是自定义元素包装：nativeProps 可透传（border/resize 等生效），
          // 但 height/padding/font-size 会被 Taro 从 style 抽走——由全局 CSS
          // .import-textarea .taro-textarea（app.h5.scss）直接命中内部元素补齐
          className="import-textarea"
          style={{ width: '100%' }}
          nativeProps={{
            style: {
              display: 'block',
              width: '100%',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxSizing: 'border-box',
              lineHeight: 1.6,
              resize: 'none',
            },
          }}
        />
        <View className="flex justify-end gap-2" style={{ marginTop: 18 }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!importing) {
                setTextImportOpen(false)
                setTextContent('')
              }
            }}
            disabled={importing}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleTextImport()}
            disabled={importing || !textContent.trim()}
          >
            {importing ? t('home.importing') : t('common.confirm')}
          </Button>
        </View>
      </Dialog>

      {/* 重命名文档 */}
      <Dialog
        open={renameTarget !== null}
        title={t('common.rename')}
        onClose={() => setRenameTarget(null)}
      >
        <Input
          value={renameTitle}
          onChange={setRenameTitle}
          onEnter={() => void handleRename()}
          placeholder={t('doc.newTitle')}
        />
        <View className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void handleRename()} disabled={!renameTitle.trim()}>
            {t('common.save')}
          </Button>
        </View>
      </Dialog>
    </LayoutShell>
  )
}
