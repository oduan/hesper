import type { Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import type { AppSection } from './ActivityRail'

export type EntityListPaneProps = {
  title?: string
  activeSection: AppSection
  sessions: Session[]
  activeSessionId?: string
  onSelectSession?: (sessionId: string) => void
}

export function EntityListPane({ title, activeSection, sessions, activeSessionId, onSelectSession }: EntityListPaneProps) {
  const heading = title ?? (activeSection === 'sessions' ? '所有会话' : '列表')

  return (
    <aside
      aria-label="实体列表"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: darkTheme.color.surface,
        borderRight: `1px solid ${darkTheme.color.border}`,
        padding: darkTheme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: darkTheme.spacing.sm
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: 16 }}>{heading}</h2>
      </header>
      {activeSection === 'sessions' ? (
        sessions.length > 0 ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: darkTheme.spacing.xs }}>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onSelectSession?.(session.id)}
                    style={{
                      width: '100%',
                      border: `1px solid ${isActive ? darkTheme.color.accent : darkTheme.color.border}`,
                      borderRadius: darkTheme.radius.md,
                      background: isActive ? 'rgba(155, 140, 255, 0.12)' : darkTheme.color.surfaceMuted,
                      padding: darkTheme.spacing.sm,
                      textAlign: 'left',
                      color: darkTheme.color.text,
                      cursor: 'pointer',
                      display: 'grid',
                      gap: 4
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{session.title}</div>
                    <div style={{ fontSize: 12, color: darkTheme.color.textMuted }}>{session.defaultModelId ?? 'mock/hesper-fast'}</div>
                    <div style={{ fontSize: 12, color: darkTheme.color.textMuted }}>{session.workspacePath ?? '未设置工作目录'}</div>
                    <div style={{ fontSize: 12, color: darkTheme.color.textMuted }}>{session.outputMode}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{ color: darkTheme.color.textMuted, fontSize: 13 }}>暂无会话</div>
        )
      ) : (
        <div style={{ color: darkTheme.color.textMuted, fontSize: 13 }}>该区域将在后续任务接入真实数据。</div>
      )}
    </aside>
  )
}
