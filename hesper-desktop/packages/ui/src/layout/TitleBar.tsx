import type { ReactNode } from 'react'
import { darkTheme } from '../theme'

export type TitleBarProps = {
  title: string
  rightSlot?: ReactNode
}

export function TitleBar({ title, rightSlot }: TitleBarProps) {
  return (
    <header
      className="titlebar-drag"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 40,
        padding: `${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
        borderBottom: `1px solid ${darkTheme.color.border}`,
        background: darkTheme.color.surface
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, pointerEvents: 'none' }}>{title}</div>
      <div className="titlebar-no-drag" style={{ display: 'flex', alignItems: 'center', gap: darkTheme.spacing.sm }}>{rightSlot}</div>
    </header>
  )
}
