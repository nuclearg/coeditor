import { create } from 'zustand'

/**
 * AI 输入区受控协议（数据柱，docs/plugin-v2.md §4）。
 * AiPanel 把输入状态与发送/中止实现注册进来；aipanel.foot.middle/right 的默认实现
 * 与插件替换实现共用同一协议（插件替换输入框/发送按钮时不需要碰 AiPanel 内部）。
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
