import { create } from 'zustand'

/**
 * AI 输入区受控协议（数据柱，docs/plugin.md §4）。
 * AiPanel 把输入状态与发送/中止实现注册进来；aipanel.foot.middle/right 的默认实现
 * 与插件替换实现共用同一协议（插件替换输入框/发送按钮时不需要碰 AiPanel 内部）。
 *
 * ⚠️ `placeholder` 是**已本地化的文案副本**，由 AiPanel 在 effect 里写入（即 render 之后），
 * 且语言切换时不会自动重渲染订阅方之外的东西。替换输入框的插件请**订阅**它
 * （`useAiInputStore((s) => s.placeholder)`），不要用 `getState()` 在 render 里快照——
 * 快照会慢一拍，语言切换后显示上一轮语言的文案（默认输入框踩过这个坑，见 AiPanel 的注释）。
 */
interface AiInputStore {
  input: string
  setInput: (value: string) => void
  streaming: boolean
  setStreaming: (streaming: boolean) => void
  placeholder: string
  setPlaceholder: (placeholder: string) => void
  /** 发送/中止实现（AiPanel mount 时注册；替换实现直接调用） */
  send: () => void
  abort: () => void
  registerControls: (controls: { send: () => void; abort: () => void }) => void
}

export const useAiInputStore = create<AiInputStore>((set) => ({
  input: '',
  setInput: (input) => set({ input }),
  streaming: false,
  setStreaming: (streaming) => set({ streaming }),
  placeholder: '',
  setPlaceholder: (placeholder) => set({ placeholder }),
  send: () => {},
  abort: () => {},
  registerControls: (controls) => set({ send: controls.send, abort: controls.abort }),
}))
