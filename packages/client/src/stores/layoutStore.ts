import { create } from 'zustand'

/**
 * 布局状态（骨架 LayoutShell 与插件共享，docs/plugin-v2.md §4 数据柱）。
 * - sidebarOpen：sidepanel 展开/折叠（LayoutShell 持有，插件可读可改）
 * - breadcrumb：编辑页面包屑（"文档 - 章节 - 段落"），由页面同步；
 *   main.head.left 默认实现据此渲染：首页=品牌 logo，编辑页=面包屑（收起态 logo+面包屑）
 * - settingsMenuOpen：设置下拉菜单开关
 */
interface LayoutStore {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  closeSidebar: () => void
  settingsMenuOpen: boolean
  setSettingsMenuOpen: (open: boolean) => void
  breadcrumb: string
  setBreadcrumb: (breadcrumb: string) => void
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  settingsMenuOpen: false,
  setSettingsMenuOpen: (open) => set({ settingsMenuOpen: open }),
  breadcrumb: '',
  setBreadcrumb: (breadcrumb) => set({ breadcrumb }),
}))
