/**
 * 插件间事件总线（自研，无依赖）。
 * 约定：事件名用命名空间 `pluginId:事件名`，避免冲突。
 */
type Handler<T = unknown> = (payload: T) => void

const listeners = new Map<string, Set<Handler>>()

export const bus = {
  /** 订阅事件，返回取消订阅函数 */
  on<T = unknown>(event: string, handler: Handler<T>): () => void {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    set.add(handler as Handler)
    return () => {
      listeners.get(event)?.delete(handler as Handler)
    }
  },

  off<T = unknown>(event: string, handler: Handler<T>): void {
    listeners.get(event)?.delete(handler as Handler)
  },

  /** 发布事件：按注册顺序同步通知；单个 handler 异常不阻断其余 */
  emit<T = unknown>(event: string, payload?: T): void {
    const set = listeners.get(event)
    if (!set) return
    for (const handler of [...set]) {
      try {
        handler(payload)
      } catch (err) {
        console.error(`[bus] handler error for "${event}"`, err)
      }
    }
  },
}
