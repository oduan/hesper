import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Message, RunStep, Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { OutputBlock } from './OutputBlock'
import { RightNavigation, type NavigationItem } from './RightNavigation'
import { RunSteps } from './RunSteps'

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
  onSend: (content: string) => void
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

export function ConversationView({ session, messages, steps, streamingText, modelId, onSend, shortcutCommand }: ConversationViewProps) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [closeFullscreenSignal, setCloseFullscreenSignal] = useState(0)
  const anchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const anchorOrder = useMemo<AnchorEntry[]>(() => {
    const entries: AnchorEntry[] = []
    const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id

    for (const message of messages) {
      entries.push({
        id: createMessageAnchorId(message.id),
        kind: message.role === 'user' ? 'user' : 'assistant',
        label: trimLabel(message.content, message.role === 'user' ? '用户消息' : '助手输出')
      })

      if (message.id === latestUserMessageId) {
        for (const step of steps) {
          entries.push({
            id: createStepAnchorId(step.id),
            kind: createStepNavigationKind(step),
            label: trimLabel(step.summary ?? step.title, step.title)
          })
        }
      }
    }

    if (messages.length === 0) {
      for (const step of steps) {
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
  }, [messages, steps, streamingText])
  const navigationItems = useMemo<NavigationItem[]>(() => anchorOrder.map(({ id, kind, label }) => ({ id, kind, label })), [anchorOrder])
  const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id
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
      setNavigationOpen(false)
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
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: navigationOpen ? 'minmax(0, 1fr) 280px' : 'minmax(0, 1fr)', gap: darkTheme.spacing.md }}>
      <section
        aria-label="会话详情"
        style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gap: darkTheme.spacing.md, minWidth: 0, minHeight: 0 }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: darkTheme.spacing.md,
            borderBottom: `1px solid ${darkTheme.color.border}`,
            paddingBottom: darkTheme.spacing.sm
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.2 }}>{session.title}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: darkTheme.spacing.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" aria-label="打开导航" onClick={() => setNavigationOpen(true)} style={secondaryButtonStyle}>
              导航
            </button>
            <button type="button" aria-label="会话文档" style={secondaryButtonStyle}>
              会话文档
            </button>
            <span style={modeChipStyle}>{session.outputMode}</span>
          </div>
        </header>
        <div
          style={{
            minHeight: 0,
            overflow: 'auto',
            display: 'grid',
            alignContent: 'start',
            gap: darkTheme.spacing.md,
            paddingRight: darkTheme.spacing.xs
          }}
        >
          {messages.map((message) => {
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
                {isLatestUserMessage && steps.length > 0 ? (
                  <div style={{ marginTop: darkTheme.spacing.sm }}>
                    <RunSteps
                      steps={steps}
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
          {messages.length === 0 && steps.length > 0 ? (
            <RunSteps
              steps={steps}
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
          onSend={onSend}
          sendSignal={shortcutCommand?.type === 'send' ? shortcutCommand.nonce : 0}
        />
      </section>
      <RightNavigation
        open={navigationOpen}
        items={navigationItems}
        onClose={() => setNavigationOpen(false)}
        onNavigate={(id) => {
          setNavigationOpen(false)
          focusAnchor(id)
        }}
      />
    </div>
  )
}

const secondaryButtonStyle = {
  borderRadius: darkTheme.radius.md,
  border: `1px solid ${darkTheme.color.border}`,
  background: darkTheme.color.surfaceMuted,
  color: darkTheme.color.text,
  cursor: 'pointer',
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`
} satisfies CSSProperties

const modeChipStyle = {
  borderRadius: darkTheme.radius.xl,
  border: `1px solid ${darkTheme.color.border}`,
  background: darkTheme.color.surfaceMuted,
  color: darkTheme.color.textMuted,
  fontSize: 12,
  padding: `2px ${darkTheme.spacing.sm}`,
  textTransform: 'lowercase'
} satisfies CSSProperties
