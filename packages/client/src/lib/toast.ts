/**
 * 轻提示（toast）—— 主题化，取代 `Taro.showToast` / `Taro.showLoading` 这类框架自带的弹层。
 *
 * ## 为什么不能用 Taro 自带的弹层
 * 它们的配色**不读我们的调色板**，夜间模式下与页面割裂：
 * - `Taro.showToast` / `showLoading`：H5 端 Taro 自绘的是深色半透明块（勉强能看），
 *   但小程序端走 `wx.showToast` 原生白底——夜间模式下弹出来一块白；
 * - `Taro.showModal`：H5 端 Taro 把配色写死在 JS 里（面板 `#FFFFFF`、确定按钮 `#3CC51F` 微信绿），
 *   小程序端是 `wx.showModal` 原生白底。确认框请改用 `components/ui/Confirm` 的 `useConfirm()`；
 * - `Taro.showActionSheet`：同类问题（H5 端写死 `#EFEFF4` 白灰面板 + 黑字）。
 * 这些原生弹层也没法跟随"设置里的手动日/夜"——它们最多跟随**系统**主题，而我们的主题是 store 驱动的。
 *
 * ## 分工：本文件只管状态，`<ToastHost />` 只管画
 * 提示的触发点经常不在组件里（app.tsx 的全局兜底、hooks、lib 工具函数），
 * 所以状态放在这里（**纯 TS，不依赖 React / Taro**，可单测），
 * 由挂在 LayoutShell 上的 `<ToastHost />` 渲染并继承 `.shell-root` 上的调色板变量。
 * 计时也在这里：宿主是纯展示，连续两次提示不会各留一个定时器。
 */

/** 提示语气：info = 中性（如"已复制"、前置校验），error = 失败（文案用 --destructive） */
export type ToastKind = 'info' | 'error'

export interface Toast {
  /** 自增 id：宿主拿它做 key，连续两次提示时强制重建节点、动画重播 */
  id: number
  message: string
  kind: ToastKind
  /** 毫秒；0 = 不自动消失（需显式 hideToast） */
  duration: number
}

/** 默认时长：与迁移前的 Taro.showToast 调用保持一致（错误 3s / 中性 2s） */
const ERROR_DURATION = 3000
const INFO_DURATION = 2000

let current: Toast | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // 单个订阅者异常不影响其它订阅者与调用方
    }
  }
}

/** 订阅变化（供 `useSyncExternalStore` 使用）；返回退订函数 */
export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 当前提示（无提示时为 null）。**引用稳定**——只在真的变化时换对象，符合 useSyncExternalStore 的快照约定 */
export function getToast(): Toast | null {
  return current
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/**
 * 展示一条提示。
 *
 * 连点/连续触发时**替换**当前这条并重新计时（与 wx.showToast 语义一致），
 * 而不是排队——提示是"当前状态"的展示，排一队过期的文案没有意义。
 */
function push(message: string, kind: ToastKind, duration: number): void {
  const text = (message ?? '').trim()
  if (text === '') return
  clearTimer()
  current = { id: ++seq, message: text, kind, duration }
  if (duration > 0) {
    timer = setTimeout(() => {
      timer = null
      hideToast()
    }, duration)
  }
  emit()
}

/** 中性提示（非错误），如"已复制""已恢复未保存内容" */
export function showToast(message: string, duration: number = INFO_DURATION): void {
  push(message, 'info', duration)
}

/** 失败提示（文案用 --destructive，正文说明发生了什么） */
export function showErrorToast(message: string, duration: number = ERROR_DURATION): void {
  push(message, 'error', duration)
}

/** 手动收起（正常流程不需要：到点自动消失） */
export function hideToast(): void {
  clearTimer()
  if (current === null) return
  current = null
  emit()
}
