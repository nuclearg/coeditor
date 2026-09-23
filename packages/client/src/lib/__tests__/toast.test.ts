import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getToast,
  hideToast,
  showErrorToast,
  showToast,
  subscribeToast,
} from '@/lib/toast'

/**
 * 轻提示状态机：主题化弹层替掉 Taro.showToast 之后，这里是唯一的"何时显示/何时消失"逻辑，
 * 所以按行为逐条钉住（替换语义、默认时长、计时、订阅）。
 */
describe('lib/toast', () => {
  beforeEach(() => {
    hideToast()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始无提示', () => {
    expect(getToast()).toBeNull()
  })

  it('showToast 展示中性提示，showErrorToast 展示错误语气', () => {
    showToast('已复制')
    expect(getToast()).toMatchObject({ message: '已复制', kind: 'info' })

    showErrorToast('保存失败')
    expect(getToast()).toMatchObject({ message: '保存失败', kind: 'error' })
  })

  it('空/纯空白文案不展示（避免弹一个空气泡）', () => {
    showToast('   ')
    expect(getToast()).toBeNull()

    showToast('')
    expect(getToast()).toBeNull()
  })

  it('文案两侧空白会被去掉', () => {
    showToast('  导入失败  ')
    expect(getToast()?.message).toBe('导入失败')
  })

  it('默认时长：中性 2s、错误 3s（与迁移前的 Taro.showToast 调用一致）', () => {
    showToast('中性')
    expect(getToast()?.duration).toBe(2000)

    showErrorToast('失败')
    expect(getToast()?.duration).toBe(3000)
  })

  it('到点自动消失', () => {
    showToast('稍纵即逝')
    vi.advanceTimersByTime(1999)
    expect(getToast()).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(getToast()).toBeNull()
  })

  it('连续触发是"替换 + 重新计时"，不是排队', () => {
    showToast('第一条')
    const first = getToast()
    vi.advanceTimersByTime(1500)

    showToast('第二条')
    const second = getToast()
    expect(second?.message).toBe('第二条')
    // id 变了：宿主据此重建节点、重播入场动画
    expect(second?.id).not.toBe(first?.id)
    // 重新计时：第一条剩下的 500ms 不该把第二条一起带走
    vi.advanceTimersByTime(1000)
    expect(getToast()?.message).toBe('第二条')
    vi.advanceTimersByTime(1000)
    expect(getToast()).toBeNull()
  })

  it('duration=0 表示不自动消失，需显式 hideToast', () => {
    showToast('常驻', 0)
    vi.advanceTimersByTime(60_000)
    expect(getToast()).not.toBeNull()

    hideToast()
    expect(getToast()).toBeNull()
  })

  it('订阅者在展示与消失时各收到一次；退订后不再收到', () => {
    const listener = vi.fn()
    const off = subscribeToast(listener)

    showToast('提示')
    expect(listener).toHaveBeenCalledTimes(1)

    hideToast()
    expect(listener).toHaveBeenCalledTimes(2)

    off()
    showToast('退订后')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('单个订阅者抛错不影响其它订阅者与调用方', () => {
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    const offBad = subscribeToast(bad)
    const offGood = subscribeToast(good)

    expect(() => showToast('提示')).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)

    offBad()
    offGood()
  })

  it('无提示时 hideToast 是空操作（不惊动订阅者）', () => {
    const listener = vi.fn()
    const off = subscribeToast(listener)
    hideToast()
    expect(listener).not.toHaveBeenCalled()
    off()
  })
})
