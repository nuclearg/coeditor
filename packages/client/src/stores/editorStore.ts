import { create } from 'zustand'

/**
 * 编辑器保存状态与动作（数据柱，docs/plugin-v2.md §4）。
 * 编辑页把 dirty/saving/doSave 同步进来；插件替换 editorpanel.foot 时
 * 从这里读状态、调 doSave（写操作唯一入口），而不是自己拼保存链路。
 * 未保存（dirty）的视觉表达 = 【保存】按钮 enable 状态（disabled={!dirty || saving}）。
 */
interface EditorStore {
  dirty: boolean
  saving: boolean
  doSave: () => Promise<boolean>
  syncEditorState: (dirty: boolean, saving: boolean, doSave: () => Promise<boolean>) => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  dirty: false,
  saving: false,
  doSave: async () => true,
  syncEditorState: (dirty, saving, doSave) => set({ dirty, saving, doSave }),
}))
