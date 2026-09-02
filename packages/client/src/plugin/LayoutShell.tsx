import { Image, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ResizablePanel } from '@/components/ui/Resizable'
import { SettingsMenu } from '@/components/settings/SettingsMenu'
import { SlotHost } from '@/plugin/SlotHost'
import { useLayoutStore, type PageVariant } from '@/stores/layoutStore'
import { useIsMobile } from '@/hooks'
import { isH5 } from '@/lib/utils'
import { getStorage, setStorage } from '@/lib/storage'
import logo from '@/assets/logo.png'

/** sidebar 宽度（PC 宽屏展开时）；与 Sidebar 组件内部 width 保持一致 */
const SIDEBAR_WIDTH = isH5() ? 260 : 420

/**
 * 页面骨架（三端一致，docs/plugin.md §3/§6）：
 *
 *   sidepanel（sidepanel.head: logo+title / 收起按钮 ｜ sidepanel.body: 章节树 ｜ sidepanel.foot）
 *   main（main.head: 面包屑(+收起态 logo) ｜ main.body: 首页内容 or editorpanel+aipanel ｜ main.foot）
 *
 * - variant 显式声明页面类型（固定页 home/editor/settings + 扩展页 custom），页面形态不再靠 props 组合推断：
 *   editor 渲染 sidepanel + editor|ai；home/settings/custom 全宽渲染 content（无侧栏）
 * - 锚点树：区块级 sidepanel/main/editorpanel/aipanel/main.body 可整体替换；
 *   head/foot 及 left/middle/right 子锚点可装饰；ctx 恒空（数据走 stores/公开 action）
 * - sidebar 折叠状态在 layoutStore：宽屏内联、窄屏浮层（遮罩 + 关闭）
 * - 面包屑在 layoutStore.breadcrumb（页面同步）
 * - 当前形态同步到 layoutStore.pageVariant（usePageVariant 供插件装饰器判断当前页面）
 */
/** 页面形态（类型定义见 stores/layoutStore，LayoutShell 收口同步到 layoutStore.pageVariant） */
export type { PageVariant }

interface LayoutShellProps {
  /** 页面类型：editor=编辑页（侧栏+编辑区+AI）；home/settings/custom=全宽内容页 */
  variant: PageVariant
  /** sidepanel 区块（编辑页：内置 Sidebar 组件，含自身 head/body/foot 锚点） */
  sidebar?: ReactNode
  /** editorpanel 区块（编辑页：内置 EditorPanel 组件） */
  editor?: ReactNode
  /** aipanel 区块（编辑页：内置 AiPanel 组件） */
  ai?: ReactNode
  /** 内容区（home/settings/custom 页面：全宽渲染） */
  content?: ReactNode
  /** main.foot 页面级内容（如版权信息；缺省时 footbar 隐藏） */
  footer?: ReactNode
  /** 浮层内容（Dialog 等，渲染在骨架最外层） */
  children?: ReactNode
}

