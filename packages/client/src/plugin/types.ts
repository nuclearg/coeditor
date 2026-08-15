import type { ReactNode } from 'react'

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

// === 区块插槽（锚点树，docs/plugin-v2.md §3/§6） ===
// 页面 layout = sidepanel + main 左右两栏；main.body = 首页内容 or (editorpanel + aipanel)。
// 每个 panel 分 head/body/foot 三段，head/foot 再分 left/middle/right 三栏（留空默认不展示）。
// ctx 恒空纪律：ctx 是扩展哨位（类比 win32 lpReserved），一律为空；
// 插件数据走 stores 直连、动作走公开 action、零件直接 import 宿主组件。新增字段需评审。

/** 插槽上下文（恒空哨位；保留参数以保持签名稳定） */
export type SlotCtx = Record<string, never>

export interface SlotCtxMap {
  'root': SlotCtx
  'settings-menu': SlotCtx

  // === sidepanel（左侧栏） ===
  'sidepanel': SlotCtx
  'sidepanel.head': SlotCtx
  'sidepanel.body': SlotCtx
  'sidepanel.foot': SlotCtx
  'sidepanel.head.left': SlotCtx
  'sidepanel.head.middle': SlotCtx
  'sidepanel.head.right': SlotCtx
  'sidepanel.foot.left': SlotCtx
  'sidepanel.foot.middle': SlotCtx
  'sidepanel.foot.right': SlotCtx

  // === main（右侧主区） ===
  'main': SlotCtx
  'main.head': SlotCtx
  'main.body': SlotCtx
  'main.foot': SlotCtx
  'main.head.left': SlotCtx
  'main.head.middle': SlotCtx
  'main.head.right': SlotCtx
  'main.foot.left': SlotCtx
  'main.foot.middle': SlotCtx
  'main.foot.right': SlotCtx

  // === editorpanel（编辑面板） ===
  'editorpanel': SlotCtx
  'editorpanel.head': SlotCtx
  'editorpanel.body': SlotCtx
  'editorpanel.foot': SlotCtx
  'editorpanel.head.left': SlotCtx
  'editorpanel.head.middle': SlotCtx
  'editorpanel.head.right': SlotCtx
  'editorpanel.foot.left': SlotCtx
  'editorpanel.foot.middle': SlotCtx
  'editorpanel.foot.right': SlotCtx

  // === aipanel（AI 面板） ===
  'aipanel': SlotCtx
  'aipanel.head': SlotCtx
  'aipanel.body': SlotCtx
  'aipanel.foot': SlotCtx
  'aipanel.head.left': SlotCtx
  'aipanel.head.middle': SlotCtx
  'aipanel.head.right': SlotCtx
  'aipanel.foot.left': SlotCtx
  'aipanel.foot.middle': SlotCtx
  'aipanel.foot.right': SlotCtx

  // === 组件级 ===
  'review-button': SlotCtx
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
  }

  /** 用户 */
  user?: {
    /** 当前用户信息（排他：第一个返回非 null 的插件生效），headbar 展示 */
    get?: () => Promise<UserInfo | null>
  }

  /** 区块插槽（链式装饰） */
  ui?: {
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
