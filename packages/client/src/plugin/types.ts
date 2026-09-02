import type { ComponentType, ReactNode } from 'react'

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

// === 区块插槽（锚点树，docs/plugin.md §3/§6） ===
// 页面 layout = sidepanel + main 左右两栏；main.body = 首页内容 or (editorpanel + aipanel)。
// 每个 panel 分 head/body/foot 三段，head/foot 再分 left/middle/right 三栏（留空默认不展示）。
// ctx 恒空纪律：ctx 是扩展哨位（类比 win32 lpReserved），一律为空；
// 插件数据走 stores 直连、动作走公开 action、零件直接 import 宿主组件。新增字段需评审。
//
// 页面归属（锚点由"哪个页面渲染它"决定，同名锚点跨页面共享同一渲染链）：
// - 共享（LayoutShell 全形态：index/editor/settings/custom 都渲染）：
//   root / settings-menu / main.*（main.body 的 defaults 随页面不同）
// - 仅编辑页（LayoutShell variant="editor" 才渲染）：sidepanel.* / editorpanel.* / aipanel.* / review-button
// - 仅设置页（pages/settings 显式渲染）：settings.body
// 装饰器如需"只在某页面形态显示"，用 stores/layoutStore 的 usePageVariant() 判断当前页
// （如公告条只渲染在 home/editor），不要在锚点名上猜测页面归属。

/** 插槽上下文（恒空哨位；保留参数以保持签名稳定） */
export type SlotCtx = Record<string, never>

export interface SlotCtxMap {
  // === 应用级（全形态共享） ===
  'root': SlotCtx
  'settings-menu': SlotCtx

  // === 页面专属：设置页（page.settings，壳与首页一致，仅该页渲染） ===
  // settings.body：设置页内容区（content 内全宽渲染）。链式装饰机制与其它 slot 一致；
  // 整页式内容（如账户中心）直接忽略 defaults 返回自身布局
  'settings.body': SlotCtx

  // === 仅编辑页（LayoutShell variant="editor"） ===
  // sidepanel（左侧栏）：head=logo+标题/收起按钮 ｜ body=章节树 ｜ foot
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

  // === 共享（LayoutShell 全形态：index/editor/settings/custom 都渲染） ===
  // main（右侧主区）：head=面包屑(+收起态 logo)/中/右 ｜ body=editorpanel+aipanel（editor）
  // 或页面 content（home/custom/settings）｜ foot
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

  // === 仅编辑页（variant="editor"） ===
  // editorpanel（编辑面板）：head=draft tabs ｜ body=正文编辑 ｜ foot=草稿版本等
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

  // === 仅编辑页（variant="editor"） ===
  // aipanel（AI 面板）：head=会话 tabs ｜ body=对话气泡区 ｜ foot=输入框/发送
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

  // === 组件级（仅编辑场景内出现） ===
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

  /**
   * 插件注入的全局样式（CSS 文本，H5/桌面端由 app 入口聚合渲染为 <style>）。
   * 建议 class 加插件前缀（如 .account-page）限定作用域，避免污染全局。
   */
  styles?: string

  /**
   * 自定义页面位：page.custom.1 ~ page.custom.10（pages/custom/{n}）。
   * 开源版预留 10 个静态扩展页面，插件可注册组件填充（缺省显示占位提示）。
   * 适合独立页面形态的功能（如账户中心），避免塞进 slot 破坏布局。
   */
  pages?: {
    custom?: Partial<Record<number, ComponentType>>
  }

  /**
   * 设置页标题 + 齿轮下拉底部"进入设置页"菜单项文案（惰性函数，语言切换后生效）：
   * 缺省为内置文案（"高级设置"/"Advanced Settings"）。首个注册者生效。
   * 注意：设置页内容本身注册在 ui.slots['settings.body']（链式装饰机制）。
   */
  settingsPageLabel?: string | (() => string)

  /** 请求层钩子 */
  request?: {
    /** 请求发出前：返回需注入的额外 headers（如 Authorization） */
    getHeaders?: () => Promise<Record<string, string>> | Record<string, string>
    /**
     * RPC 响应到达后（HTTP 200 已解析）。返回 true = 已处理，框架不再走正常错误流。
     * 返回 { retry: true } = 已处理且请求方应用新状态（如静默续期换新 token）重试一次原请求。
     */
    onResponse?: (
      response: RpcResponse,
    ) => Promise<boolean | { retry?: boolean }> | boolean | { retry?: boolean }
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
