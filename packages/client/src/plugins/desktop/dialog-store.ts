import { create } from 'zustand'

/** 桌面设置弹窗开关（desktop 插件内部状态，核心不感知） */
interface SettingsDialogState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

export function openSettingsDialog(): void {
  useSettingsDialogStore.getState().setOpen(true)
}

export function closeSettingsDialog(): void {
  useSettingsDialogStore.getState().setOpen(false)
}
