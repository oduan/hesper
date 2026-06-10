import type { ReactNode } from 'react'
import type { Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import { ActivityRail, type AppSection } from './ActivityRail'
import { EntityListPane } from './EntityListPane'
import { TitleBar, type DesktopPlatform, type WindowControlAction } from './TitleBar'

export type AppShellProps = {
  sessions: Session[]
  activeSection: AppSection
  title: string
  platform?: DesktopPlatform
  activeSessionId?: string
  onCreateSession?: () => void | Promise<void>
  onSelectSection?: (section: AppSection) => void
  onSelectSession?: (sessionId: string) => void
  onWindowMinimize?: WindowControlAction
  onWindowToggleMaximize?: WindowControlAction
  onWindowClose?: WindowControlAction
  children?: ReactNode
}

export function AppShell({ sessions, activeSection, title: _title, platform, activeSessionId, onCreateSession, onSelectSection, onSelectSession, onWindowMinimize, onWindowToggleMaximize, onWindowClose, children }: AppShellProps) {
  return (
    <div
      style={{
        height: '100vh',
        minHeight: 0,
        overflow: 'hidden',
        background: darkTheme.color.background,
        color: darkTheme.color.text,
        display: 'grid',
        gridTemplateRows: '36px minmax(0, 1fr)',
        fontFamily: 'Inter, Segoe UI, sans-serif'
      }}
    >
      <TitleBar
        title="hesper"
        {...(platform ? { platform } : {})}
        {...(onWindowMinimize ? { onMinimize: onWindowMinimize } : {})}
        {...(onWindowToggleMaximize ? { onToggleMaximize: onWindowToggleMaximize } : {})}
        {...(onWindowClose ? { onClose: onWindowClose } : {})}
      />
      <div
        style={{
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '84px 280px minmax(0, 1fr)',
          overflow: 'hidden'
        }}
      >
        <ActivityRail
          activeSection={activeSection}
          {...(onCreateSession ? { onCreateSession } : {})}
          {...(onSelectSection ? { onSelectSection } : {})}
        />
        <EntityListPane
          activeSection={activeSection}
          sessions={sessions}
          {...(activeSessionId ? { activeSessionId } : {})}
          {...(onSelectSession ? { onSelectSession } : {})}
        />
        <section aria-label="详情区域" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0, padding: darkTheme.spacing.md, overflow: 'hidden' }}>{children}</div>
        </section>
      </div>
    </div>
  )
}
