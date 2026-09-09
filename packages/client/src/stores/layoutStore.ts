import { create } from 'zustand'

/** 页面形态（LayoutShell variant）：固定页 home(首页)/editor(编辑页)/settings(设置页) + 扩展页 custom(pages/custom/{1..10})。
 *  slot 装饰器可用 usePageVariant 判断当前页面形态。 */
export type PageVariant = 'home' | 'editor' | 'settings' | 'custom'

/**
 * 布局状态（骨架 LayoutShell 与插件共享，docs/plugin.md §4 数据柱）。
 * - sidebarOpen：sidepanel 展开/折叠（LayoutShell 持有，插件可读可改）
 * - breadcrumb：编辑页面包屑（"文档 - 章节 - 段落"），由页面同步；
 *   main.head.left 默认实现据此渲染：首页=品牌 logo，编辑页=面包屑（收起态 logo+面包屑）
 * - pageVariant：当前显示的页面形态（LayoutShell 随页面 onShow/挂载同步；
 *   解决"共享锚点跨页面生效，但插件需知道当前页"——如公告条只想在 home/editor 显示）
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
  pageVariant: PageVariant | null
  setPageVariant: (variant: PageVariant | null) => void
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
  pageVariant: null,
  setPageVariant: (variant) => set({ pageVariant: variant }),
}))

/** 当前页面形态（订阅：页面切换/返回时随 onShow 更新，装饰组件据此决定是否渲染） */
export function usePageVariant(): PageVariant | null {
  return useLayoutStore((s) => s.pageVariant)
}
