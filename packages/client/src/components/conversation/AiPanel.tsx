import { ScrollView, View } from '@tarojs/components'
import { memo, useCallback, useEffect, useMemo, useState, useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Markdown } from '@/components/markdown/Markdown'
import { SlotHost } from '@/plugin/SlotHost'
import { TabContextMenu, type TabMenuState } from '@/components/ui/TabContextMenu'
import { useConversationStore, useAiInputStore, useReviewStore } from '@/stores'
import { bus } from '@/plugin/bus'
import { api } from '@/api/client'
import { streamAiResponse } from '@/api/stream'

import { cn, formatDateTime, isH5 } from '@/lib/utils'
import { useIsMobile } from '@/hooks'
import { useT } from '@/lib/i18n'
import { showErrorToast } from '@/lib/toast'
import type { AiTurn, ConversationType } from '@coeditor/shared'

interface AiPanelProps {
  docId: string
  selection: { chapterId: string; paragraphId: string } | null
  currentContent: string
  isAttachment?: boolean
  attachmentId?: string
  isChapter?: boolean
  chapterId?: string
  isFullText?: boolean
  /** 当前草稿版本 id（段落/附件场景）：会话按 draftVersion 分桶（draft:conversation 1:N） */
  draftId?: string
  autoSubmit?: boolean
  onAutoSubmitDone?: () => void
}

