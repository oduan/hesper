import type { CSSProperties } from 'react'
import { darkTheme } from '../theme'

export type RunningStatusIconProps = {
  ariaLabel?: string
  ariaHidden?: boolean
}

const runningDotScanOrder = [3, 2, 1, 4, 7, 8, 9, 6, 5]

export function RunningStatusIcon({ ariaLabel = '运行中', ariaHidden = false }: RunningStatusIconProps) {
  return (
    <span
      {...(ariaHidden ? { 'aria-hidden': true } : { 'aria-label': ariaLabel })}
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

const runningDotAnimationCss = `
@keyframes hesper-step-running-dot-sweep {
  0%, 100% { opacity: 0.24; transform: scale(0.78); }
  10% { opacity: 1; transform: scale(1.24); }
  24% { opacity: 0.68; transform: scale(1.04); }
  34% { opacity: 0.24; transform: scale(0.78); }
}
`

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
