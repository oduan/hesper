import { useMemo, useState, type CSSProperties } from 'react'
import type { RunStep, RunStepStatus } from '@hesper/shared'
import { darkTheme } from '../theme'

export type RunStepsProps = {
  steps: RunStep[]
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

function createStepText(step: RunStep): string {
  return step.summary ?? step.title
}

function StatusDot({ status }: { status: RunStepStatus }) {
  return (
    <span
      aria-label={`步骤状态：${statusLabels[status]}`}
      title={statusLabels[status]}
      style={{
        width: 8,
        height: 8,
        borderRadius: '999px',
        background: getStatusColor(status),
        boxShadow: `0 0 0 3px ${getStatusColor(status)}22`,
        alignSelf: 'center',
        justifySelf: 'center'
      }}
    />
  )
}

export function RunSteps({ steps, getStepProps }: RunStepsProps) {
  const [expanded, setExpanded] = useState(false)
  const orderedSteps = useMemo(() => [...steps].sort(compareCreatedAt), [steps])
  const latest = orderedSteps.at(-1)
  const summary = latest ? createStepText(latest) : '暂无步骤'

  return (
    <section
      aria-label="步骤流"
      style={{
        display: 'grid',
        gap: darkTheme.spacing.sm,
        border: `1px solid ${darkTheme.color.border}`,
        borderRadius: darkTheme.radius.lg,
        background: darkTheme.color.surfaceMuted,
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
            return (
              <li
                key={step.id}
                {...stepProps}
                style={stepRowStyle}
              >
                <span aria-hidden="true" />
                <StatusDot status={step.status} />
                <span style={stepTextStyle} title={text}>
                  {text}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

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
