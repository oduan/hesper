import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { AgentRun, Message, RunStep, RunStepStatus, WorkerAgentInvocation } from '@hesper/shared'
import { darkTheme } from '../theme'
import { MarkdownOutput } from './MarkdownOutput'
import { RunningStatusIcon } from './RunningStatusIcon'
import { WorkerAgentRunViewer } from './WorkerAgentRunViewer'

export type WorkerAgentView = {
  invocationsByParentStepId: Record<string, WorkerAgentInvocation>
  runsById: Record<string, AgentRun>
  stepsByRun: Record<string, RunStep[]>
  messagesByRun: Record<string, Message[]>
  streamingByRun: Record<string, string>
}

export type RunStepsProps = {
  steps: RunStep[]
  autoExpanded?: boolean
  runStartedAt?: string | undefined
  runEndedAt?: string | undefined
  workerAgentView?: WorkerAgentView | undefined
  getStepProps?: (step: RunStep) => {
    id?: string
    tabIndex?: number
    ref?: (node: HTMLLIElement | null) => void
    ['data-anchor-id']?: string
  }
}

const statusLabels: Record<RunStepStatus, string> = {
  pending: '待处理',
  running: '运行中',
  succeeded: '成功',
  failed: '失败'
}

function compareCreatedAt(left: RunStep, right: RunStep): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

function getStatusColor(status: RunStepStatus): string {
  switch (status) {
    case 'succeeded':
      return darkTheme.color.success
    case 'failed':
      return darkTheme.color.danger
    case 'running':
      return darkTheme.color.accent
    case 'pending':
      return darkTheme.color.textMuted
  }
}

type StepDisplayParts = {
  primary: string
  secondary: string[]
}

function uniqueParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  return parts.flatMap((part) => {
    const normalized = part?.replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) return []
    seen.add(normalized)
    return [normalized]
  })
}

function createToolIntent(step: RunStep): string {
  return step.summary?.replace(/\s+/g, ' ').trim() || step.title
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const secondsText = String(seconds).padStart(2, '0')

  if (hours > 0) {
    return `${hours}小时${String(minutes).padStart(2, '0')}分${secondsText}秒`
  }

  if (totalMinutes > 0) {
    return `${totalMinutes}分${secondsText}秒`
  }

  return `${seconds}秒`
}

function firstToolCallStep(steps: RunStep[]): RunStep | undefined {
  return steps.find((step) => step.type === 'tool_call')
}

function useElapsedLabel(startedAt: string | undefined, endedAt: string | undefined): string | undefined {
  const startMs = parseTimestamp(startedAt)
  const endMs = parseTimestamp(endedAt)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (startMs === undefined || endMs !== undefined) return

    setNowMs(Date.now())
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [startMs, endMs])

  if (startMs === undefined) return undefined

  return formatElapsedTime(Math.max(0, (endMs ?? nowMs) - startMs))
}

type ToolStepDetailPayload = {
  kind?: unknown
  toolId?: unknown
  toolIcon?: unknown
  input?: unknown
  output?: unknown
  isError?: unknown
}

function parseStructuredToolStepDetail(detail: string | undefined): ToolStepDetailPayload | undefined {
  if (!detail?.trim()) return undefined
  try {
    const parsed = JSON.parse(detail) as ToolStepDetailPayload
    if (parsed && typeof parsed === 'object' && parsed.kind === 'tool_call') {
      return parsed
    }
  } catch {
    return undefined
  }
  return undefined
}

function getToolStepDetailPayload(step: RunStep): ToolStepDetailPayload | undefined {
  if (step.type !== 'tool_call') return undefined
  return parseStructuredToolStepDetail(step.detail)
}