export function AiPanel({ docId, selection, currentContent, isAttachment, attachmentId, isChapter, chapterId, isFullText, draftId, autoSubmit, onAutoSubmitDone }: AiPanelProps) {
  const t = useT()
  const conversations = useConversationStore((s) => s.conversations)
  const turns = useConversationStore((s) => s.turns)
  const loadConversations = useConversationStore((s) => s.loadConversations)
  const createConversation = useConversationStore((s) => s.createConversation)
  const deleteConversation = useConversationStore((s) => s.deleteConversation)
  const loadTurns = useConversationStore((s) => s.loadTurns)
  const createTurn = useConversationStore((s) => s.createTurn)
  const selectAnswer = useConversationStore((s) => s.selectAnswer)

  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const input = useAiInputStore((s) => s.input)
  const setInput = useAiInputStore((s) => s.setInput)
  // 流式状态按会话（convId）独立：支持多个并发审阅各自打字机；切 tab 只换显示、
  // 不中断进行中的生成。用组件内 state（而非 zustand）是因为 flushSync 只对
  // React setState 强制同步渲染——zustand 更新会被 React 批处理合并（打字机失效）。
  const [streams, setStreams] = useState<Record<string, { streaming: boolean; content: string; thinking: string }>>({})
  const setStream = (convId: string, patch: Partial<{ streaming: boolean; content: string; thinking: string }>) => {
    setStreams((prev) => ({
      ...prev,
      [convId]: { ...(prev[convId] ?? { streaming: false, content: '', thinking: '' }), ...patch },
    }))
  }
  const clearStream = (convId: string) => {
    setStreams((prev) => {
      if (!prev[convId]) return prev
      const next = { ...prev }
      delete next[convId]
      return next
    })
  }
  // 切换文档：流式状态整体清空
  useEffect(() => {
    setStreams({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])
  // 思考过程折叠：历史答案按 answerId 记展开态；流式思考在开始输出正文后默认折叠
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})
  const [streamThinkingExpanded, setStreamThinkingExpanded] = useState(false)
  const [error, setError] = useState('')
  // tab 右键菜单（关闭右侧/关闭其它；H5 only）
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null)
  // 正在原地重新生成的 turn：重试时先隐藏旧气泡，新内容在旧气泡位置流式输出
  const [retryingTurns, setRetryingTurns] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // 每个会话独立的 in-flight 流（controller + 归属 turn）
  const inflightRef = useRef<Record<string, { controller: AbortController; docId: string; turnId: string }>>({})
  // 当前激活会话的流式状态（渲染用；切 tab 只是 activeConvId 变化，各会话流状态独立保留）
  const activeStream = activeConvId ? streams[activeConvId] : undefined
  const streaming = activeStream?.streaming ?? false
  const streamContent = activeStream?.content ?? ''
  const thinkingContent = activeStream?.thinking ?? ''
  // 吸底跟随：仅当用户停留在输出底部 10px 内才自动跟随滚动；用户滚离底部后
  // 解除吸底（不再把视角拉回底部），滚回底部 10px 内自动恢复。由滚动事件维护，
  // 避免内容增长时把"原本就在底部"误判成"用户已离开底部"。
  const stickToBottomRef = useRef(true)

  // Paragraph conversations are bucketed by the STABLE paragraphId (not
  // currentDraftId): saving a draft changes currentDraftId, which used to
  // abort the live stream and orphan the conversation bucket.
  const parentId = isFullText || isAttachment ? (attachmentId || docId) : isChapter ? (chapterId || docId) : selection ? selection.paragraphId : docId
  const parentType: ConversationType = isFullText ? 'casual' : isAttachment ? 'attachment_review' : isChapter ? 'chapter_review' : selection ? 'paragraph_review' : 'casual'
  const reviewType = isFullText ? 'fulltext' : isAttachment ? 'attachment' : isChapter ? 'chapter' : selection ? 'paragraph' : 'casual'
  // draft:conversation 1:N：段落/附件会话按当前草稿版本分桶（保存=新版本=切会话窗口）
  const bucketId = draftId || parentId
  const convList = conversations[bucketId] || []

  // 离开页面：只放弃前端流式跟踪（abort 所有 in-flight），不取消服务端生成
  // （服务端继续生成并持久化，下次进入 loadTurns 可看到完整结果）。
  useEffect(() => {
    return () => {
      for (const k of Object.keys(inflightRef.current)) {
        inflightRef.current[k]?.controller.abort()
      }
      setStreams({})
    }
  }, [])

  const prevParentId = useRef(parentId)
  const prevParentType = useRef(parentType)
  // 上下文切换（章节/段落/附件变化）后跳过自动滚动，避免视角被拉到底部
  const skipScrollRef = useRef(false)
  useEffect(() => {
    const switched = prevParentId.current !== parentId || prevParentType.current !== parentType
    prevParentId.current = parentId
    prevParentType.current = parentType
    loadConversations(docId, parentId, parentType, draftId).catch(() => {})
    if (switched) {
      skipScrollRef.current = true
      // 切换 tab 只换显示：进行中的流（含其他会话的并发流）不受影响，
      // 切回时打字机继续；仅重置当前视图的激活会话与错误。
      setActiveConvId(null)
      setError('')
    }
  }, [docId, parentId, parentType, draftId, loadConversations])

  useEffect(() => {
    // 会话按 bucketId（draftId || parentId）分桶，自动选中逻辑必须查同一桶
    const list = conversations[bucketId] || []
    if (activeConvId && !list.some((c) => c.id === activeConvId)) {
      setActiveConvId(list.length > 0 ? list[0].id : null)
    } else if (list.length > 0 && !activeConvId) {
      setActiveConvId(list[0].id)
    }
  }, [bucketId, conversations, activeConvId])

  useEffect(() => {
    if (activeConvId) {
      loadTurns(docId, activeConvId).catch(() => {})
    }
  }, [activeConvId, docId, loadTurns])

  // tab 右键菜单（H5）：右键命中会话 tab 行 → 打开菜单（位置=光标，index=展示顺序）。
  // 作用域限定在 conv-tab-bar 内，避免与草稿版本 tab 的右键菜单互相干扰。
  useEffect(() => {
    if (!isH5()) return
    const onContextMenu = (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest?.('.conv-tab-bar .tab-row') as HTMLElement | null
      if (!row) return
      const bar = row.closest('.conv-tab-bar')
      if (!bar) return
      const rows = Array.from(bar.querySelectorAll('.tab-row'))
      const index = rows.indexOf(row)
      if (index < 0) return
      e.preventDefault()
      setTabMenu({ x: e.clientX, y: e.clientY, index, stage: 'menu', action: 'right' })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  const activeTurns: AiTurn[] = useMemo(
    () => (activeConvId ? turns[activeConvId] || [] : []),
    [activeConvId, turns],
  )

  // H5：监听 AI 对话区的滚动，维护吸底状态（用户滚离底部 10px 外则停止跟随）
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  // 从末尾占位元素向上找最近的滚动容器（taro-scroll-view-core，overflow-y: auto/scroll）
  const findScrollContainer = useCallback((): HTMLElement | null => {
    const end = messagesEndRef.current
    if (!end) return null
    let node: HTMLElement | null = end.parentElement
    while (node) {
      const ov = getComputedStyle(node).overflowY
      if (ov === 'auto' || ov === 'scroll') return node
      node = node.parentElement
    }
    return null
  }, [])
  useEffect(() => {
    if (!isH5()) return
    let container: HTMLElement | null = null
    let userScrolling = false
    let disposed = false
    const markUserScroll = () => { userScrolling = true }
    const onScroll = () => {
      if (!container) return
      // 仅用户主动滚动（wheel/touch/pointerdown 标记）才更新吸底状态；
      // 内容变化（流式气泡消失/落盘重建）引发的布局滚动（scrollTop 被浏览器 clamp
      // 到底部）不更新——否则流结束瞬间内容变矮 clamp 会误判"用户回到底部"，
      // 随后落盘内容变高 → 视角被突然拽到底部。
      if (!userScrolling) return
      userScrolling = false
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 10
      stickToBottomRef.current = atBottom
    }
    const attach = (): boolean => {
      const found = findScrollContainer()
      if (!found) return false
      container = found
      scrollContainerRef.current = found
      // 仅"用户主动滚动"（滚轮/触摸/按下拖动，含滚动条）才解除吸底；
      // 程序化滚动（scrollTop 赋值，含其触发的 scroll 事件）只恢复吸底、不解除，
      // 避免初始加载/消息更新的滚动动画把吸底状态误判成"用户滚离底部"。
      found.addEventListener('wheel', markUserScroll, { passive: true })
      found.addEventListener('touchmove', markUserScroll, { passive: true })
      found.addEventListener('pointerdown', markUserScroll, { passive: true })
      found.addEventListener('scroll', onScroll, { passive: true })
      return true
    }
    if (!attach()) {
      // AI 面板可能晚于挂载渲染（ResizablePanel 等），首帧找不到容器时延迟重试
      const retry = setTimeout(() => { if (!disposed) attach() }, 300)
      return () => { disposed = true; clearTimeout(retry) }
    }
    return () => {
      disposed = true
      scrollContainerRef.current = null
      if (container) {
        container.removeEventListener('wheel', markUserScroll)
        container.removeEventListener('touchmove', markUserScroll)
        container.removeEventListener('pointerdown', markUserScroll)
        container.removeEventListener('scroll', onScroll)
      }
    }
  }, [findScrollContainer])

  // 流结束瞬间不强制吸底：避免输出完成时视角被突然拽到底部
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    const streamJustEnded = wasStreamingRef.current && !streaming
    wasStreamingRef.current = streaming
    // 上下文切换后保持当前滚动位置；仅正常消息更新（发送/流式）时滚到底部
    if (skipScrollRef.current) {
      skipScrollRef.current = false
      return
    }
    if (streamJustEnded) return
    // 吸底跟随：仅当用户仍停留在底部 10px 内才滚动到底部（AI 输出不锁定视角）；
    // 用户滚离底部后不再强制吸底，滚回底部后自动恢复跟随（由上面的 scroll 监听维护）。
    // 直接设置容器 scrollTop 滚到内容末尾（scrollIntoView(nearest) 会被容器 padding
    // 顶起 ~12px，超出 10px 吸底判定，导致跟随时"永远差一点"）。
    // 容器可能尚未被监听 effect 找到（首帧/懒加载），这里兜底查找。
    let container = scrollContainerRef.current
    if (!container && isH5()) {
      container = findScrollContainer()
      if (container) scrollContainerRef.current = container
    }
    if (isH5() && container && stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [activeTurns, streamContent, thinkingContent, streaming, findScrollContainer])

  const toggleThinking = useCallback((answerId: string) => {
    setExpandedThinking((prev) => ({ ...prev, [answerId]: !prev[answerId] }))
  }, [])

  const buildHistory = (turnsToUse: AiTurn[], upToTurnId?: string): Array<{ role: string; content: string }> => {
    const history: Array<{ role: string; content: string }> = []
    for (const t of turnsToUse) {
      if (upToTurnId && t.id === upToTurnId) break
      history.push({ role: 'user', content: t.question.content })
      const ans = t.answers[t.currentAnswerIndex]
      if (ans?.content) history.push({ role: 'assistant', content: ans.content })
    }
    return history
  }

  const sendingRef = useRef(false)
  const inFlightTurnRef = useRef<{ docId: string; convId: string; turnId: string } | null>(null)

  /**
   * Single send primitive shared by "send message" and "retry". They differ
   * only in setup (new turn vs. rebuilding history from an existing turn);
   * streaming, error handling and cleanup are shared here so both paths get
   * the same superseded-request guard in `finally`.
   */
  const sendRequest = async (
    args:
      | { kind: 'message'; question: string; hideQuestion?: boolean; targetConvId?: string; focus?: string; review?: boolean }
      | { kind: 'retry'; turnId: string; focus?: string; review?: boolean },
  ) => {
    if (args.kind === 'message' && !args.question.trim()) return
    setError('')
    setStreamThinkingExpanded(false)

    let reviewFailed = false
    let convId = args.kind === 'message' ? (args.targetConvId || activeConvId) : activeConvId
    // 同一会话已有进行中的流 → 忽略重复提交（不同会话可并发）
    if (convId && inflightRef.current[convId]) return
    let turnId = ''
    try {
      let answerId: string | undefined
      let history: Array<{ role: string; content: string }>

      if (args.kind === 'message') {
        if (!convId) {
          const conv = await createConversation(docId, parentType, parentId, draftId,
            parentType === 'paragraph_review' ? selection?.chapterId : undefined)
          convId = conv.id
          setActiveConvId(convId)
        }
        const turn = await createTurn(docId, convId, args.question, undefined, args.hideQuestion ? false : undefined)
        turnId = turn.id
        answerId = undefined

        const recent = (turns[convId] || []).slice(-20)
        history = buildHistory(recent)
        history.push({ role: 'user', content: args.question })
      } else {
        const turn = activeTurns.find((t) => t.id === args.turnId)
        // Stale retry target (turn or conversation gone) — nothing to do.
        if (!turn || !convId) return

        const currentAnswer = turn.answers[turn.currentAnswerIndex]
        // 重新生成 = 原地替换：始终复用当前 answer 槽位（服务端按 existingAnswerId
        // 原地更新），旧气泡在重试开始即被隐藏，新内容在原位流式输出。
        answerId = currentAnswer ? currentAnswer.id : undefined
        turnId = args.turnId
        // 标记该 turn 正在重新生成：隐藏旧气泡（TurnRow 原位渲染流式内容）
        setRetryingTurns((prev) => {
          if (prev.has(turnId)) return prev
          const next = new Set(prev)
          next.add(turnId)
          return next
        })

        history = buildHistory(activeTurns, turnId).slice(-40)
        history.push({ role: 'user', content: turn.question.content })
      }

      // 注册本会话的 in-flight 流（per-conv，互不干扰）
      const controller = new AbortController()
      inflightRef.current[convId!] = { controller, docId, turnId }
      setStream(convId!, { streaming: true, content: '', thinking: '' })
      // 发送消息即"想看输出"：强制恢复吸底（新会话/内容重建可能把滚动位置重置到顶部）；
      // 用户中途滚离底部后仍可解除（scroll 监听）。
      stickToBottomRef.current = true

      await streamAiResponse(
        {
          docId,
          convId,
          turnId,
          answerId,
          messages: history,
          reviewType,
          reviewFocus: args.focus,
        },
        {
          onThinking: (text) => {
            // React 18 自动批处理会把流式循环中连续到来的 setState 合并成一次渲染，
            // 导致打字机效果丢失。H5 端把 setState 包进 flushSync 强制同步刷新。
            const update = () => setStream(convId!, { thinking: text })
            if (isH5()) flushSync(update)
            else update()
          },
          onContent: (text) => {
            const update = () => setStream(convId!, { content: text })
            if (isH5()) flushSync(update)
            else update()
          },
          onError: setError,
        },
        controller.signal,
      )
    } catch (err: unknown) {
      reviewFailed = true
      // 中止（用户停止/离开页面）不是正常完成；finally 按 review:failed 复位
      if (err instanceof Error && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : t("ai.requestFailed")
      setError(msg || t("error.aiRequest"))
    } finally {
      if (convId) {
        try { await loadTurns(docId, convId) } catch { /* ignore */ }
        delete inflightRef.current[convId]
        // 流结束：保留 content 快照但停止流式渲染（气泡由 turns 渲染）
        setStream(convId, { streaming: false })
        // 重试结束：解除原位流式渲染（turns 已刷新为替换后的答案）
        if (turnId) {
          setRetryingTurns((prev) => {
            if (!prev.has(turnId)) return prev
            const next = new Set(prev)
            next.delete(turnId)
            return next
          })
        }
        // 审阅流结束/失败事件（插件据此复位 UI 状态，docs/plugin.md §5）
        if (args.review) {
          bus.emit(reviewFailed ? 'review:failed' : 'review:completed', { turnId, focus: args.focus })
        }
      }
    }
  }

  const sendMessage = (question: string, hideQuestion = false, targetConvId?: string, focus?: string, review = false) =>
    sendRequest({ kind: 'message', question, hideQuestion, targetConvId, focus, review })

  const handleSend = () => {
    if (!input.trim()) return
    if (activeConvId && inflightRef.current[activeConvId]) return  // 该会话流式进行中
    setError('')
    const q = input.trim()
    setInput('')
    sendMessage(q)
  }

  const handleAbort = () => {
    // 停止按钮：只取消当前激活会话的流（用户主动操作）
    const convId = activeConvId
    const inFlight = convId ? inflightRef.current[convId] : undefined
    if (inFlight && convId) {
      void api.rpc('ai.cancel', { docId: inFlight.docId, convId, turnId: inFlight.turnId })
        .catch(() => {})
      inFlight.controller.abort()
      delete inflightRef.current[convId]
      setStream(convId, { streaming: false })
    }
  }

  // 注册发送/中止实现到 aiInputStore（插件替换输入框/发送按钮时共用协议）
  const inputPlaceholder = selection ? t('ai.reviewPlaceholder') : t('ai.questionPlaceholder')
  useEffect(() => {
    useAiInputStore.getState().registerControls({ send: handleSend, abort: handleAbort })
    useAiInputStore.getState().setPlaceholder(inputPlaceholder)
  })

  // Auto-submit on AI review button click
  const autoSubmitLock = useRef(false)
  const currentContentRef = useRef(currentContent)
  currentContentRef.current = currentContent

  useEffect(() => {
    if (autoSubmit && !autoSubmitLock.current) {
      // 审阅总是新开会话（可与其他会话并发流式）；无内容则不提交
      // No draft content to review — complete immediately so the review
      // button never gets stuck in a pending state.
      if (!currentContentRef.current) {
        bus.emit('review:failed', {})
        onAutoSubmitDone?.()
        return
      }
      autoSubmitLock.current = true
      const question = t("ai.reviewRequest")
      // 审阅维度（若有）：一次性消费，随 ai.chat 请求下发（reviewFocus）
      const focus = useReviewStore.getState().consumeFocus() ?? undefined

      const doSubmit = async () => {
        try {
          // 审阅总是新开会话窗口（不再复用/重试旧会话）：
          // 每次审阅针对当前草稿内容独立成会话，便于对比不同版本的审阅意见。
          const conv = await createConversation(docId, parentType, parentId, draftId,
            parentType === 'paragraph_review' ? selection?.chapterId : undefined)
          setActiveConvId(conv.id)
          await sendMessage(question, true, conv.id, focus, true)
        } catch (err) {
          // createConversation (or anything above) rejected: surface it and
          // make sure the review button is never stuck in a pending state.
          console.error('[AiPanel] auto submit failed', err)
          showErrorToast(t('error.aiRequest'))
        } finally {
          autoSubmitLock.current = false
          onAutoSubmitDone?.()
        }
      }
      doSubmit()
    }
    if (!autoSubmit) autoSubmitLock.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit])

  const handleRetry = (turnId: string, focus?: string, review?: boolean) =>
    sendRequest({ kind: 'retry', turnId, focus, review })

  // Stable handler refs for memoized turn rows: handleRetry's closure changes
  // every render, but rows only need "retry this turn" semantics.
  const handleRetryRef = useRef(handleRetry)
  handleRetryRef.current = handleRetry
  const stableRetry = useCallback((turnId: string) => handleRetryRef.current(turnId), [])
  const handleSelectAnswer = useCallback((turnId: string, index: number) => {
    void selectAnswer(docId, turnId, index).catch(() => {})
  }, [docId, selectAnswer])

  // === aipanel 默认实现 ===
  const submittedLabel = isFullText ? t('ai.submittedFulltext') : isAttachment ? t('ai.submittedAttachment') : isChapter ? t('ai.submittedChapter') : selection ? t('ai.submittedParagraph') : t('ai.question')

  /** 关闭单个会话：先取消进行中的流（避免删目录后服务端 addAnswer 重建孤儿 turn），再删除 */
  const closeConversation = useCallback(async (convId: string) => {
    const inFlight = inflightRef.current[convId]
    if (inFlight) {
      void api.rpc('ai.cancel', { docId: inFlight.docId, convId, turnId: inFlight.turnId }).catch(() => {})
      inFlight.controller.abort()
      delete inflightRef.current[convId]
      clearStream(convId)
    }
    if (activeConvId === convId) setActiveConvId(null)
    try { await deleteConversation(docId, parentId, convId, draftId) } catch { /* ignore */ }
  }, [activeConvId, clearStream, deleteConversation, docId, draftId, parentId])

  // 右键菜单动作（index 为展示顺序下标；确认后执行）
  const closeRight = useCallback((index: number) => {
    for (let i = index + 1; i < convList.length; i++) void closeConversation(convList[i].id)
  }, [convList, closeConversation])
  const closeOthers = useCallback((index: number) => {
    for (let i = 0; i < convList.length; i++) if (i !== index) void closeConversation(convList[i].id)
  }, [convList, closeConversation])

  const renderConversationTabs = () => {
    if (convList.length === 0) return null
    return (
      <ScrollView scrollX className="flex conv-tab-bar" style={{ width: '100%' }}>
        {convList.map((conv, _i) => (
          <View
            key={conv.id}
            className="flex items-end shrink-0"
            style={{ borderRight: '1px solid var(--border)' }}
          >
            <View
              className={cn('tab flex items-center gap-1 tab-row', conv.id === activeConvId && 'active')}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <View onClick={() => setActiveConvId(conv.id)}>{formatDateTime(conv.timeCreated)}</View>
              <View
                className="hover-accent"
                style={{ display: 'flex', alignItems: 'center', padding: '0 2px', marginLeft: 4 }}
                onClick={(e) => {
                  e.stopPropagation()
                  void closeConversation(conv.id)
                }}
              >
                <Icon name="close" size={14} color="var(--muted-fg)" />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    )
  }


  // 移动端（竖向排列）高度由内容撑开；PC 用 flex 撑满
  const isMobile = useIsMobile()

  // === aipanel.foot 默认实现（输入/发送；受控协议在 aiInputStore） ===
  const renderInput = () => {
    const placeholder = useAiInputStore.getState().placeholder
    return (
      <View className="flex-1">
        <Textarea
          autoHeight={isH5()}
          className={cn('text-sm resize-none', isH5() && 'ai-panel-input')}
          // H5：不锁固定高度（会挡住内部自动长高），用 minHeight + maxHeight——
          // 内部 textarea 靠 field-sizing/autoHeight 随输入自然长高，达 ~5 行（max-height 120px）后内部滚动
          style={isH5()
            ? { minHeight: 38, maxHeight: 120, padding: '6px 10px', boxSizing: 'border-box' }
            : { height: 60, minHeight: 60 }}
          placeholder={placeholder}
          value={input}
          onChange={setInput}
          onEnter={handleSend}
          disabled={streaming}
          maxLength={50000}
        />
      </View>
    )
  }

  const renderSendButton = () => (
    <Button
      size="icon"
      className="shrink-0"
      style={{ width: isH5() ? 38 : 60, height: isH5() ? 38 : 60 }}
      onClick={streaming ? handleAbort : handleSend}
    >
      <Icon name={streaming ? 'stop' : 'send'} size={isH5() ? 18 : 28} />
    </Button>
  )

  // 当前激活会话的流式 turn：若该 turn 在"重新生成"（原地替换）中，
  // 流式内容渲染在 turn 行内（隐藏旧气泡），底部流式指示器不再重复出现。
  const inFlightTurnId = activeConvId ? inflightRef.current[activeConvId]?.turnId : undefined
  const retryStreaming = inFlightTurnId ? retryingTurns.has(inFlightTurnId) : false

  // 流式气泡（含思考折叠开关）：底部指示器与重新生成的原位渲染共用
  const renderStreamingBubble = (content: string, thinking: string) => (
    <View className="bubble-ai">
      {thinking && (
        <View className="mb-2">
          <View
            className="text-xs text-muted"
            style={{ marginBottom: 4 }}
            onClick={() => setStreamThinkingExpanded((v) => !v)}
          >
            {content ? t('ai.thinking') : t('ai.thinkingInProgress')}{' '}
            {(!content || streamThinkingExpanded) ? '▾' : '▸'}
          </View>
          {(!content || streamThinkingExpanded) && (
            <View className="thinking-box">{thinking}</View>
          )}
        </View>
      )}
      {content && (
        <Markdown content={content} />
      )}
    </View>
  )

  return (
    <View className="flex flex-col" style={isMobile ? undefined : { flex: 1, minHeight: 0 }}>
      {/* aipanel.head：左=留空 / 中=AI conversation tabs（左对齐，贴底）/ 右=留空（固定高度，无边框） */}
      <SlotHost
        slot="aipanel.head"
        defaults={
          <View className="flex items-end gap-2 shrink-0" style={{ height: isH5() ? 30 : 50 }}>
            <SlotHost slot="aipanel.head.left" />
            {/* middle 必须 flex-1 + minWidth:0：会话 tab 多时由内部 ScrollView scrollX 横向滚动，
                而不是把 flex 布局撑破产生页面级横向滚动条（H5/wxapp 均适用） */}
            <View className="flex-1" style={{ minWidth: 0 }}>
              <SlotHost
                slot="aipanel.head.middle"
                defaults={convList.length > 0 ? renderConversationTabs() : undefined}
              />
            </View>
            <SlotHost slot="aipanel.head.right" />
          </View>
        }
      />

      {/* aipanel.body：对话气泡区（可滚动） */}
      <SlotHost
        slot="aipanel.body"
        defaults={
      <ScrollView
        className={cn('p-3', !isMobile && 'flex-1')}
        scrollY
        scrollWithAnimation
        style={{ minHeight: 0, boxSizing: 'border-box', border: '1px solid var(--border)' }}
      >
        {error && (
          <View className="mb-2" style={{ background: 'rgba(176,74,56,0.1)', border: '1px solid rgba(176,74,56,0.3)', borderRadius: 12, padding: 16 }}>
            <View className="font-medium mb-1 text-destructive">{t("ai.requestFailed")}</View>
            <View className="text-destructive" style={{ opacity: 0.8 }}>{error}</View>
            <View className="text-xs underline mt-1 text-destructive" onClick={() => setError('')}> {t("common.close")} </View>
          </View>
        )}

        {!activeConvId && !activeTurns.length && !error && (
          <View className="flex items-start justify-center text-muted" style={{ paddingTop: 100 }}>
            <View className="text-sm font-medium">{t('ai.assistant')}</View>
          </View>
        )}

        {activeTurns.map((turn) => (
          <TurnRow
            key={turn.id}
            turn={turn}
            streaming={streaming}
            thinkingExpanded={expandedThinking}
            submittedLabel={submittedLabel}
            onRetry={stableRetry}
            onToggleThinking={toggleThinking}
            onSelectAnswer={handleSelectAnswer}
            // 重新生成的 turn：把流式内容原位渲染在旧气泡位置（隐藏旧答案）
            retryStream={retryStreaming && inFlightTurnId === turn.id
              ? renderStreamingBubble(streamContent, thinkingContent)
              : undefined}
          />
        ))}

        {/* Streaming indicator：当前激活会话的流式气泡（各会话独立，切回即继续）。
            重新生成时由 TurnRow 原位渲染，底部不再重复出现。 */}
        {streaming && !retryStreaming && (thinkingContent || streamContent) && (
          renderStreamingBubble(streamContent, thinkingContent)
        )}

        <View ref={messagesEndRef as React.Ref<HTMLDivElement>} style={{ height: 4 }} />
      </ScrollView>
        }
      />

      {/* aipanel.foot：middle=输入框，right=发送/停止按钮（受控协议在 aiInputStore） */}
      <SlotHost
        slot="aipanel.foot"
        defaults={
          <View className="flex items-center gap-2 shrink-0" style={{ height: isH5() ? 38 : 60 }}>
            <SlotHost slot="aipanel.foot.left" />
            <View className="flex-1">
              <SlotHost slot="aipanel.foot.middle" defaults={renderInput()} />
            </View>
            <SlotHost slot="aipanel.foot.right" defaults={renderSendButton()} />
          </View>
        }
      />

      {/* 会话 tab 右键菜单（关闭右侧/关闭其它，二次确认） */}
      <TabContextMenu
        state={tabMenu}
        total={convList.length}
        noun={t('tabMenu.nounConversation')}
        onChange={setTabMenu}
        onCloseRight={closeRight}
        onCloseOthers={closeOthers}
      />
    </View>
  )
}

interface TurnRowProps {
  turn: AiTurn
  streaming: boolean
  thinkingExpanded: Record<string, boolean>
  submittedLabel: string
  onRetry: (turnId: string) => void
  onToggleThinking: (answerId: string) => void
  onSelectAnswer: (turnId: string, index: number) => void
  /** 重新生成中的流式气泡（原位渲染，隐藏旧答案；undefined=正常渲染） */
  retryStream?: ReactNode
}

/** One question/answers turn. Memoized so streaming chunks (which re-render
 * the panel per chunk) don't re-render every finished turn's Markdown. */
const TurnRow = memo(function TurnRow({
  turn, streaming, thinkingExpanded, submittedLabel, onRetry, onToggleThinking, onSelectAnswer, retryStream,
}: TurnRowProps) {
  const t = useT()
  const showQuestion = turn.question.questionVisible !== false

  return (
    <View className="mb-2">
      {showQuestion ? (
        <View className="flex justify-end mb-2">
          <View className="bubble-user">{turn.question.content}</View>
        </View>
      ) : (
        <View className="flex justify-center mb-2">
          <View className="bubble-note">{submittedLabel}</View>
        </View>
      )}

      {retryStream ? retryStream : turn.answers.map((answer, ai) => (
        <View
          key={answer.id}
          className={cn('mb-2', ai !== turn.currentAnswerIndex && 'hidden')}
        >
          <View className="bubble-ai">
            {answer.thinking && (
              <View className="mb-2">
                <View
                  className="text-xs text-muted"
                  style={{ marginBottom: 4 }}
                  onClick={() => onToggleThinking(answer.id)}
                >
                  {t('ai.thinking')} {thinkingExpanded[answer.id] ? '▾' : '▸'}
                </View>
                {thinkingExpanded[answer.id] && (
                  <View className="thinking-box">{answer.thinking}</View>
                )}
              </View>
            )}
            <Markdown content={answer.content} />
            {/* AI 生成免责声明：每个 answer 正文下方、操作行（重试按钮）上方（弱化不喧宾夺主；中英随语言切换） */}
            <View className="text-xs text-muted" style={{ opacity: 0.5, paddingTop: 8 }}>
              {t('ai.disclaimer')}
            </View>
            {/* 操作行：候选切换靠左，重试按钮靠右，均与气泡边缘对齐 */}
            <View className="flex items-center gap-2" style={{ marginTop: 8 }}>
              {turn.answers.length > 1 && (
                <View className="flex items-center gap-1 text-xs text-muted">
                  <View
                    style={{ padding: '0 4px' }}
                    onClick={() => onSelectAnswer(turn.id, (turn.currentAnswerIndex - 1 + turn.answers.length) % turn.answers.length)}
                  >
                    {'<'}
                  </View>
                  <View className="tabular-nums">{turn.currentAnswerIndex + 1}/{turn.answers.length}</View>
                  <View
                    style={{ padding: '0 4px' }}
                    onClick={() => onSelectAnswer(turn.id, (turn.currentAnswerIndex + 1) % turn.answers.length)}
                  >
                    {'>'}
                  </View>
                </View>
              )}
              <View className="flex-1" />
              <View
                style={{ padding: 4, opacity: streaming ? 0.5 : 1 }}
                onClick={streaming ? undefined : () => onRetry(turn.id)}
              >
                <Icon name="refresh" size={24} color="var(--muted-fg)" />
              </View>
            </View>
          </View>
        </View>
      ))}
    </View>
  )
})
