import { Component, PropsWithChildren, useEffect } from 'react'
import { View } from '@tarojs/components'
import Taro, { useLaunch } from '@tarojs/taro'
import { runInit, mergePluginDictionaries, getPlugins } from '@/plugin'
import { SlotHost } from '@/plugin/SlotHost'
import { useTheme } from '@/stores/theme'
import { cn, isH5 } from '@/lib/utils'
import { initDesktopAdapters } from '@/lib/desktop'
import { t } from '@/lib/i18n'

// H5 端使用 web 尺寸覆盖层（小程序保留移动端尺寸）
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(process.env.TARO_ENV === 'h5' ? './app.h5.scss' : './app.scss')

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * App-level error boundary: a render exception anywhere in the page tree
 * shows a simple fallback with a reload affordance instead of a white screen.
 */
class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[ErrorBoundary]', error, info)
  }

  handleReload = () => {
    if (isH5()) {
      window.location.reload()
    } else {
      Taro.reLaunch({ url: '/pages/index/index' }).catch(() => {})
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <View className="flex flex-col items-center justify-center gap-2" style={{ padding: 48, minHeight: '60vh' }}>
          <View className="text-sm text-muted">{t('error.crashed')}</View>
          <View
            className="tab text-sm"
            style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 8 }}
            onClick={this.handleReload}
          >
            {t('error.reload')}
          </View>
        </View>
      )
    }
    return this.props.children
  }
}

function App({ children }: PropsWithChildren) {
  // 全局未捕获 rejection 兜底：弹 toast + 打日志，双端覆盖
  useEffect(() => {
    const shouldSuppress = (reason: unknown) =>
      reason instanceof Error && reason.name === 'PluginHandled'

    if (isH5() && typeof window !== 'undefined') {
      const handler = (e: PromiseRejectionEvent) => {
        e.preventDefault()
        if (shouldSuppress(e.reason)) return
        const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
        console.error('[unhandled]', e.reason)
        Taro.showToast({ title: msg || t('error.operationFailed'), icon: 'none', duration: 3000 })
      }
      window.addEventListener('unhandledrejection', handler)
      return () => window.removeEventListener('unhandledrejection', handler)
    } else {
      // 小程序端
      const handler = (res: { reason: unknown }) => {
        if (shouldSuppress(res.reason)) return
        const msg = res.reason instanceof Error ? res.reason.message : String(res.reason)
        console.error('[unhandled]', res.reason)
        Taro.showToast({ title: msg || t('error.operationFailed'), icon: 'none', duration: 3000 })
      }
      Taro.onUnhandledRejection?.(handler)
      return () => { Taro.offUnhandledRejection?.(handler) }
    }
  }, [])

  useLaunch(() => {
    mergePluginDictionaries()
    runInit().catch((err) => console.error('[app] runInit failed', err))
    // 桌面壳（Tauri）适配：WebView 内激活 window.open 重定向，其余平台无操作
    initDesktopAdapters().catch((err) => console.error('[app] desktop adapters failed', err))
  })

  // 主题 class 由根 View 驱动（.app.dark），H5 与小程序一致
  const theme = useTheme((s) => s.theme)

  // html 根同步声明 color-scheme（meta color-scheme 之外再运行时锁根元素）：
  // 系统深色时手机浏览器 Auto Dark 会无视页面自身日间设置强制压黑——根元素的
  // color-scheme 是它判定"页面是否适配深色"的依据，动态跟随主题即可禁用该干预，
  // 同时让滚动条/表单等原生控件颜色与我们的主题一致
  useEffect(() => {
    if (isH5() && typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = theme
    }
  }, [theme])

  // 插件注入的全局样式：聚合渲染 <style>（仅 H5/桌面，小程序无 <style> 语义）
  const pluginStyles = getPlugins().map((p) => p.styles).filter(Boolean).join('\n')

  return (
    <View className={cn('app', theme === 'dark' && 'dark')}>
      {isH5() && pluginStyles !== '' && <style dangerouslySetInnerHTML={{ __html: pluginStyles }} />}
      <ErrorBoundary>
        {children}
        <SlotHost slot="root" ctx={{}} />
      </ErrorBoundary>
    </View>
  )
}

export default App