function formatJsonValue(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

function formatOutputValue(value: unknown): string {
  if (typeof value === 'string') return value
  return formatJsonValue(value)
}

function createStepDisplayParts(step: RunStep): StepDisplayParts {
  if (step.type === 'thought' && step.summary) {
    return {
      primary: step.summary,
      secondary: uniqueParts([step.detail]).filter((part) => part !== step.summary)
    }
  }

  const primary = step.title
  const shouldHideStructuredToolDetail = step.type === 'tool_call' && parseStructuredToolStepDetail(step.detail) !== undefined
  return {
    primary,
    secondary: uniqueParts([step.summary, shouldHideStructuredToolDetail ? undefined : step.detail]).filter((part) => part !== primary)
  }
}

function CompletedStatusIcon({ status }: { status: 'succeeded' | 'failed' }) {
  const isSucceeded = status === 'succeeded'
  const color = getStatusColor(status)
  return (
    <span
      aria-label={`步骤状态：${statusLabels[status]}`}
      data-step-status-icon={isSucceeded ? 'success-check' : 'failed-cross'}
      style={statusIconSlotStyle}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block', color }}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d={isSucceeded ? 'M5.2 8.1 7.1 10 10.9 5.8' : 'M5.5 5.5 10.5 10.5M10.5 5.5 5.5 10.5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function ToolSuccessIcon({ icon }: { icon: string }) {
  return (
    <span
      aria-label="步骤状态：成功"
      data-step-status-icon="tool-success-icon"
      style={toolSuccessIconSlotStyle}
    >
      <span aria-hidden="true" style={toolSuccessIconTextStyle}>{icon}</span>
    </span>
  )
}

function PendingStatusIcon() {
  return (
    <span
      aria-label={`步骤状态：${statusLabels.pending}`}
      style={{
        ...pendingStatusIconStyle,
        background: getStatusColor('pending'),
        boxShadow: `0 0 0 3px ${getStatusColor('pending')}22`
      }}
    />
  )
}

function StatusDot({ step }: { step: RunStep }) {
  if (step.status === 'running') return <RunningStatusIcon ariaLabel={`步骤状态：${statusLabels.running}`} />
  if (step.status === 'failed') return <CompletedStatusIcon status="failed" />
  if (step.status === 'succeeded') {
    const payload = getToolStepDetailPayload(step)
    const toolIcon = typeof payload?.toolIcon === 'string' ? payload.toolIcon : undefined
    if (step.type === 'tool_call' && toolIcon) return <ToolSuccessIcon icon={toolIcon} />
    return <CompletedStatusIcon status="succeeded" />
  }
  return <PendingStatusIcon />
}

function createStepMarkdown(step: RunStep): string {
  return step.detail?.trim() || step.summary?.trim() || step.title
}

function ToolDetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={toolDetailBlockStyle}>
      <h3 style={toolDetailTitleStyle}>{title}</h3>
      {children}
    </section>
  )
}

function ToolStepDetails({ step }: { step: RunStep }) {
  const payload = getToolStepDetailPayload(step) ?? { input: {} }
  const hasOutput = Object.prototype.hasOwnProperty.call(payload, 'output')
  const outputText = hasOutput ? formatOutputValue(payload.output) : undefined

  return (
    <div style={toolDetailGridStyle}>
      <ToolDetailBlock title="Input">
        <pre style={toolDetailPreStyle}>{formatJsonValue(payload.input)}</pre>
      </ToolDetailBlock>
      <ToolDetailBlock title="Output">
        {hasOutput ? (
          typeof payload.output === 'string' ? (
            outputText ? <MarkdownOutput content={outputText} /> : <pre style={toolDetailPreStyle}>{outputText}</pre>
          ) : (
            <pre style={toolDetailPreStyle}>{outputText}</pre>
          )
        ) : (
          <p style={toolDetailEmptyStyle}>{step.status === 'running' ? '等待工具返回…' : '暂无输出'}</p>
        )}
      </ToolDetailBlock>
    </div>
  )
}

function StepFullscreenDialog({ step, workerAgentView, onClose }: { step: RunStep; workerAgentView?: WorkerAgentView | undefined; onClose: () => void }) {
  const markdown = createStepMarkdown(step)
  const toolDetailPayload = getToolStepDetailPayload(step)
  const workerInvocation = step.type === 'tool_call' ? workerAgentView?.invocationsByParentStepId[step.id] : undefined
  const workerRun = workerInvocation?.childRunId ? workerAgentView?.runsById[workerInvocation.childRunId] : undefined
  const workerSteps = workerInvocation?.childRunId ? workerAgentView?.stepsByRun[workerInvocation.childRunId] ?? [] : []
  const workerMessages = workerInvocation?.childRunId ? workerAgentView?.messagesByRun[workerInvocation.childRunId] ?? [] : []
  const workerStreamingText = workerInvocation?.childRunId ? workerAgentView?.streamingByRun[workerInvocation.childRunId] ?? '' : ''

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={workerInvocation ? 'Worker Agent 执行详情' : '步骤全屏查看'}
      data-hesper-fullscreen-output="true"
      style={stepFullscreenOverlayStyle}
    >
      <div aria-label="步骤详情内容" style={stepFullscreenShellStyle}>
        <div aria-label="步骤详情操作" style={stepFullscreenActionsStyle}>
          <button type="button" aria-label="关闭步骤详情" onClick={onClose} style={stepFullscreenIconButtonStyle}>
            <svg aria-hidden="true" viewBox="0 0 24 24" style={stepFullscreenIconStyle}>
              <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          aria-label="步骤详情滚动区"
          className="hesper-theme-scrollbar"
          data-hesper-fullscreen-output-scroll="true"
          style={stepFullscreenScrollAreaStyle}
        >
          <article aria-label="步骤详情正文" style={stepFullscreenBodyStyle}>
            {workerInvocation ? (
              <WorkerAgentRunViewer
                invocation={workerInvocation}
                run={workerRun}
                steps={workerSteps}
                messages={workerMessages}
                streamingText={workerStreamingText}
              />
            ) : toolDetailPayload ? (
              <ToolStepDetails step={step} />
            ) : (
              <MarkdownOutput content={markdown} />
            )}
          </article>
        </div>
      </div>
    </div>
  )
}

