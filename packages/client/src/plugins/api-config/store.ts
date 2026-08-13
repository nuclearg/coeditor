import { create } from 'zustand'

interface ApiConfigState {
  openDialog: boolean
  open: () => void
  close: () => void
}

export const useApiConfigStore = create<ApiConfigState>((set) => ({
  openDialog: false,
  open: () => set({ openDialog: true }),
  close: () => set({ openDialog: false }),
}))
