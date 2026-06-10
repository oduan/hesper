import { useMemo, useState } from 'react'
import type { RunStep, RunStepStatus, RunStepType } from '@hesper/shared'
import { darkTheme } from '../theme'

export type RunStepsProps = {
  steps: RunStep[]
}

const typeLabels: Record<RunStepType, string> = {
  thought: '思考',
  tool_call: '工具调用',
  tool_result: '工具结果',
  model_call: '模型调用',
  retry: '重试',
  warning: '警告'
}

const statusLabels: Record<RunStepStatus, string> = {
  pending: '待处理',
  running: '运行中',
  succeeded: '成功',
  failed: '失败'
}

function getStepBadge(step: RunStep): string {
  return `${typeLabels[step.type]} / ${statusLabels[step.status]}`
}

export function RunSteps({ steps }: RunStepsProps) {
  const [expanded, setExpanded] = useState(true)
  const summary = useMemo(() => {
    const latest = steps.at(-1)
    return latest ? `最新步骤：${getStepBadge(latest)} · ${latest.title}` : '暂无步骤'
  }, [steps])

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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: darkTheme.spacing.sm,
          border: 0,
          background: 'transparent',
          color: darkTheme.color.text,
          padding: 0,
          cursor: 'pointer'
        }}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span
          style={{
            fontSize: 12,
            borderRadius: darkTheme.radius.xl,
            border: `1px solid ${darkTheme.color.border}`,
            padding: '2px 8px'
          }}
        >
          {steps.length}
        </span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
      </button>
      {expanded ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: darkTheme.spacing.sm }}>
          {steps.map((step) => {
            const statusLabel = getStepBadge(step)
            return (
              <li
                key={step.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '64px minmax(0, 1fr)',
                  gap: darkTheme.spacing.sm,
                  alignItems: 'start'
                }}
              >
                <span style={{ color: darkTheme.color.textMuted, fontSize: 12 }}>{statusLabel}</span>
                <div style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{step.title}</span>
                  {step.summary ? <span style={{ color: darkTheme.color.textMuted, fontSize: 13 }}>{step.summary}</span> : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
