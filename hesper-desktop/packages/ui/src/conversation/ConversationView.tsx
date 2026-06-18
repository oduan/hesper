import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react'
import type { Message, RunStep, Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import { Composer, type ModelOptionGroup } from './Composer'
import { MessageBubble } from './MessageBubble'
import { OutputBlock } from './OutputBlock'
import type { NavigationItem } from './RightNavigation'
import { RunSteps } from './RunSteps'

export type ConversationShortcutCommand =
  | { type: 'send'; nonce: number }
  | { type: 'close-panels'; nonce: number }
  | { type: 'jump-message'; nonce: number; direction: 'previous' | 'next'; assistantOnly: boolean }

export type ConversationViewProps = {
  session: Session
  messages: Message[]
  steps: RunStep[]
  stepsByRun?: Record<string, RunStep[]>
  streamingText: string
  streamingByRun?: Record<string, string>
  modelId: string
  modelOptions?: string[]
  modelOptionGroups?: ModelOptionGroup[]
  onSend: (content: string) => void
  onSelectWorkspace?: () => void
  onModelChange?: (modelId: string) => void
  shortcutCommand?: ConversationShortcutCommand
}

type AnchorEntry = {
  id: string
  kind: NavigationItem['kind']
  label: string
}

let globalCtrlWheelListenerInstalled = false

function ensureGlobalCtrlWheelListener() {
  if (globalCtrlWheelListenerInstalled || typeof window === 'undefined') {
    return
  }

  window.addEventListener('wheel', (event) => {
    if (!(event.ctrlKey || event.metaKey) || (event.deltaX === 0 && event.deltaY === 0)) {
      return
    }

    const target = getElementTarget(event.target)
    const fullscreenRoot = target?.closest('[data-hesper-fullscreen-output="true"]')
    if (fullscreenRoot instanceof HTMLElement) {
      const fullscreenScroller = fullscreenRoot.querySelector<HTMLElement>('[data-hesper-fullscreen-output-scroll="true"]')
      if (!fullscreenScroller) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      scrollElementByDelta(fullscreenScroller, event.deltaX, event.deltaY)
      return
    }

    const root = target?.closest('[data-hesper-conversation-root="true"]')
    if (!(root instanceof HTMLElement)) {
      return
    }

    const scroller = root.querySelector<HTMLElement>('[data-hesper-message-list="true"]')
    if (!scroller) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    scrollElementByDelta(scroller, event.deltaX, event.deltaY)
    scroller.dispatchEvent(new Event('scroll', { bubbles: false }))
  }, { capture: true, passive: false })
  globalCtrlWheelListenerInstalled = true
}

ensureGlobalCtrlWheelListener()

function trimLabel(value: string, fallback: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact ? compact.slice(0, 80) : fallback
}

function createStepNavigationKind(step: RunStep): NavigationItem['kind'] {
  if (step.type === 'warning' || step.status === 'failed') {
    return 'warning'
  }

  return step.type === 'tool_call' || step.type === 'tool_result' ? 'tool' : 'assistant'
}

function hasToolCallStep(steps: RunStep[]): boolean {
  return steps.some((step) => step.type === 'tool_call')
}

function createMessageAnchorId(messageId: string): string {
  return `message-${messageId}`
}

function createStepAnchorId(stepId: string): string {
  return `step-${stepId}`
}

function compareCreatedAt<T extends { id: string; createdAt: string }>(left: T, right: T): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

function sortChronologically<T extends { id: string; createdAt: string }>(items: T[]): T[] {
  return [...items].sort(compareCreatedAt)
}

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24
}

function getElementTarget(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null
}

function isInsideOutputScrollArea(target: EventTarget | null): boolean {
  return Boolean(getElementTarget(target)?.closest('[data-hesper-output-scroll="true"]'))
}

function isInsideFullscreenOutput(target: EventTarget | null): boolean {
  return Boolean(getElementTarget(target)?.closest('[data-hesper-fullscreen-output="true"]'))
}

function scrollElementByDelta(element: HTMLElement, deltaX: number, deltaY: number): void {
  element.scrollTop += deltaY
  element.scrollLeft += deltaX
}

