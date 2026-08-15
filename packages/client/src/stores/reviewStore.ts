import { create } from 'zustand'

/**
 * 审阅动作的公开入口（数据柱，docs/plugin-v2.md §4/§7）。
 * startReview 只声明"请求一次审阅"（可选维度 focus）；页面订阅 seq 变化后走
 * 现有 autoSubmit 链路（保存 → 建会话/turn → SSE → 落盘），focus 由 AiPanel 消费
 * 并随 ai.chat 请求下发（reviewFocus）。任何 UI 形态（按钮/下拉/快捷键）统一走这里。
 */
interface ReviewStore {
  /** 请求序号：每次 startReview +1，页面/组件据此触发审阅流程 */
  seq: number
  /** 待消费的审阅维度（plot/character/...；null = 综合审阅） */
  focus: string | null
  startReview: (focus?: string) => void
  /** AiPanel autoSubmit 消费 focus（一次性，消费后置空） */
  consumeFocus: () => string | null
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  seq: 0,
  focus: null,
  startReview: (focus) => set((s) => ({ seq: s.seq + 1, focus: focus ?? null })),
  consumeFocus: () => {
    const focus = get().focus
    set({ focus: null })
    return focus
  },
}))
