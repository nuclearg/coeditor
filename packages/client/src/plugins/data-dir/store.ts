import { create } from 'zustand'

interface DataDirState {
  openDialog: boolean
  open: () => void
  close: () => void
}

export const useDataDirStore = create<DataDirState>((set) => ({
  openDialog: false,
  open: () => set({ openDialog: true }),
  close: () => set({ openDialog: false }),
}))
