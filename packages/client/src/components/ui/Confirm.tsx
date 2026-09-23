/**
 * 主题化确认框 —— 取代 `Taro.showModal`（H5 是 Taro 自绘弹窗，小程序是 wx.showModal）。
 *
 * ## 为什么不能用 Taro.showModal
 * 它两端都是「微信原生外观」，且**不吃我们的调色板**，夜间模式下与页面割裂：
 * - H5/桌面：Taro 自绘的 `taro__modal` 把配色**写死**在 JS 里——面板 `background: '#FFFFFF'`、
 *   确定按钮 `confirmColor` 默认 `#3CC51F`（微信绿），既不是我们的 `--popover`，
 *   也不随 `.dark` 变化（已核对产物：dist-h5 里能直接搜到 #3CC51F）；
 * - 小程序：走 `wx.showModal`，配色由微信原生化，跟不上应用内手动的日间/夜间切换
 *   （它最多跟随**系统**主题，而我们的主题是 store 驱动的）。
 * 同一类问题还有 `Taro.showActionSheet`（H5 端写死 `#EFEFF4`）；轻提示见 `lib/toast.ts`。
 *
 * ## 怎么做到「跟主题」
 * 复用 UI 套件自己的 `Dialog` + `Button`：配色全部走 CSS 变量
 * （`--popover` / `--popover-fg` / `--primary` / `--destructive` / `--border` …），
 * 这些变量挂在 `.shell-root.dark`（小程序）与 `.app.dark`（H5）上（见 app.scss「调色板的挂载点」），
 * 于是日间/夜间、手动/跟随系统**自动生效**，两端一套代码、观感与应用内既有确认框
 * （删除文档/章节/草稿）完全一致。
 *
 * ## 用法
 * ```tsx
 * const { ask, dialog } = useConfirm()
 *
 * const ok = await ask({ title: t('...'), content: t('...') })
 * if (!ok) return
 * ...
 * return <>{...页面内容}{dialog}</>
 * ```
 * `dialog` 必须渲染在**页面树内**（本组件在调用方的组件树里渲染，正是为此）：
 * 小程序端每页只绘制自己那棵 WXML 子树，挂 app 级 `root` 插槽有取不到调色板变量的风险。
 */

import { View } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useT } from '@/lib/i18n'

export interface ConfirmOptions {
  title: string
  /** 正文；纯文本（弹窗内不做 markdown 渲染，与既有确认框一致） */
  content?: string
  /** 确定按钮文案，缺省为 common.confirm（跟随语言） */
  confirmText?: string
  /** 取消按钮文案，缺省为 common.cancel（跟随语言） */
  cancelText?: string
  /**
   * 危险操作（注销账号、删除数据）：确定按钮改用 `--destructive`。
   * 缺省用 `--primary`（应用主色，淡土黄）——这正是本组件要替代 Taro 默认绿字的意义所在。
   */
  danger?: boolean
}

/** 弹确认框，resolve 用户是否点了确定（点遮罩/取消/关闭都算 false） */
export type AskConfirm = (options: ConfirmOptions) => Promise<boolean>

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

export function useConfirm(): { ask: AskConfirm; dialog: ReactNode } {
  const t = useT()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  /**
   * resolve 只允许结算一次：确定 / 取消 / 点遮罩 三条路径都可能触发，
   * 用 ref（而非 state）持有当前请求，结算时先摘下来再 resolve——
   * 后续触达的路径拿到的已是 null，不会二次 resolve，也不会再改 state。
   */
  const current = useRef<PendingConfirm | null>(null)

  const ask = useCallback<AskConfirm>((options) => {
    return new Promise<boolean>((resolve) => {
      // 上一个未结算的确认按「取消」收尾：连点两次入口时，前一个 Promise 不能永远悬着
      current.current?.resolve(false)
      const req: PendingConfirm = { ...options, resolve }
      current.current = req
      setPending(req)
    })
  }, [])

  const settle = (confirmed: boolean) => {
    const req = current.current
    current.current = null
    setPending(null)
    req?.resolve(confirmed)
  }

  /**
   * 卸载时把未决的确认按「取消」收尾：调用方都在 `await` 上，
   * 若弹窗还开着时页面被卸载（如会话失活走 recoverSession → reLaunch），
   * 不收尾那个 Promise 就永远悬着（后续代码不再执行，也不会有 React 报错提醒）。
   * 这里只 resolve、不 setState——卸载后 setState 是空操作且会告警。
   */
  useEffect(() => {
    return () => {
      current.current?.resolve(false)
      current.current = null
    }
  }, [])

  const dialog = pending ? (
    <Dialog open title={pending.title} onClose={() => settle(false)}>
      {pending.content ? <View className="text-sm text-muted">{pending.content}</View> : null}
      <View className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" size="sm" onClick={() => settle(false)}>
          {pending.cancelText ?? t('common.cancel')}
        </Button>
        <Button
          variant={pending.danger ? 'destructive' : 'primary'}
          size="sm"
          onClick={() => settle(true)}
        >
          {pending.confirmText ?? t('common.confirm')}
        </Button>
      </View>
    </Dialog>
  ) : null

  return { ask, dialog }
}
