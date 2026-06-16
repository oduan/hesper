import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Message, RunStep, Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { OutputBlock } from './OutputBlock'
import type { NavigationItem } from './RightNavigation'
import { RunSteps } from './RunSteps'
import { ThemedSelect } from './ThemedSelect'

export type ConversationShortcutCommand =
  | { type: 'send'; nonce: number }
  | { type: 'close-panels'; nonce: number }
  | { type: 'jump-message'; nonce: number; direction: 'previous' | 'next'; assistantOnly: boolean }

export type ConversationViewProps = {
  session: Session
  messages: Message[]
  steps: RunStep[]
  streamingText: string
  modelId: string
  modelOptions?: string[]
  onSend: (content: string) => void
  onSelectWorkspace?: () => void
  onModelChange?: (modelId: string) => void
  onOutputModeChange?: (outputMode: Session['outputMode']) => void
  shortcutCommand?: ConversationShortcutCommand
}

type AnchorEntry = {
  id: string
  kind: NavigationItem['kind']
  label: string
}

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

export function ConversationView({
  session,
  messages,
  steps,
  streamingText,
  modelId,
  modelOptions,
  onSend,
  onSelectWorkspace,
  onModelChange,
  onOutputModeChange,
  shortcutCommand
}: ConversationViewProps) {
  const [closeFullscreenSignal, setCloseFullscreenSignal] = useState(0)
  const anchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const orderedMessages = useMemo(() => sortChronologically(messages), [messages])
  const orderedSteps = useMemo(() => sortChronologically(steps), [steps])
  const anchorOrder = useMemo<AnchorEntry[]>(() => {
    const entries: AnchorEntry[] = []
    const latestUserMessageId = [...orderedMessages].reverse().find((message) => message.role === 'user')?.id

    for (const message of orderedMessages) {
      entries.push({
        id: createMessageAnchorId(message.id),
        kind: message.role === 'user' ? 'user' : 'assistant',
        label: trimLabel(message.content, message.role === 'user' ? '用户消息' : '助手输出')
      })

      if (message.id === latestUserMessageId) {
        for (const step of orderedSteps) {
          entries.push({
            id: createStepAnchorId(step.id),
            kind: createStepNavigationKind(step),
            label: trimLabel(step.summary ?? step.title, step.title)
          })
        }
      }
    }

    if (orderedMessages.length === 0) {
      for (const step of orderedSteps) {
        entries.push({
          id: createStepAnchorId(step.id),
          kind: createStepNavigationKind(step),
          label: trimLabel(step.summary ?? step.title, step.title)
        })
      }
    }

    if (streamingText) {
      entries.push({
        id: 'streaming-output',
        kind: 'assistant',
        label: trimLabel(streamingText, '流式输出')
      })
    }

    return entries
  }, [orderedMessages, orderedSteps, streamingText])
  const latestUserMessageId = [...orderedMessages].reverse().find((message) => message.role === 'user')?.id
  const jumpTargets = useMemo(
    () => anchorOrder.filter((entry) => entry.kind === 'user' || entry.kind === 'assistant'),
    [anchorOrder]
  )

  const focusAnchor = (id: string) => {
    const element = anchorRefs.current[id]
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', fontSize: 13 }}>
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
          <div style={outputModeLabelStyle}>
            <ThemedSelect
              ariaLabel="选择输出模式"
              value={session.outputMode}
              options={['markdown', 'html']}
              onChange={(value) => onOutputModeChange?.(value as Session['outputMode'])}
              minWidth={82}
              maxWidth={112}
            />
          </div>
        </header>
        <div
          className="hesper-theme-scrollbar"
          style={{
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
            const isLatestUserMessage = message.id === latestUserMessageId

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
                {isLatestUserMessage && orderedSteps.length > 0 ? (
                  <div style={{ marginTop: darkTheme.spacing.sm }}>
                    <RunSteps
                      steps={orderedSteps}
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
              </div>
            )
          })}
          {orderedMessages.length === 0 && orderedSteps.length > 0 ? (
            <RunSteps
              steps={orderedSteps}
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
          {streamingText ? (
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
        <Composer
          {...(session.workspacePath ? { workspacePath: session.workspacePath } : {})}
          modelId={modelId}
          outputMode={session.outputMode}
          {...(modelOptions ? { modelOptions } : {})}
          {...(onSelectWorkspace ? { onSelectWorkspace } : {})}
          {...(onModelChange ? { onModelChange } : {})}
          {...(onOutputModeChange ? { onOutputModeChange } : {})}
          onSend={onSend}
          sendSignal={shortcutCommand?.type === 'send' ? shortcutCommand.nonce : 0}
        />
      </section>
    </div>
  )
}

const outputModeLabelStyle = {
  position: 'absolute',
  right: 0,
  display: 'flex',
  alignItems: 'center',
  gap: darkTheme.spacing.xs,
  fontSize: 12,
  whiteSpace: 'nowrap'
} satisfies CSSProperties