export function ConversationView({
  session,
  messages,
  steps,
  stepsByRun,
  streamingText,
  streamingByRun,
  modelId,
  modelOptions,
  modelOptionGroups,
  onSend,
  onSelectWorkspace,
  onModelChange,
  shortcutCommand
}: ConversationViewProps) {
  const [closeFullscreenSignal, setCloseFullscreenSignal] = useState(0)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  ensureGlobalCtrlWheelListener()
  const anchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottomRef = useRef(true)
  const didMeasureContentRef = useRef(false)
  const orderedMessages = useMemo(() => sortChronologically(messages), [messages])
  const orderedSteps = useMemo(() => sortChronologically(steps), [steps])
  const orderedStepsByRun = useMemo(() => {
    if (!stepsByRun) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(stepsByRun).map(([runId, runSteps]) => [runId, sortChronologically(runSteps)])
    )
  }, [stepsByRun])
  const finalOutputRunIds = useMemo(() => new Set(
    orderedMessages.flatMap((message) => (
      message.role === 'assistant' && message.runId && message.content.trim() ? [message.runId] : []
    ))
  ), [orderedMessages])
  const latestUserMessageId = [...orderedMessages].reverse().find((message) => message.role === 'user')?.id
  const getMessageSteps = (message: Message): RunStep[] => {
    if (message.role !== 'user') {
      return []
    }

    if (message.runId) {
      return orderedStepsByRun[message.runId] ?? []
    }

    return message.id === latestUserMessageId ? orderedSteps : []
  }
  const getMessageStreamingText = (message: Message): string => {
    if (message.role !== 'user' || !message.runId) {
      return ''
    }

    return streamingByRun?.[message.runId] ?? ''
  }
  const anchorOrder = useMemo<AnchorEntry[]>(() => {
    const entries: AnchorEntry[] = []

    for (const message of orderedMessages) {
      entries.push({
        id: createMessageAnchorId(message.id),
        kind: message.role === 'user' ? 'user' : 'assistant',
        label: trimLabel(message.content, message.role === 'user' ? '用户消息' : '助手输出')
      })

      const messageSteps = getMessageSteps(message)
      if (hasToolCallStep(messageSteps)) {
        for (const step of messageSteps) {
          entries.push({
            id: createStepAnchorId(step.id),
            kind: createStepNavigationKind(step),
            label: trimLabel(step.summary ?? step.title, step.title)
          })
        }
      }

      const messageStreamingText = getMessageStreamingText(message)
      if (messageStreamingText) {
        entries.push({
          id: `streaming-output-${message.runId}`,
          kind: 'assistant',
          label: trimLabel(messageStreamingText, '流式输出')
        })
      }
    }

    if (orderedMessages.length === 0 && hasToolCallStep(orderedSteps)) {
      for (const step of orderedSteps) {
        entries.push({
          id: createStepAnchorId(step.id),
          kind: createStepNavigationKind(step),
          label: trimLabel(step.summary ?? step.title, step.title)
        })
      }
    }

    if (streamingText && !Object.values(streamingByRun ?? {}).includes(streamingText)) {
      entries.push({
        id: 'streaming-output',
        kind: 'assistant',
        label: trimLabel(streamingText, '流式输出')
      })
    }

    return entries
  }, [orderedMessages, orderedSteps, orderedStepsByRun, streamingByRun, streamingText])
  const jumpTargets = useMemo(
    () => anchorOrder.filter((entry) => entry.kind === 'user' || entry.kind === 'assistant'),
    [anchorOrder]
  )
  const contentSignature = useMemo(() => JSON.stringify({
    messages: orderedMessages.map((message) => [message.id, message.role, message.content, message.runId, message.createdAt]),
    steps: orderedSteps.map((step) => [step.id, step.status, step.summary, step.title, step.createdAt]),
    stepsByRun: Object.entries(orderedStepsByRun).map(([runId, runSteps]) => [runId, runSteps.map((step) => [step.id, step.status, step.summary, step.title, step.createdAt])]),
    streamingText,
    streamingByRun: Object.entries(streamingByRun ?? {})
  }), [orderedMessages, orderedSteps, orderedStepsByRun, streamingByRun, streamingText])

  const focusAnchor = (id: string) => {
    const element = anchorRefs.current[id]
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const element = messagesScrollRef.current
    if (!element) {
      return
    }

    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior })
    } else {
      element.scrollTop = element.scrollHeight
    }
    pinnedToBottomRef.current = true
    setShowJumpToBottom(false)
  }

  const updateMessagesScrollState = useCallback(() => {
    const element = messagesScrollRef.current
    if (!element) {
      return
    }

    const atBottom = isNearScrollBottom(element)
    pinnedToBottomRef.current = atBottom
    if (atBottom) {
      setShowJumpToBottom(false)
    }
  }, [])

  const scrollMessagesByDelta = useCallback((deltaX: number, deltaY: number) => {
    const element = messagesScrollRef.current
    if (!element || (deltaX === 0 && deltaY === 0)) {
      return
    }

    scrollElementByDelta(element, deltaX, deltaY)
    updateMessagesScrollState()
  }, [updateMessagesScrollState])

  const handleMessagesScroll = () => {
    updateMessagesScrollState()
  }

  const handleMessagesWheelCapture = (event: WheelEvent<HTMLDivElement>) => {
    if (isInsideFullscreenOutput(event.target)) {
      return
    }

    if (isInsideOutputScrollArea(event.target) && !event.ctrlKey && !event.metaKey) {
      return
    }

    if (event.deltaX === 0 && event.deltaY === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    scrollMessagesByDelta(event.deltaX, event.deltaY)
  }

  useEffect(() => {
    if (!shortcutCommand) {
      return
    }

    if (shortcutCommand.type === 'close-panels') {
      setCloseFullscreenSignal((value) => value + 1)
      return
    }

    if (shortcutCommand.type === 'jump-message') {
      const targets = jumpTargets.filter((entry) => (shortcutCommand.assistantOnly ? entry.kind === 'assistant' : true))
      if (targets.length === 0) {
        return
      }

      const activeId = targets.find((entry) => {
        const element = anchorRefs.current[entry.id]
        return element?.contains(document.activeElement) || document.activeElement === element
      })?.id
      const currentIndex = activeId ? targets.findIndex((entry) => entry.id === activeId) : -1
      const nextIndex = shortcutCommand.direction === 'previous'
        ? (currentIndex <= 0 ? targets.length - 1 : currentIndex - 1)
        : (currentIndex === -1 || currentIndex >= targets.length - 1 ? 0 : currentIndex + 1)

      const next = targets[nextIndex]
      if (next) {
        focusAnchor(next.id)
      }
    }
  }, [jumpTargets, shortcutCommand])

  useEffect(() => {
    const element = messagesScrollRef.current
    if (!element) {
      return
    }

    if (!didMeasureContentRef.current) {
      didMeasureContentRef.current = true
      pinnedToBottomRef.current = isNearScrollBottom(element)
      return
    }

    if (pinnedToBottomRef.current) {
      scrollMessagesToBottom('auto')
    } else {
      setShowJumpToBottom(true)
    }
  }, [contentSignature])

  return (
    <div data-hesper-conversation-root="true" style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', fontSize: 13 }}>
      <section
        aria-label="会话详情"
        style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gap: darkTheme.spacing.md, minWidth: 0, minHeight: 0 }}
      >
        <header
          style={{
            position: 'relative',
            minHeight: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <h2 style={{ margin: 0, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, lineHeight: 1.2, textAlign: 'center', fontWeight: 700 }}>{session.title}</h2>
        </header>
        <div style={messagesAreaStyle}>
          <div
            ref={messagesScrollRef}
            aria-label="消息列表"
            className="hesper-theme-scrollbar"
            data-hesper-message-list="true"
            onScroll={handleMessagesScroll}
            onWheelCapture={handleMessagesWheelCapture}
            style={{
              height: '100%',
              minHeight: 0,
              overflow: 'auto',
              display: 'grid',
              alignContent: 'start',
              gap: darkTheme.spacing.md,
              paddingRight: darkTheme.spacing.xs
            }}
          >
            {orderedMessages.map((message) => {
            const anchorId = createMessageAnchorId(message.id)
            const messageSteps = getMessageSteps(message)
            const messageStreamingText = getMessageStreamingText(message)
            const streamingAnchorId = message.runId ? `streaming-output-${message.runId}` : 'streaming-output'

            return (
              <div
                key={message.id}
                id={anchorId}
                data-anchor-id={anchorId}
                ref={(node) => {
                  anchorRefs.current[anchorId] = node
                }}
                tabIndex={-1}
                style={{ outline: 'none' }}
              >
                {message.role === 'assistant' ? (
                  <OutputBlock
                    content={message.content}
                    contentType={message.contentType}
                    closeFullscreenSignal={closeFullscreenSignal}
                  />
                ) : (
                  <MessageBubble message={message} />
                )}
                {hasToolCallStep(messageSteps) ? (
                  <div style={{ marginTop: darkTheme.spacing.sm }}>
                    <RunSteps
                      steps={messageSteps}
                      autoExpanded={message.role === 'user' && (!message.runId || !finalOutputRunIds.has(message.runId))}
                      getStepProps={(step) => {
                        const stepAnchorId = createStepAnchorId(step.id)
                        return {
                          id: stepAnchorId,
                          tabIndex: -1,
                          'data-anchor-id': stepAnchorId,
                          ref: (node) => {
                            anchorRefs.current[stepAnchorId] = node
                          }
                        }
                      }}
                    />
                  </div>
                ) : null}
                {messageStreamingText ? (
                  <div
                    id={streamingAnchorId}
                    data-anchor-id={streamingAnchorId}
                    ref={(node) => {
                      anchorRefs.current[streamingAnchorId] = node
                    }}
                    tabIndex={-1}
                    style={{ marginTop: darkTheme.spacing.sm, outline: 'none' }}
                  >
                    <OutputBlock
                      content={messageStreamingText}
                      contentType={session.outputMode}
                      closeFullscreenSignal={closeFullscreenSignal}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
          {orderedMessages.length === 0 && hasToolCallStep(orderedSteps) ? (
            <RunSteps
              steps={orderedSteps}
              autoExpanded
              getStepProps={(step) => {
                const stepAnchorId = createStepAnchorId(step.id)
                return {
                  id: stepAnchorId,
                  tabIndex: -1,
                  'data-anchor-id': stepAnchorId,
                  ref: (node) => {
                    anchorRefs.current[stepAnchorId] = node
                  }
                }
              }}
            />
          ) : null}
            {streamingText && !Object.values(streamingByRun ?? {}).includes(streamingText) ? (
              <div
                id="streaming-output"
                data-anchor-id="streaming-output"
                ref={(node) => {
                  anchorRefs.current['streaming-output'] = node
                }}
                tabIndex={-1}
                style={{ outline: 'none' }}
              >
                <OutputBlock
                  content={streamingText}
                  contentType={session.outputMode}
                  closeFullscreenSignal={closeFullscreenSignal}
                />
              </div>
            ) : null}
          </div>
          {showJumpToBottom ? (
            <button type="button" aria-label="滚动到底部" onClick={() => scrollMessagesToBottom('smooth')} style={jumpToBottomButtonStyle}>
              <svg aria-hidden="true" viewBox="0 0 24 24" style={jumpToBottomIconStyle}>
                <path d="M12 5v12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="m6.5 11.5 5.5 5.5 5.5-5.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
        <Composer
          {...(session.workspacePath ? { workspacePath: session.workspacePath } : {})}
          modelId={modelId}
          {...(modelOptions ? { modelOptions } : {})}
          {...(modelOptionGroups ? { modelOptionGroups } : {})}
          {...(onSelectWorkspace ? { onSelectWorkspace } : {})}
          {...(onModelChange ? { onModelChange } : {})}
          onSend={onSend}
          sendSignal={shortcutCommand?.type === 'send' ? shortcutCommand.nonce : 0}
        />
      </section>
    </div>
  )
}

const messagesAreaStyle = {
  position: 'relative',
  minHeight: 0,
  overflow: 'hidden'
} satisfies CSSProperties

const jumpToBottomButtonStyle = {
  position: 'absolute',
  right: 16,
  bottom: 16,
  width: 38,
  height: 38,
  border: 0,
  outline: 0,
  borderRadius: 999,
  background: 'rgba(127, 158, 232, 0.26)',
  color: darkTheme.color.text,
  display: 'inline-grid',
  placeItems: 'center',
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.32)',
  cursor: 'pointer',
  zIndex: 2
} satisfies CSSProperties

const jumpToBottomIconStyle = {
  width: 21,
  height: 21,
  display: 'block'
} satisfies CSSProperties
