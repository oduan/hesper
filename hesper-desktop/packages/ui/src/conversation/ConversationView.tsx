import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Message, RunStep, Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { OutputBlock } from './OutputBlock'
import { RightNavigation, type NavigationItem } from './RightNavigation'
import { RunSteps } from './RunSteps'

export type ConversationViewProps = {
  session: Session
  messages: Message[]
  steps: RunStep[]
  streamingText: string
  modelId: string
  onSend: (content: string) => void
}

type JumpDirection = 'previous' | 'next'

type JumpDetail = {
  direction: JumpDirection
  assistantOnly: boolean
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

export function ConversationView({ session, messages, steps, streamingText, modelId, onSend }: ConversationViewProps) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const anchorRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const anchorOrder = useMemo<AnchorEntry[]>(() => {
    const messageEntries: AnchorEntry[] = messages.map((message) => ({
      id: `message-${message.id}`,
      kind: message.role === 'user' ? 'user' : 'assistant',
      label: trimLabel(message.content, message.role === 'user' ? '用户消息' : '助手输出')
    }))
    const stepEntries: AnchorEntry[] = steps.map((step) => ({
      id: `step-${step.id}`,
      kind: createStepNavigationKind(step),
      label: trimLabel(step.summary ?? step.title, step.title)
    }))

    return [...messageEntries, ...stepEntries]
  }, [messages, steps])

  const navigationItems = useMemo<NavigationItem[]>(() => anchorOrder.map(({ id, kind, label }) => ({ id, kind, label })), [anchorOrder])
  const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id
  const jumpTargets = useMemo(
    () =>
      anchorOrder
        .filter((entry) => entry.kind === 'user' || entry.kind === 'assistant')
        .filter((entry) => entry.kind === 'assistant' || !streamingText || entry.id !== 'streaming-output'),
    [anchorOrder, streamingText]
  )

  const scrollToAnchor = (id: string) => {
    anchorRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  useEffect(() => {
    const handleClosePanels = () => setNavigationOpen(false)
    const handleJumpMessage = (event: Event) => {
      const detail = (event as CustomEvent<JumpDetail>).detail
      if (!detail) {
        return
      }

      const targets = jumpTargets.filter((entry) => (detail.assistantOnly ? entry.kind === 'assistant' : true))
      if (targets.length === 0) {
        return
      }

      const activeId = targets.find((entry) => {
        const element = anchorRefs.current[entry.id]
        return element?.contains(document.activeElement) || document.activeElement === element
      })?.id
      const currentIndex = activeId ? targets.findIndex((entry) => entry.id === activeId) : -1
      const nextIndex = detail.direction === 'previous'
        ? (currentIndex <= 0 ? targets.length - 1 : currentIndex - 1)
        : (currentIndex === -1 || currentIndex >= targets.length - 1 ? 0 : currentIndex + 1)

      const next = targets[nextIndex]
      if (!next) {
        return
      }

      const element = anchorRefs.current[next.id]
      element?.focus({ preventScroll: true })
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    window.addEventListener('hesper:close-panels', handleClosePanels)
    window.addEventListener('hesper:jump-message', handleJumpMessage as EventListener)
    return () => {
      window.removeEventListener('hesper:close-panels', handleClosePanels)
      window.removeEventListener('hesper:jump-message', handleJumpMessage as EventListener)
    }
  }, [jumpTargets])

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
            const anchorId = `message-${message.id}`
            const isLatestUserMessage = message.id === latestUserMessageId

            return (
              <div
                key={message.id}
                ref={(node) => {
                  anchorRefs.current[anchorId] = node
                }}
                tabIndex={-1}
                style={{ outline: 'none' }}
              >
                {message.role === 'assistant' ? (
                  <OutputBlock content={message.content} contentType={message.contentType} />
                ) : (
                  <MessageBubble message={message} />
                )}
                {isLatestUserMessage && steps.length > 0 ? (
                  <div
                    ref={(node) => {
                      anchorRefs.current['step-cluster'] = node
                    }}
                    tabIndex={-1}
                    style={{ outline: 'none', marginTop: darkTheme.spacing.sm }}
                  >
                    <RunSteps steps={steps} />
                  </div>
                ) : null}
              </div>
            )
          })}
          {messages.length === 0 && steps.length > 0 ? <RunSteps steps={steps} /> : null}
          {steps.map((step) => (
            <div
              key={step.id}
              ref={(node) => {
                anchorRefs.current[`step-${step.id}`] = node
              }}
              tabIndex={-1}
              style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', outline: 'none' }}
              aria-hidden="true"
            />
          ))}
          {streamingText ? (
            <div
              ref={(node) => {
                anchorRefs.current['streaming-output'] = node
              }}
              tabIndex={-1}
              style={{ outline: 'none' }}
            >
              <OutputBlock content={streamingText} contentType={session.outputMode} />
            </div>
          ) : null}
        </div>
        <Composer
          {...(session.workspacePath ? { workspacePath: session.workspacePath } : {})}
          modelId={modelId}
          outputMode={session.outputMode}
          onSend={onSend}
        />
      </section>
      <RightNavigation
        open={navigationOpen}
        items={navigationItems}
        onClose={() => setNavigationOpen(false)}
        onNavigate={(id) => {
          setNavigationOpen(false)
          scrollToAnchor(id)
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
