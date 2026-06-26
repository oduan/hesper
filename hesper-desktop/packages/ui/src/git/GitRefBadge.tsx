import type { CSSProperties } from 'react'
import { themeTokens } from '../theme'
import type { GitRefView } from './git-graph-types'

export function GitRefBadge({ refView, graphColor }: { refView: GitRefView; graphColor?: string | undefined }) {
  const typeStyle = refView.type === 'tag' ? tagBadgeStyle : refView.type === 'head' ? headBadgeStyle : branchBadgeStyle
  const style = graphColor && refView.type !== 'tag'
    ? { ...typeStyle, ...graphColorBadgeStyle(graphColor) }
    : typeStyle

  return <span style={style}>{refView.shortName}</span>
}

const badgeBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: '100%',
  borderRadius: 999,
  border: `1px solid ${themeTokens.color.border}`,
  padding: `1px ${themeTokens.spacing.sm}`,
  fontSize: 12,
  lineHeight: 1.6,
  color: themeTokens.color.text,
  background: themeTokens.color.neutralSoft
}

const branchBadgeStyle: CSSProperties = { ...badgeBaseStyle, background: themeTokens.color.softControl, borderColor: themeTokens.color.accent }
const tagBadgeStyle: CSSProperties = { ...badgeBaseStyle, background: themeTokens.color.warningSoft, borderColor: themeTokens.color.warning }
const headBadgeStyle: CSSProperties = { ...badgeBaseStyle, background: themeTokens.color.successSoft, borderColor: themeTokens.color.success }

const graphColorBadgeStyle = (color: string): CSSProperties => ({
  borderColor: color,
  background: transparentizeHex(color, 0.18),
  boxShadow: `inset 0 0 0 1px ${transparentizeHex(color, 0.08)}`
})

function transparentizeHex(color: string, alpha: number): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  if (!match) return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
  const [, red = '00', green = '00', blue = '00'] = match
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${alpha})`
}
