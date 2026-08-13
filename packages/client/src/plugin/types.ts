import type { ReactNode } from 'react'
import type { Document, DocumentTemplate } from '@coeditor/shared'

export interface RadioOption {
  label: string
  value: string
}

export interface UserInfo {
  name: string
}

/** 菜单项文案：静态字符串或惰性函数（渲染时求值，语言切换后生效） */
export type LocalizedLabel = string | (() => string)

export type PluginMenuItem =
  | { type: 'action'; label: LocalizedLabel; onClick: () => void }
  | { type: 'link'; label: LocalizedLabel; url: string }
  | {
      type: 'radio-group'
      label: LocalizedLabel
      options: RadioOption[]
      value: string
      onChange: (value: string) => void
    }

// === 区块插槽（链式装饰：所有插件按注册顺序依次作用于 defaults） ===

export interface TopbarLeftCtx {
  nav: { to: (path: string) => void }
  /** 默认品牌区（图标 + 标题，点击回首页） */
  renderBrand: (opts?: { logo?: string; title?: string }) => ReactNode
}

export interface TopbarRightCtx {
  user: UserInfo | null
  /** 用户徽章积木（可配置图标/文案；默认仅在有用户时渲染 user 图标 + 用户名） */
  renderSettingsBadge: (opts?: { icon?: string; label?: string }) => ReactNode
}

export interface TopbarSettingsCtx {
  /** 打开设置下拉菜单 */
  open: () => void
  /** 默认设置入口按钮（齿轮），可传 icon/label 定制 */
  renderSettingsButton: (opts?: { icon?: string; label?: string }) => ReactNode
}

export interface SidebarTopCtx {
  docId: string
  doc: Document | null
  template: DocumentTemplate | null
  renderTitle: () => ReactNode
  renderAttachments: () => ReactNode
  renderFulltextEntry: () => ReactNode
}

export interface SidebarBottomCtx {
  docId: string
}

export interface EditorTopCtx {
  activeDrafts: unknown[]
  currentDraftId: string
  renderDraftTabs: () => ReactNode
}

export interface EditorBottomCtx {
  dirty: boolean
  saving: boolean
  doSave: () => Promise<boolean>
  submitReview: () => void
  renderSaveButton: (opts?: { label?: string }) => ReactNode
  renderReviewButton: () => ReactNode
}

export interface AiTopCtx {
  conversations: unknown[]
  activeConvId: string | null
  createConversation: () => void
  renderTitle: () => ReactNode
  renderNewButton: () => ReactNode
  renderConversationTabs: () => ReactNode
}

export interface AiBottomCtx {
  streaming: boolean
  send: () => void
  abort: () => void
  placeholder: string
  renderInput: () => ReactNode
  renderSendButton: () => ReactNode
}

/** 设置下拉菜单末尾的追加区（defaults = null，排在所有插件 menuItems 之后） */
export type SettingsMenuCtx = Record<string, never>

/** 应用根部全局挂载区（原 ui.host） */
export type RootCtx = Record<string, never>

export interface SlotCtxMap {
  'root': RootCtx
  'topbar-left': TopbarLeftCtx
  'topbar-right': TopbarRightCtx
  'topbar-settings': TopbarSettingsCtx
  'sidebar-top': SidebarTopCtx
  'sidebar-bottom': SidebarBottomCtx
  'editor-top': EditorTopCtx
  'editor-bottom': EditorBottomCtx
  'ai-top': AiTopCtx
  'ai-bottom': AiBottomCtx
  'settings-menu': SettingsMenuCtx
}

export type PluginSlot = keyof SlotCtxMap

export type SlotRenderer<K extends PluginSlot> = (defaults: ReactNode, ctx: SlotCtxMap[K]) => ReactNode

export interface CoEditorPlugin {
  id: string

  /** 应用级 */
  app?: {
    /** 应用启动钩子：启动时依次执行。可在此检查登录态并自行跳转 */
    onInit?: () => Promise<void>
  }

  /** 设置菜单 */
  settings?: {
    /** 向设置下拉菜单贡献的结构化菜单项（受控渲染，多插件聚合） */
    menuItems?: PluginMenuItem[]
    /** 【兼容别名】替换设置入口按钮，等价于 ui.slots['topbar-settings'] */
    trigger?: (ctx: { open: () => void }) => ReactNode
  }

  /** 用户 */
  user?: {
    /** 当前用户信息（排他：第一个返回非 null 的插件生效），Header 展示 */
    get?: () => Promise<UserInfo | null>
  }

  /** 区块插槽（链式装饰） */
  ui?: {
    /** 【兼容别名】全局根部挂载，等价于 ui.slots['root'] */
    host?: () => ReactNode
    /** 命名插槽：所有插件的渲染函数按注册顺序链式作用于 defaults */
    slots?: Partial<{ [K in PluginSlot]: SlotRenderer<K> }>
  }

  /** 请求层钩子 */
  request?: {
    /** 请求发出前：返回需注入的额外 headers（如 Authorization） */
    getHeaders?: () => Promise<Record<string, string>> | Record<string, string>
    /** RPC 响应到达后（HTTP 200 已解析）。返回 true = 已处理，框架不再走正常错误流 */
    onResponse?: (response: RpcResponse) => Promise<boolean> | boolean
  }

  /** 插件自带文案字典，框架启动时合并进全局 i18n（key 以 plugin.<id>. 为前缀） */
  i18n?: {
    zh: Record<string, string>
    en: Record<string, string>
  }
}

/** onResponse 接收的只读响应对象 */
export interface RpcResponse {
  readonly success: boolean
  readonly data?: unknown
  readonly error?: string
  readonly action: string
}
