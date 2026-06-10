import type { ReactNode } from 'react'
import type { Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import { ActivityRail, type AppSection } from './ActivityRail'
import { EntityListPane } from './EntityListPane'
import { TitleBar } from './TitleBar'

export type AppShellProps = {
  sessions: Session[]
  activeSection: AppSection
  title: string
  activeSessionId?: string
  onSelectSession?: (sessionId: string) => void
  children?: ReactNode
}

export function AppShell({ sessions, activeSection, title, activeSessionId, onSelectSession, children }: AppShellProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: darkTheme.color.background,
        color: darkTheme.color.text,
        display: 'grid',
        gridTemplateColumns: '92px 280px minmax(0, 1fr)',
        fontFamily: 'Inter, Segoe UI, sans-serif'
      }}
    >
      <ActivityRail activeSection={activeSection} />
      <EntityListPane
        activeSection={activeSection}
        sessions={sessions}
        {...(activeSessionId ? { activeSessionId } : {})}
        {...(onSelectSession ? { onSelectSession } : {})}
      />
      <section aria-label="详情区域" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TitleBar title={title} />
        <div style={{ flex: 1, minHeight: 0, padding: darkTheme.spacing.md }}>{children}</div>
      </section>
    </div>
  )
}
