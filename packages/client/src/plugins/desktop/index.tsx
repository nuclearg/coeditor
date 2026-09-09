import type { ReactNode } from 'react'
import Taro from '@tarojs/taro'
import type { CoEditorPlugin } from '@/plugin'
import { useLayoutStore } from '@/stores/layoutStore'
import { useI18nStore } from '@/stores/i18nStore'
import { registerSettingsLauncher } from '@/plugin/launcher'
import { registerDirectoryPicker } from '@/lib/desktop'
import { openSettingsDialog, closeSettingsDialog, useSettingsDialogStore } from './dialog-store'
import { DesktopSettingsDialog } from './SettingsDialog'

/**
 * desktop 插件 —— 桌面壳（Tauri）的全部适配都收敛在这里。
 * 只在桌面构建的注册表（src/plugin/registry.desktop.ts）里注册：
 * - 'main.head'：首页整块重写为空（原生标题栏即顶栏，无多余条）；
 * - 'root'：桌面设置弹窗（外观与语言 + settings.body 内容）；
 * - app.onInit：全局一次性副作用（桌面标记、快捷键、原生菜单事件、
 *   window.open 适配、目录选择器、窗口标题跟随页面 title）。
 *
 * 核心组件（LayoutShell/SettingsMenu/…）不含任何桌面判断；Web/小程序
 * 不注册本插件，产物与行为完全不受影响。
 */

/* ============ 设置弹窗 / 首页 head 的桌面样式（插件注入） ============ */
const DESKTOP_STYLES = `
.settings-dialog { width: min(760px, 94vw); max-width: 760px; }
.settings-dialog-body .settings-page { max-width: none; padding: 0 0 4px; }
.settings-dialog-body .settings-section { margin-bottom: 12px; }
.settings-dialog-body .settings-section:last-child { margin-bottom: 0; }
.settings-dialog .dlg-prefs-row { display: flex; flex-wrap: wrap; gap: 8px; }
.settings-dialog .dlg-pref-chip { padding: 6px 14px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; color: var(--muted-fg); cursor: pointer; }
.settings-dialog .dlg-pref-chip:active { opacity: 0.8; }
.settings-dialog .dlg-pref-chip.on { border-color: var(--accent-warm); color: var(--fg); background: var(--muted); }
`

/* ============ 'main.head'：首页整块抹除 ============ */

/** 桌面首页无 head 条：variant=home 返回空，其余页面原样放行 defaults */
function DesktopHeadGate({ defaults }: { defaults: ReactNode }) {
  const variant = useLayoutStore((s) => s.pageVariant)
  if (variant === 'home') return null
  return <>{defaults}</>
}

/* ============ app.onInit：全局一次性副作用 ============ */

/** 窗口标题跟随页面 title（web 路由/文档切换都会更新 document.title） */
let lastTitle: string | undefined

function syncWindowTitle(): void {
  if (typeof document === 'undefined') return
  const title = document.title
  if (!title || title === lastTitle) return
  lastTitle = title
  // 注意：core window 命令 set_title 的参数名是 value（不是 title）
  invokeNative('plugin:window|set_title', { label: 'main', value: title })
}

/** 品牌名（用于首页默认标题随语言切换） */
const BRANDS = ['校书郎', 'CoEditor']
const brandOf = (language: string): string => (language.startsWith('en') ? 'CoEditor' : '校书郎')

/** 若当前窗口标题还是"默认品牌名"（首页态），语言切换时同步换掉，让标题跟随语言 */
function refreshBrandTitle(language: string): void {
  if (typeof document === 'undefined') return
  const cur = document.title
  if (!cur || BRANDS.includes(cur)) document.title = brandOf(language)
}

/** 通过 Tauri 内部 invoke 调用 Rust（web/小程序不会走到这里） */
function invokeNative(cmd: string, args: Record<string, unknown>): void {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown> }
  }).__TAURI_INTERNALS__
  if (!internals?.invoke) return
  internals.invoke(cmd, args).catch((err) => console.warn(`[desktop] ${cmd} failed`, err))
}

async function initDesktopRuntime(): Promise<void> {
  if (typeof document !== 'undefined') {
    document.body.classList.add('coeditor-desktop')
  }

  // 设置启动器：核心齿轮/菜单入口在桌面直接弹设置
  registerSettingsLauncher(openSettingsDialog)

  // 目录选择器（DataDirSection 的"浏览"由本插件注入实现）
  registerDirectoryPicker(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const dir = await open({
        directory: true,
        multiple: false,
        title: '选择数据保存目录',
      })
      return typeof dir === 'string' && dir.trim() !== '' ? dir : null
    } catch (err) {
      console.error('[desktop] pickDataDirectory failed', err)
      return null
    }
  })

  // window.open：外链 → 系统浏览器；相对路径 → 应用内导航
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  window.open = ((url?: string | URL, _target?: string, _features?: string): Window | null => {
    if (!url) return null
    const raw = String(url)
    if (/^https?:\/\//i.test(raw)) {
      openUrl(raw).catch((err) => console.error('[desktop] openUrl failed', err))
      return null
    }
    window.location.assign(raw)
    return null
  }) as typeof window.open

  // 原生菜单事件（Rust webview.eval 派发的 DOM CustomEvent）
  window.addEventListener('coeditor:open-settings', () => openSettingsDialog())
  window.addEventListener('coeditor:go-home', () => {
    Taro.reLaunch({ url: '/pages/index/index' }).catch(() => {})
  })

  // Cmd/Ctrl+/ 开关设置弹窗；Esc 关闭
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault()
      const { open } = useSettingsDialogStore.getState()
      if (open) closeSettingsDialog()
      else openSettingsDialog()
    } else if (e.key === 'Escape') {
      closeSettingsDialog()
    }
  }
  window.addEventListener('keydown', onKey)

  // 窗口标题跟随页面 title
  syncWindowTitle()
  window.setInterval(syncWindowTitle, 400)

  // 原生菜单文案固定按系统语言（Rust 启动时定），不随应用内语言切换。
  // 这里只让"首页品牌标题"随语言走（窗口标题同步通道已工作）。
  const { language: bootLang } = useI18nStore.getState()
  refreshBrandTitle(bootLang)
  useI18nStore.subscribe((state, prev) => {
    if (state.language !== prev.language) {
      refreshBrandTitle(state.language)
    }
  })
}

/* ============ 插件定义 ============ */

export const desktopPlugin: CoEditorPlugin = {
  id: 'desktop',
  styles: DESKTOP_STYLES,
  app: {
    onInit: initDesktopRuntime,
  },
  ui: {
    slots: {
      'main.head': (defaults) => <DesktopHeadGate defaults={defaults} />,
      'root': () => <DesktopSettingsDialog />,
    },
  },
}
