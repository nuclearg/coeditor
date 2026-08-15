import { create } from 'zustand'
import type { Document } from '@coeditor/shared'
import { api } from '@/api/client'
import { bus } from '@/plugin/bus'

interface DocumentStore {
  documents: Document[]
  loading: boolean
  loadDocuments: () => Promise<void>
  createDocument: (title: string, templateId?: string) => Promise<Document>
  deleteDocument: (docId: string) => Promise<void>
  updateDocument: (docId: string, data: { title?: string; description?: string }) => Promise<Document>
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  documents: [],
  loading: false,

  loadDocuments: async () => {
    set({ loading: true })
    try {
      const docs = await api.rpc<Document[]>('documents.list')
      set({ documents: docs })
    } catch (err) {
      console.error('[loadDocuments]', err)
      throw err
    } finally {
      set({ loading: false })
    }
  },

  createDocument: async (title, templateId) => {
    const doc = await api.rpc<Document>('documents.create', { title, description: '', templateId })
    set((s) => ({ documents: [doc, ...s.documents] }))
    bus.emit('doc:changed', { docId: doc.id })
    return doc
  },

  deleteDocument: async (docId) => {
    await api.rpc('documents.delete', { docId })
    set((s) => ({ documents: s.documents.filter((d) => d.id !== docId) }))
    bus.emit('doc:changed', { docId })
  },

  updateDocument: async (docId, data) => {
    const doc = await api.rpc<Document>('documents.update', { docId, ...data })
    set((s) => ({
      documents: s.documents.map((d) => (d.id === docId ? doc : d)),
    }))
    return doc
  },
}))
