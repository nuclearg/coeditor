import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { LayoutShell } from '@/plugin/LayoutShell'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { Markdown } from '@/components/markdown/Markdown'
import { useDocumentStore, useLayoutStore, useAttachmentStore } from '@/stores'
import { t, localize } from '@/lib/i18n'
import { cn, isH5 } from '@/lib/utils'
import { useI18nStore } from '@/stores/i18nStore'
import type { Document, DocumentTemplate } from '@coeditor/shared'

export default function DocumentListPage() {
  const { documents, loading, loadDocuments, createDocument, deleteDocument } = useDocumentStore()
  const templates = useAttachmentStore((s) => s.templates)
  const loadTemplates = useAttachmentStore((s) => s.loadTemplates)
  const language = useI18nStore((s) => s.language)
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('') // 默认未选中模板
  const [templateOpen, setTemplateOpen] = useState(false) // 自绘下拉面板（双端一致，PC 上不用 wxapp 底部弹层）
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadDocuments().catch(() => {})
    loadTemplates().catch(() => {})
  }, [loadDocuments, loadTemplates])

  const selectedTemplate: DocumentTemplate | null =
    templates.find((x) => x.id === templateId) || null

  const templateName = (tpl: DocumentTemplate): string =>
    typeof tpl.name === 'string' ? tpl.name : localize(tpl.name)

  /** 本地化模板字段（string 原样，多语言对象按当前语言取值） */
  const tplField = (value: string | { zh: string; en: string } | undefined): string =>
    value === undefined ? '' : (typeof value === 'string' ? value : localize(value))

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
      Taro.redirectTo({ url: `/pages/edit/index?docId=${doc.id}` })
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

  // 首页面包屑 = 品牌名（main.head.left 默认实现渲染）
  const setBreadcrumb = useLayoutStore((s) => s.setBreadcrumb)
  useEffect(() => {
    setBreadcrumb(t('brand.name'))
    return () => setBreadcrumb('')
  }, [setBreadcrumb, t])

  // 文档卡片的元信息：模板名 · 更新时间（documents.list 已按时间倒序返回）
  const docMeta = (doc: Document): string => {
    const tpl = templates.find((x) => x.id === doc.templateId)
    const tplName = tpl ? templateName(tpl) : ''
    const date = new Date(doc.updatedAt || doc.createdAt).toLocaleDateString(
      language === 'zh' ? 'zh-CN' : 'en-US',
    )
    return [tplName, t('home.updatedAt', { date })].filter(Boolean).join(' · ')
  }

  return (
    <LayoutShell
      home={
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

            {/* 行3：标题 + 创建按钮 */}
            <View className="flex gap-2 mt-2">
              <View className="flex-1">
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
            </View>
            {!selectedTemplate && (
              <View className="create-hint">{t('home.selectTemplateHint')}</View>
            )}
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
                    onClick={() => Taro.redirectTo({ url: `/pages/edit/index?docId=${doc.id}` })}
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
                    <View
                      className="doc-delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(doc)
                      }}
                    >
                      <Icon name="trash" size={isH5() ? 16 : 26} color="var(--muted-fg)" />
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
    </LayoutShell>
  )
}
