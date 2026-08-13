import { Picker, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { Layout } from '@/components/layout/Layout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { useDocumentStore, useAttachmentStore } from '@/stores'
import { t, localize } from '@/lib/i18n'
import { useI18nStore } from '@/stores/i18nStore'
import type { Document } from '@coeditor/shared'

export default function DocumentListPage() {
  const { documents, loading, loadDocuments, createDocument, deleteDocument } = useDocumentStore()
  const templates = useAttachmentStore((s) => s.templates)
  const loadTemplates = useAttachmentStore((s) => s.loadTemplates)
  const language = useI18nStore((s) => s.language)
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('novel')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadDocuments().catch(() => {})
    loadTemplates().catch(() => {})
  }, [loadDocuments, loadTemplates])

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      const doc = await createDocument(title.trim(), templateId)
      setTitle('')
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

  return (
    <Layout>
      <View className="p-4" style={{ maxWidth: 800, margin: '0 auto' }}>
        <View className="flex gap-2 mb-4">
          <View className="flex-1">
            <Input
              placeholder={t('doc.newTitle')}
              value={title}
              onChange={setTitle}
              onEnter={handleCreate}
            />
          </View>
          <View style={{ width: 200 }}>
            <Picker
              mode="selector"
              range={templates.map((tpl) => ({ ...tpl, name: typeof tpl.name === 'string' ? tpl.name : localize(tpl.name) }))}
              rangeKey="name"
              value={Math.max(0, templates.findIndex((t) => t.id === templateId))}
              onChange={(e) => {
                const idx = Number(e.detail.value)
                if (templates[idx]) setTemplateId(templates[idx].id)
              }}
            >
              <View className="input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>{(() => {
                  const tpl = templates.find((t) => t.id === templateId)
                  if (!tpl) return t('common.untitled')
                  return typeof tpl.name === 'string' ? tpl.name : localize(tpl.name)
                })()}</View>
                <Icon name="chevronDown" size={22} color="var(--muted-fg)" />
              </View>
            </Picker>
          </View>
          <Button onClick={handleCreate} disabled={creating || !title.trim()} size="sm">
            {t('doc.create')}
          </Button>
        </View>

        <View>
          {documents.map((doc) => (
            <View
              key={doc.id}
              className="list-item"
              onClick={() => Taro.redirectTo({ url: `/pages/edit/index?docId=${doc.id}` })}
            >
              <View className="flex-1" style={{ minWidth: 0 }}>
                <View className="font-medium">{doc.title}</View>
                <View className="text-xs text-muted mt-1">
                  {new Date(doc.updatedAt || doc.createdAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')}
                </View>
              </View>
              <View
                className="shrink-0"
                style={{ padding: 10 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteTarget(doc)
                }}
              >
                <Icon name="trash" size={28} color="var(--muted-fg)" />
              </View>
            </View>
          ))}
          {!loading && documents.length === 0 && (
            <View className="text-center text-muted" style={{ padding: '96px 0' }}>
              {t("doc.emptyHint")}
            </View>
          )}
        </View>
      </View>

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
    </Layout>
  )
}
