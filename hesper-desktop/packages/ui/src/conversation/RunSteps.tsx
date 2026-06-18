import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { RunStep, RunStepStatus } from '@hesper/shared'
import { darkTheme } from '../theme'

export type RunStepsProps = {
  steps: RunStep[]
  autoExpanded?: boolean
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

function firstToolCallStep(steps: RunStep[]): RunStep | undefined {
  return steps.find((step) => step.type === 'tool_call')
}

function createStepDisplayParts(step: RunStep): StepDisplayParts {
  if (step.type === 'thought' && step.summary) {
    return {
      primary: step.summary,
      secondary: uniqueParts([step.detail]).filter((part) => part !== step.summary)
    }
  }

  const primary = step.title
  return {
    primary,
    secondary: uniqueParts([step.summary, step.detail]).filter((part) => part !== primary)
  }
}

function createStepText(step: RunStep): string {
  const parts = createStepDisplayParts(step)
  return [parts.primary, ...parts.secondary].join(' · ')
}

const runningDotScanOrder = [3, 2, 1, 4, 7, 8, 9, 6, 5]

function RunningStatusIcon() {
  return (
    <span
      aria-label={`步骤状态：${statusLabels.running}`}
      title={statusLabels.running}
      data-step-status-icon="running-nine-dot-sweep"
      style={runningStatusIconStyle}
    >
      <style>{runningDotAnimationCss}</style>
      {runningDotScanOrder.map((dot, index) => {
        const row = Math.ceil(dot / 3)
        const column = ((dot - 1) % 3) + 1
        return (
          <span
            key={dot}
            aria-hidden="true"
            data-step-running-dot={dot}
            style={{
              ...runningDotStyle,
              gridRow: row,
              gridColumn: column,
              animationDelay: `${index * 90}ms`
            }}
          />
        )
      })}
    </span>
  )
}

function CompletedStatusIcon({ status }: { status: 'succeeded' | 'failed' }) {
  const isSucceeded = status === 'succeeded'
  const color = getStatusColor(status)
  return (
    <span
      aria-label={`步骤状态：${statusLabels[status]}`}
      title={statusLabels[status]}
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

function PendingStatusIcon() {
  return (
    <span
      aria-label={`步骤状态：${statusLabels.pending}`}
      title={statusLabels.pending}
      style={{
        ...pendingStatusIconStyle,
        background: getStatusColor('pending'),
        boxShadow: `0 0 0 3px ${getStatusColor('pending')}22`
      }}
    />
  )
}

function StatusDot({ status }: { status: RunStepStatus }) {
  if (status === 'running') return <RunningStatusIcon />
  if (status === 'succeeded' || status === 'failed') return <CompletedStatusIcon status={status} />
  return <PendingStatusIcon />
}

export function RunSteps({ steps, autoExpanded = false, getStepProps }: RunStepsProps) {
  const [expanded, setExpanded] = useState(autoExpanded)
  const orderedSteps = useMemo(() => [...steps].sort(compareCreatedAt), [steps])
  const firstTool = firstToolCallStep(orderedSteps)

  useEffect(() => {
    setExpanded(autoExpanded)
  }, [autoExpanded])

  if (!firstTool) {
    return null
  }

  const summary = createToolIntent(firstTool)

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
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value: boolean) => !value)}
        style={summaryButtonStyle}
      >
        <span aria-hidden="true" style={chevronStyle}>{expanded ? '▾' : '▸'}</span>
        <span style={countBadgeStyle}>{orderedSteps.length}</span>
        <span style={summaryTextStyle} title={summary}>{summary}</span>
      </button>
      {expanded ? (
        <ul style={listStyle}>
          {orderedSteps.map((step) => {
            const stepProps = getStepProps?.(step)
            const text = createStepText(step)
            const parts = createStepDisplayParts(step)
            return (
              <li
                key={step.id}
                {...stepProps}
                style={stepRowStyle}
              >
                <span aria-hidden="true" />
                <StatusDot status={step.status} />
                <span style={stepTextStyle} title={text}>
                  <span style={primarySegmentStyle}>{parts.primary}</span>
                  {parts.secondary.map((part) => (
                    <span key={part}>
                      <span aria-hidden="true" style={mutedSeparatorStyle}> · </span>
                      <span style={mutedSegmentStyle}>{part}</span>
                    </span>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

const runningDotAnimationCss = `
@keyframes hesper-step-running-dot-sweep {
  0%, 100% { opacity: 0.24; transform: scale(0.78); }
  10% { opacity: 1; transform: scale(1.24); }
  24% { opacity: 0.68; transform: scale(1.04); }
  34% { opacity: 0.24; transform: scale(0.78); }
}
`

const rowColumns = '16px 28px minmax(0, 1fr)'

const summaryButtonStyle: CSSProperties = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: rowColumns,
  alignItems: 'center',
  columnGap: darkTheme.spacing.sm,
  border: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left'
}

const chevronStyle: CSSProperties = {
  color: darkTheme.color.textMuted,
  lineHeight: 1,
  justifySelf: 'center'
}

const countBadgeStyle: CSSProperties = {
  minWidth: 28,
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  borderRadius: darkTheme.radius.xl,
  border: `1px solid ${darkTheme.color.border}`,
  color: darkTheme.color.textMuted,
  padding: '0 7px'
}

const summaryTextStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12
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

const runningStatusIconStyle: CSSProperties = {
  ...statusIconSlotStyle,
  gridTemplateColumns: 'repeat(3, 4px)',
  gridTemplateRows: 'repeat(3, 4px)',
  gap: 2
}

const runningDotStyle: CSSProperties = {
  width: 3.5,
  height: 3.5,
  borderRadius: 999,
  background: darkTheme.color.accent,
  opacity: 0.28,
  animationName: 'hesper-step-running-dot-sweep',
  animationDuration: '1260ms',
  animationTimingFunction: 'linear',
  animationIterationCount: 'infinite'
}

const pendingStatusIconStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '999px',
  alignSelf: 'center',
  justifySelf: 'center'
}

const stepRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: rowColumns,
  alignItems: 'center',
  columnGap: darkTheme.spacing.sm,
  outline: 'none',
  minWidth: 0
}

const stepTextStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
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