export function RunSteps({ steps, autoExpanded = false, runStartedAt, runEndedAt, workerAgentView, getStepProps }: RunStepsProps) {
  const [expanded, setExpanded] = useState(autoExpanded)
  const [activeStep, setActiveStep] = useState<RunStep>()
  const orderedSteps = useMemo(() => [...steps].sort(compareCreatedAt), [steps])
  const firstTool = firstToolCallStep(orderedSteps)
  const elapsedLabel = useElapsedLabel(runStartedAt, runEndedAt)

  useEffect(() => {
    setExpanded(autoExpanded)
  }, [autoExpanded])

  useEffect(() => {
    if (activeStep && !orderedSteps.some((step) => step.id === activeStep.id)) {
      setActiveStep(undefined)
    }
  }, [activeStep, orderedSteps])

  if (!firstTool && !runStartedAt) {
    return null
  }

  const summary = firstTool ? createToolIntent(firstTool) : undefined

  return (
    <section
      aria-label="步骤流"
      style={{
        display: 'grid',
        gap: darkTheme.spacing.sm,
        borderStyle: 'none',
        background: 'transparent',
        padding: darkTheme.spacing.md
      }}
    >
      <style>{stepRowHoverCss}</style>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value: boolean) => !value)}
        style={{
          ...summaryButtonStyle,
          gridTemplateColumns: elapsedLabel ? summaryRowColumnsWithTimer : summaryRowColumns
        }}
      >
        <span aria-hidden="true" style={chevronStyle}>{expanded ? '▾' : '▸'}</span>
        <span style={countBadgeStyle}>{orderedSteps.length}</span>
        {elapsedLabel ? (
          <span aria-label={`已执行 ${elapsedLabel}`} data-hesper-run-elapsed="true" style={elapsedTimeStyle}>{elapsedLabel}</span>
        ) : null}
        {summary ? <span style={summaryTextStyle}>{summary}</span> : null}
      </button>
      {expanded ? (
        <ul style={listStyle}>
          {orderedSteps.map((step) => {
            const stepProps = getStepProps?.(step)
            const parts = createStepDisplayParts(step)
            return (
              <li
                key={step.id}
                {...stepProps}
                style={stepListItemStyle}
              >
                <button
                  type="button"
                  aria-label={`查看步骤详情：${parts.primary}`}
                  data-hesper-step-row-button="true"
                  onClick={() => setActiveStep(step)}
                  style={stepRowButtonStyle}
                >
                  <span aria-hidden="true" />
                  <StatusDot step={step} />
                  <span data-hesper-step-row-text="true" style={stepTextStyle}>
                    <span style={primarySegmentStyle}>{parts.primary}</span>
                    {parts.secondary.map((part) => (
                      <span key={part}>
                        <span aria-hidden="true" style={mutedSeparatorStyle}> · </span>
                        <span style={mutedSegmentStyle}>{part}</span>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {activeStep ? <StepFullscreenDialog step={activeStep} workerAgentView={workerAgentView} onClose={() => setActiveStep(undefined)} /> : null}
    </section>
  )
}

const stepRowHoverCss = `
[data-hesper-step-row-button]:hover [data-hesper-step-row-text],
[data-hesper-step-row-button]:focus-visible [data-hesper-step-row-text] {
  text-decoration: underline;
  text-underline-offset: 3px;
}
`

const rowColumns = '16px 28px minmax(0, 1fr)'
const summaryRowColumns = '18px 28px minmax(0, 1fr)'
const summaryRowColumnsWithTimer = '18px 28px auto minmax(0, 1fr)'
const summaryControlGap = 5

const summaryButtonStyle: CSSProperties = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: summaryRowColumns,
  alignItems: 'center',
  columnGap: summaryControlGap,
  border: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left'
}

const chevronStyle: CSSProperties = {
  color: darkTheme.color.textMuted,
  fontSize: 16,
  lineHeight: 1,
  justifySelf: 'center'
}

const countBadgeStyle: CSSProperties = {
  minWidth: 28,
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: darkTheme.typography.body,
  borderRadius: darkTheme.radius.sm,
  border: `1px solid ${darkTheme.color.border}`,
  color: darkTheme.color.textMuted,
  padding: '0 7px'
}

const elapsedTimeStyle: CSSProperties = {
  color: darkTheme.color.textMuted,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap'
}

const summaryTextStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: darkTheme.typography.body
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: darkTheme.spacing.sm
}

const statusIconSlotStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: 'inline-grid',
  placeItems: 'center',
  alignSelf: 'center',
  justifySelf: 'center'
}

const toolSuccessIconSlotStyle: CSSProperties = {
  ...statusIconSlotStyle,
  fontSize: 15,
  lineHeight: 1,
  filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.20))'
}

const toolSuccessIconTextStyle: CSSProperties = {
  display: 'block',
  transform: 'translateY(-0.5px)'
}

const pendingStatusIconStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '999px',
  alignSelf: 'center',
  justifySelf: 'center'
}

const stepListItemStyle: CSSProperties = {
  outline: 'none',
  minWidth: 0
}

const stepRowButtonStyle: CSSProperties = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: rowColumns,
  alignItems: 'center',
  columnGap: darkTheme.spacing.sm,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
  minWidth: 0
}

const stepTextStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: darkTheme.typography.body,
  lineHeight: 1.35
}

const primarySegmentStyle: CSSProperties = {
  whiteSpace: 'nowrap'
}

const mutedSeparatorStyle: CSSProperties = {
  color: darkTheme.color.textMuted
}

const mutedSegmentStyle: CSSProperties = {
  color: darkTheme.color.textMuted
}

const stepFullscreenOverlayStyle: CSSProperties = {
  position: 'fixed',
  top: 36,
  right: 0,
  bottom: 0,
  left: 0,
  background: darkTheme.color.surface,
  display: 'block',
  padding: 0,
  boxSizing: 'border-box',
  zIndex: 1000
}

const stepFullscreenShellStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  background: 'transparent',
  borderStyle: 'none'
}

const stepFullscreenActionsStyle: CSSProperties = {
  position: 'absolute',
  top: darkTheme.spacing.lg,
  right: darkTheme.spacing.lg,
  zIndex: 2,
  display: 'flex'
}

const stepFullscreenIconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: 0,
  outline: 0,
  borderRadius: darkTheme.radius.md,
  background: 'transparent',
  color: darkTheme.color.text,
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer'
}

const stepFullscreenIconStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: 'block'
}

const stepFullscreenScrollAreaStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'auto',
  overscrollBehavior: 'contain',
  overflowAnchor: 'none',
  willChange: 'scroll-position',
  boxSizing: 'border-box',
  padding: `${darkTheme.spacing.xl} ${darkTheme.spacing.lg}`
}

const stepFullscreenBodyStyle: CSSProperties = {
  maxWidth: 1120,
  minHeight: '100%',
  margin: '0 auto',
  background: 'transparent',
  borderStyle: 'none',
  color: darkTheme.color.text
}

const toolDetailGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: darkTheme.spacing.lg,
  alignItems: 'start'
}

const toolDetailBlockStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: darkTheme.spacing.md,
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: darkTheme.radius.lg,
  background: darkTheme.color.surfaceMuted,
  padding: darkTheme.spacing.lg
}

const toolDetailTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: darkTheme.typography.body,
  lineHeight: 1.25,
  color: darkTheme.color.text,
  fontWeight: 800
}

const toolDetailPreStyle: CSSProperties = {
  margin: 0,
  minWidth: 0,
  maxHeight: 'calc(100vh - 220px)',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: darkTheme.typography.body,
  lineHeight: 1.55,
  color: darkTheme.color.text
}

const toolDetailEmptyStyle: CSSProperties = {
  margin: 0,
  color: darkTheme.color.textMuted
}