export function LayoutShell({ variant, sidebar, editor, ai, content, footer, children }: LayoutShellProps) {
  const isMobile = useIsMobile()
  const [resizing, setResizing] = useState(false)
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen)
  const breadcrumb = useLayoutStore((s) => s.breadcrumb)
  const isEditor = variant === 'editor'

  // 页面形态同步：插件共享锚点跨页面生效，装饰器可经 usePageVariant 判断当前页。
  // 挂载时写入一次；页面从栈中恢复显示（navigateBack）时 useDidShow 重新写入（覆盖旧值）
  useEffect(() => {
    useLayoutStore.getState().setPageVariant(variant)
  }, [variant])
  useDidShow(() => {
    useLayoutStore.getState().setPageVariant(variant)
  })

  useEffect(() => {
    useLayoutStore.getState().setSidebarOpen(!isMobile)
  }, [isMobile])

  // sidebar 宽度：仅 H5 宽屏可拖拽调整（持久化）；其余场景用固定宽度
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (!isH5()) return SIDEBAR_WIDTH
    const v = parseFloat(getStorage('coeditor-sidebar-width') || '')
    return Number.isFinite(v) ? Math.min(480, Math.max(160, v)) : SIDEBAR_WIDTH
  })
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const sidebarWidthFinal = isH5() ? sidebarWidth : SIDEBAR_WIDTH

  useEffect(() => {
    if (isH5()) setStorage('coeditor-sidebar-width', sidebarWidth)
  }, [sidebarWidth])

  // H5 宽屏：sidebar | editor 之间的拖拽分隔条
  // Taro View 的 ref/事件在自定义元素上不可靠，改用 document 委托 mousedown（与点击外部收起同模式）
  useEffect(() => {
    if (!isH5() || isMobile) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('[data-sidebar-resizer]')) return
      e.preventDefault()
      setResizing(true)
      const startX = e.clientX
      const startW = sidebarWidthRef.current
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(Math.min(480, Math.max(160, startW + ev.clientX - startX)))
      }
      const onUp = () => {
        setResizing(false)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [isMobile])

  // H5 端：Taro View 的 onClick 在自定义元素上绑定不可靠（合成 click 不触发），
  // 这里在 document 上委托实现"点击 sidebar 外部区域收起"（仅竖屏生效，PC 横屏不收起）
  useEffect(() => {
    if (!isH5() || !isEditor || !isMobile) return
    const handler = (e: Event) => {
      // 不能用 e.target.closest 判断点击是否在 sidebar 内部：点击“新建章节/段落”
      // 这类交互时，React 会同步 flush 把被点的行替换成输入框，事件冒泡到
      // document 时 target 已脱离 DOM（parentNode 被置空），closest 失效，
      // 会把 sidebar 内部点击误判为外部点击而收起侧栏。
      // composedPath() 是派发时刻的快照，无论 target 是否被移除都包含完整祖先链。
      const path = (e.composedPath?.() || [])
        .filter((el): el is Element => el instanceof Element)
      if (path.some((el) => el.matches('[data-sidebar-region], [data-sidebar-open], [data-resizable-handle]'))) return
      useLayoutStore.getState().setSidebarOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [sidebar, isMobile])

  // main.head.left 的默认实现：
  // - 编辑页（isEditor）：收起态最左侧 logo（点击展开）+ 面包屑
  // - 首页/自定义页：常驻 logo（不可点）+ 品牌名/面包屑
  // 设置页/扩展页（settings/custom）：logo 点击【直达首页】（reLaunch 清栈；不做 navigateBack——
  // 从编辑页等进入时返回会退回上页而非首页，语义不符）
  const canGoHome = !isEditor && variant !== 'home'
  const goHome = () => {
    Taro.reLaunch({ url: '/pages/index/index' }).catch(() => {})
  }
  const renderMainHeadLeft = () => (
    <>
      {isEditor ? (
        <>
          {!sidebarOpen && (
            <View
              className="hover-accent"
              style={{ padding: 8, borderRadius: 8, marginRight: 4 }}
              data-sidebar-open="true"
              onClick={(e) => { e.stopPropagation(); useLayoutStore.getState().setSidebarOpen(true) }}
            >
              <Image src={logo} mode="aspectFit" style={{ width: isH5() ? 24 : 36, height: isH5() ? 24 : 36 }} />
            </View>
          )}
          {breadcrumb && (
            <View
              className="flex-1 text-sm font-medium"
              style={{
                direction: 'rtl', textAlign: 'left', paddingLeft: 12,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {breadcrumb}
            </View>
          )}
        </>
      ) : (
        <View
          className="flex items-center gap-2 font-semibold shrink-0"
          style={{ fontSize: isH5() ? 20 : 34, overflow: 'hidden', paddingLeft: isH5() ? 12 : 16 }}
        >
          <Image
            src={logo}
            mode="aspectFit"
            onClick={canGoHome ? goHome : undefined}
            style={{
              width: isH5() ? 24 : 36,
              height: isH5() ? 24 : 36,
              cursor: canGoHome ? 'pointer' : undefined,
            }}
          />
          {breadcrumb && (
            <View style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{breadcrumb}</View>
          )}
        </View>
      )}
    </>
  )

  return (
    <View className="flex flex-col" style={{ height: '100vh' }}>
      <View className="flex flex-1" style={{ minHeight: 0, flexDirection: isMobile ? 'column' : 'row' }}>
        {/* ========== sidepanel 区块（宽屏内联带宽度动画 / 窄屏浮层；无 sidepanel 时不渲染） ========== */}
        {!isMobile && isEditor && (
          <>
            <View
              className="shrink-0"
              data-sidebar-region="true"
              style={{
                width: sidebarOpen ? sidebarWidthFinal : 0,
                overflow: 'hidden',
                transition: resizing ? 'none' : 'width 0.25s ease',
              }}
            >
              <View style={{ width: sidebarWidthFinal, height: '100%' }}>
                <SlotHost slot="sidepanel" defaults={sidebar} />
              </View>
            </View>
            {sidebarOpen && (
              <View
                className="shrink-0"
                data-resizable-handle="true"
                data-sidebar-resizer="true"
                style={{ width: 4, cursor: 'col-resize', background: 'var(--border)' }}
              />
            )}
          </>
        )}
        {isMobile && sidebarOpen && isEditor && (
          <View style={{ position: 'fixed', inset: 0, zIndex: 900 }}>
            <View
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
              onClick={() => useLayoutStore.getState().setSidebarOpen(false)}
            />
            <View style={{ position: 'relative', zIndex: 1, height: '100%', width: SIDEBAR_WIDTH }} data-sidebar-region="true">
              <SlotHost slot="sidepanel" defaults={sidebar} />
            </View>
          </View>
        )}

        {/* ========== main 区块（竖屏点击外部收起 sidebar；PC 横屏不收起） ========== */}
        <SlotHost
          slot="main"
          defaults={
        <View className="flex-1 flex flex-col" style={{ minWidth: 0, minHeight: 0 }} onClick={isMobile ? () => useLayoutStore.getState().setSidebarOpen(false) : undefined}>
          {/* main.head：左=面包屑(+收起态 logo) / 中 / 右（固定高度，无边框） */}
          <SlotHost
            slot="main.head"
            defaults={
              <View className="flex items-center gap-2 shrink-0" style={{ height: isH5() ? 38 : 60, background: 'var(--muted)' }}>
                <View className="flex-1 flex items-center" style={{ minWidth: 0 }}>
                  <SlotHost slot="main.head.left" defaults={renderMainHeadLeft()} />
                </View>
                <SlotHost slot="main.head.middle" />
                <View className="flex-1" />
                <View className="flex items-center gap-1 shrink-0">
                  {/* 审阅风格只在编辑页显示 */}
                  <SlotHost slot="main.head.right" defaults={<SettingsMenu showReviewStyle={isEditor} />} />
                </View>
              </View>
            }
          />

          {/* main.body：编辑页 editor|ai（宽屏并排可拖拽 / 窄屏上下）；首页/自定义页 content 全宽 */}
          <SlotHost
            slot="main.body"
            defaults={
          <View className="flex-1 flex" style={{ minWidth: 0, minHeight: 0, flexDirection: isMobile ? 'column' : 'row', overflowY: isMobile ? 'auto' : undefined }}>
            {isEditor ? (
              isMobile ? (
                <>
                  {editor && (
                    <View style={{ borderBottom: ai ? '1px solid var(--border)' : undefined }}>
                      <SlotHost slot="editorpanel" defaults={editor} />
                    </View>
                  )}
                  {ai && (
                    <View>
                      <SlotHost slot="aipanel" defaults={ai} />
                    </View>
                  )}
                </>
              ) : editor && ai ? (
                <ResizablePanel storageKey="coeditor-editor-split" defaultRatio={0.5}>
                  <SlotHost slot="editorpanel" defaults={editor} />
                  <SlotHost slot="aipanel" defaults={ai} />
                </ResizablePanel>
              ) : (editor || ai) ? (
                <View className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
                  {editor && <SlotHost slot="editorpanel" defaults={editor} />}
                  {ai && <SlotHost slot="aipanel" defaults={ai} />}
                </View>
              ) : null
            ) : content ? (
              <View className="flex-1 flex" style={{ minHeight: 0, overflowY: 'auto' }}>{content}</View>
            ) : null}
          </View>
            }
          />

          {/* ========== main.foot（插槽 + 页面级 footer；无内容时隐藏） ========== */}
          <View className="flex items-center px-3 shrink-0" style={{ height: footer ? (isH5() ? 34 : 52) : 0, overflow: 'hidden' }}>
            <SlotHost
              slot="main.foot"
              defaults={
                <>
                  <SlotHost slot="main.foot.left" />
                  <View className="flex-1" />
                  {footer}
                  <View className="flex-1" />
                  <SlotHost slot="main.foot.middle" />
                  <SlotHost slot="main.foot.right" />
                </>
              }
            />
          </View>
        </View>
          }
        />
      </View>

      {children}
    </View>
  )
}
