import { ScrollView, View } from '@tarojs/components'
import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Markdown } from '@/components/markdown/Markdown'
import { SlotHost } from '@/plugin/SlotHost'
import { getPlugins } from '@/plugin'
import { useConversationStore } from '@/stores'
import { api } from '@/api/client'
import { streamAiResponse } from '@/api/stream'

import { cn, isH5 } from '@/lib/utils'
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
  autoSubmit?: boolean
  onAutoSubmitDone?: () => void
  /** PC 模式：填满容器高度、内部滚动；false（移动端）时按内容自然舒展 */
  fill?: boolean
}

export function AiPanel({ docId, selection, currentContent, isAttachment, attachmentId, isChapter, chapterId, isFullText, autoSubmit, onAutoSubmitDone, fill = true }: AiPanelProps) {
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
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)
  const [streamContent, setStreamContent] = useState('')
  const [thinkingContent, setThinkingContent] = useState('')
  // 思考过程折叠：历史答案按 answerId 记展开态；流式思考在开始输出正文后默认折叠
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})
  const [streamThinkingExpanded, setStreamThinkingExpanded] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Paragraph conversations are bucketed by the STABLE paragraphId (not
  // currentDraftId): saving a draft changes currentDraftId, which used to
  // abort the live stream and orphan the conversation bucket.
  const parentId = isFullText || isAttachment ? (attachmentId || docId) : isChapter ? (chapterId || docId) : selection ? selection.paragraphId : docId
  const parentType: ConversationType = isFullText ? 'casual' : isAttachment ? 'attachment_review' : isChapter ? 'chapter_review' : selection ? 'paragraph_review' : 'casual'
  const reviewType = isFullText ? 'fulltext' : isAttachment ? 'attachment' : isChapter ? 'chapter' : selection ? 'paragraph' : 'casual'
  const convList = conversations[parentId] || []

  // Abort in-flight stream on unmount or context switch
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const prevParentId = useRef(parentId)
  const prevParentType = useRef(parentType)
  // 上下文切换（章节/段落/附件变化）后跳过自动滚动，避免视角被拉到底部
  const skipScrollRef = useRef(false)
  useEffect(() => {
    const switched = prevParentId.current !== parentId || prevParentType.current !== parentType
    prevParentId.current = parentId
    prevParentType.current = parentType
    loadConversations(docId, parentId, parentType).catch(() => {})
    if (switched) {
      skipScrollRef.current = true
      // Cancel the in-flight stream server-side (the server keeps generating on
      // disconnect) and release the sending lock so a new message isn't dropped.
      const inFlight = inFlightTurnRef.current
      if (inFlight) {
        void api.rpc('ai.cancel', { docId: inFlight.docId, convId: inFlight.convId, turnId: inFlight.turnId }).catch(() => {})
      }
      abortRef.current?.abort()
      sendingRef.current = false
      inFlightTurnRef.current = null
      setActiveConvId(null)
      setStreaming(false)
      setStreamingConvId(null)
      setError('')
      setStreamContent('')
      setThinkingContent('')
    }
  }, [docId, parentId, parentType, loadConversations])

  useEffect(() => {
    const list = conversations[parentId] || []
    if (activeConvId && !list.some((c) => c.id === activeConvId)) {
      setActiveConvId(list.length > 0 ? list[0].id : null)
    } else if (list.length > 0 && !activeConvId) {
      setActiveConvId(list[0].id)
    }
  }, [parentId, conversations, activeConvId])

  useEffect(() => {
    if (activeConvId) {
      loadTurns(docId, activeConvId).catch(() => {})
    }
  }, [activeConvId, docId, loadTurns])

  const activeTurns: AiTurn[] = useMemo(
    () => (activeConvId ? turns[activeConvId] || [] : []),
    [activeConvId, turns],
  )

  useEffect(() => {
    // 上下文切换后保持当前滚动位置；仅正常消息更新（发送/重试/流式）时滚到底部
    if (skipScrollRef.current) {
      skipScrollRef.current = false
      return
    }
    if (isH5() && messagesEndRef.current) {
      // block: nearest 只滚动最近的可滚容器，避免带动外层页面视角
      messagesEndRef.current.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'nearest' })
    }
  }, [activeTurns, streamContent, thinkingContent, streaming])

  const toggleThinking = useCallback((answerId: string) => {
    setExpandedThinking((prev) => ({ ...prev, [answerId]: !prev[answerId] }))
  }, [])

  const startNewConversation = async () => {
    const conv = await createConversation(docId, parentType, parentId)
    setActiveConvId(conv.id)
  }

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
      | { kind: 'message'; question: string; hideQuestion?: boolean; targetConvId?: string }
      | { kind: 'retry'; turnId: string },
  ) => {
    if (sendingRef.current) return
    if (args.kind === 'message' && !args.question.trim()) return
    sendingRef.current = true
    setError('')
    setStreaming(true)
    setStreamContent('')
    setThinkingContent('')
    setStreamThinkingExpanded(false)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    let convId = args.kind === 'message' ? (args.targetConvId || activeConvId) : activeConvId
    try {
      let turnId: string
      let answerId: string | undefined
      let history: Array<{ role: string; content: string }>

      if (args.kind === 'message') {
        if (!convId) {
          const conv = await createConversation(docId, parentType, parentId)
          convId = conv.id
          setActiveConvId(convId)
        }
        setStreamingConvId(convId)

        const turn = await createTurn(docId, convId, args.question, undefined, args.hideQuestion ? false : undefined)
        turnId = turn.id
        answerId = undefined
        inFlightTurnRef.current = { docId, convId, turnId }

        const recent = (turns[convId] || []).slice(-20)
        history = buildHistory(recent)
        history.push({ role: 'user', content: args.question })
      } else {
        const turn = activeTurns.find((t) => t.id === args.turnId)
        // Stale retry target (turn or conversation gone) — nothing to do.
        if (!turn || !convId) { sendingRef.current = false; setStreaming(false); return }
        setStreamingConvId(convId)

        const currentAnswer = turn.answers[turn.currentAnswerIndex]
        // Reuse the answer slot of an empty answer (aborted first attempt)
        // instead of piling up empty entries.
        answerId = currentAnswer && !currentAnswer.content ? currentAnswer.id : undefined
        turnId = args.turnId
        inFlightTurnRef.current = { docId, convId, turnId }

        history = buildHistory(activeTurns, turnId).slice(-40)
        history.push({ role: 'user', content: turn.question.content })
      }

      if (controller.signal.aborted) return
      await streamAiResponse(
        {
          docId,
          convId,
          turnId,
          answerId,
          messages: history,
          reviewType,
          contentContext: currentContent,
        },
        {
          onThinking: setThinkingContent,
          onContent: setStreamContent,
          onError: setError,
        },
        controller.signal,
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : t("ai.requestFailed")
      setError(msg || t("error.aiRequest"))
    } finally {
      if (convId) {
        try { await loadTurns(docId, convId) } catch { /* ignore */ }
      }
      // Only clear UI state if this request is still the current one. A
      // superseded request's finally runs in a microtask AFTER the new request
      // already set streaming/refs, and must not clobber them.
      if (abortRef.current === controller) {
        inFlightTurnRef.current = null
        sendingRef.current = false
        setStreaming(false)
        setStreamingConvId(null)
        setStreamContent('')
        setThinkingContent('')
      }
    }
  }

  const sendMessage = (question: string, hideQuestion = false, targetConvId?: string) =>
    sendRequest({ kind: 'message', question, hideQuestion, targetConvId })

  const handleSend = () => {
    if (!input.trim()) return
    if (sendingRef.current) return  // locked — keep input intact
    setError('')
    const q = input.trim()
    setInput('')
    sendMessage(q)
  }

  const handleAbort = () => {
    const inFlight = inFlightTurnRef.current
    if (inFlight) {
      void api.rpc('ai.cancel', { docId: inFlight.docId, convId: inFlight.convId, turnId: inFlight.turnId })
        .catch(() => {})
    }
    abortRef.current?.abort()
    sendingRef.current = false
    setStreaming(false)
    setStreamingConvId(null)
    setStreamContent('')
    setThinkingContent('')
  }

  // Auto-submit on AI review button click
  const autoSubmitLock = useRef(false)
  const currentContentRef = useRef(currentContent)
  const activeConvIdRef = useRef(activeConvId)
  const activeTurnsRef = useRef(activeTurns)
  currentContentRef.current = currentContent
  activeConvIdRef.current = activeConvId
  activeTurnsRef.current = activeTurns

  useEffect(() => {
    if (autoSubmit && !autoSubmitLock.current) {
      // 流式进行中，不重复提交，直接完成
      if (sendingRef.current) {
        onAutoSubmitDone?.()
        return
      }
      // No draft content to review — complete immediately so the review
      // button never gets stuck in a pending state.
      if (!currentContentRef.current) {
        onAutoSubmitDone?.()
        return
      }
      autoSubmitLock.current = true
      const question = t("ai.reviewRequest")

      const doSubmit = async () => {
        try {
          const currentConvId = activeConvIdRef.current
          const currentTurns = activeTurnsRef.current

          if (!currentConvId) {
            const conv = await createConversation(docId, parentType, parentId)
            setActiveConvId(conv.id)
            await sendMessage(question, true, conv.id)
          } else if (currentTurns.length > 0) {
            const lastTurn = currentTurns[currentTurns.length - 1]
            await handleRetry(lastTurn.id)
          } else {
            setActiveConvId(currentConvId)
            await sendMessage(question, true, currentConvId)
          }
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

  const handleRetry = (turnId: string) => sendRequest({ kind: 'retry', turnId })

  // Stable handler refs for memoized turn rows: handleRetry's closure changes
  // every render, but rows only need "retry this turn" semantics.
  const handleRetryRef = useRef(handleRetry)
  handleRetryRef.current = handleRetry
  const stableRetry = useCallback((turnId: string) => handleRetryRef.current(turnId), [])
  const handleSelectAnswer = useCallback((turnId: string, index: number) => {
    void selectAnswer(docId, turnId, index).catch(() => {})
  }, [docId, selectAnswer])

  // === ai-top 插槽的默认实现 ===
  const aiTitle = isFullText ? t('ai.fulltextReview') : isAttachment ? t('ai.attachmentReview') : isChapter ? t('ai.chapterReview') : selection ? t('ai.paragraphReview') : t('ai.assistant')
  const submittedLabel = isFullText ? t('ai.submittedFulltext') : isAttachment ? t('ai.submittedAttachment') : isChapter ? t('ai.submittedChapter') : selection ? t('ai.submittedParagraph') : t('ai.question')

  const renderAiTitle = () => (
    <View className="text-sm font-medium">{aiTitle}</View>
  )

  const renderNewButton = () => (
    <Button variant="ghost" size="icon" onClick={startNewConversation}>
      <Icon name="plus" size={28} />
    </Button>
  )

  const renderConversationTabs = () => {
    if (convList.length === 0) return null
    return (
      <ScrollView scrollX className="flex" style={{ width: '100%' }}>
        {convList.map((conv, i) => (
          <View
            key={conv.id}
            className="flex items-center shrink-0"
            style={{ borderRight: '1px solid var(--border)' }}
          >
            <View
              className={cn('tab flex items-center gap-1', conv.id === activeConvId && 'active')}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <View onClick={() => setActiveConvId(conv.id)}>{t('ai.reviewOpinion', { n: i + 1 })}</View>
              <View
                className="hover-accent"
                style={{ display: 'flex', alignItems: 'center', padding: '0 2px', marginLeft: 4 }}
                onClick={async (e) => {
                  e.stopPropagation()
                  const isActive = conv.id === activeConvId
                  // 删除正在流式的会话：先取消服务端流，避免删目录后服务端 addAnswer
                  // 重建目录留下孤儿 turn，且避免配额继续消耗。
                  const inFlight = inFlightTurnRef.current
                  if (inFlight && inFlight.convId === conv.id) {
                    void api.rpc('ai.cancel', { docId: inFlight.docId, convId: inFlight.convId, turnId: inFlight.turnId }).catch(() => {})
                    abortRef.current?.abort()
                    sendingRef.current = false
                    inFlightTurnRef.current = null
                    setStreaming(false)
                    setStreamingConvId(null)
                    setStreamContent('')
                    setThinkingContent('')
                  }
                  if (isActive) setActiveConvId(null)
                  try { await deleteConversation(docId, parentId, conv.id) } catch { /* ignore */ }
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

  // === ai-bottom 插槽的默认实现 ===
  const inputPlaceholder = selection ? t('ai.reviewPlaceholder') : t('ai.questionPlaceholder')

  const renderInput = () => (
    <View className="flex-1">
      <Textarea
        className="text-sm resize-none"
        style={{ height: isH5() ? 40 : 76, minHeight: isH5() ? 40 : 76, padding: isH5() ? '10px 12px' : undefined }}
        placeholder={inputPlaceholder}
        value={input}
        onChange={setInput}
        onEnter={handleSend}
        disabled={streaming}
      />
    </View>
  )

  const renderSendButton = () => (
    <Button
      size="icon"
      className="shrink-0"
      style={{ width: isH5() ? 40 : 76, height: isH5() ? 40 : 76 }}
      onClick={streaming ? handleAbort : handleSend}
    >
      <Icon name={streaming ? 'stop' : 'send'} size={isH5() ? 18 : 28} />
    </Button>
  )

  return (
    <View className="flex flex-col" style={fill ? { flex: 1, minHeight: 0 } : undefined}>
      {/* Conversation tabs（ai-top 插槽）：默认仅渲染会话 tabs；标题/新建按钮积木保留供插件使用 */}
      {((convList.length > 0) || getPlugins().some((p) => p.ui?.slots?.['ai-top'])) && (
        <View className="shrink-0">
          <SlotHost
            slot="ai-top"
            ctx={{
              conversations: convList,
              activeConvId,
              createConversation: startNewConversation,
              renderTitle: renderAiTitle,
              renderNewButton,
              renderConversationTabs,
            }}
            defaults={renderConversationTabs()}
          />
        </View>
      )}

      {/* Messages */}
      <ScrollView
        className="flex-1 p-3"
        scrollY
        scrollWithAnimation
        style={{ minHeight: 0 }}
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
          />
        ))}

        {/* Streaming indicator */}
        {streaming && streamingConvId === activeConvId && (thinkingContent || streamContent) && (
          <View className="bubble-ai">
            {thinkingContent && (
              <View className="mb-2">
                <View
                  className="text-xs text-muted"
                  style={{ marginBottom: 4 }}
                  onClick={() => setStreamThinkingExpanded((v) => !v)}
                >
                  {streamContent ? t('ai.thinking') : t('ai.thinkingInProgress')}{' '}
                  {(!streamContent || streamThinkingExpanded) ? '▾' : '▸'}
                </View>
                {(!streamContent || streamThinkingExpanded) && (
                  <View className="thinking-box">{thinkingContent}</View>
                )}
              </View>
            )}
            {streamContent && (
              <Markdown content={streamContent} />
            )}
          </View>
        )}

        <View ref={messagesEndRef as React.Ref<HTMLDivElement>} style={{ height: 4 }} />
      </ScrollView>

      {/* Input（ai-bottom 插槽） */}
      <View className="p-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <View className="flex gap-2">
          <SlotHost
            slot="ai-bottom"
            ctx={{
              streaming,
              send: handleSend,
              abort: handleAbort,
              placeholder: inputPlaceholder,
              renderInput,
              renderSendButton,
            }}
            defaults={<>{renderInput()}{renderSendButton()}</>}
          />
        </View>
      </View>
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
}

/** One question/answers turn. Memoized so streaming chunks (which re-render
 * the panel per chunk) don't re-render every finished turn's Markdown. */
const TurnRow = memo(function TurnRow({
  turn, streaming, thinkingExpanded, submittedLabel, onRetry, onToggleThinking, onSelectAnswer,
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

      {turn.answers.map((answer, ai) => (
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
          </View>
        </View>
      ))}

      <View className="flex items-center gap-2 ml-1 mb-1">
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
  )
})
