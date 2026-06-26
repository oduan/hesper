import type { CSSProperties } from 'react'
import { themeTokens } from '../theme'
import type { GitRefView } from './git-graph-types'

export function GitRefBadge({ refView }: { refView: GitRefView }) {
  const style = refView.type === 'tag' ? tagBadgeStyle : refView.type === 'head' ? headBadgeStyle : branchBadgeStyle

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
