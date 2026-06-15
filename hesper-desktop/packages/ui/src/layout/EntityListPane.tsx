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
  const heading = title ?? (activeSection === 'sessions' ? '所有会话' : activeSection === 'settings' ? '设置' : '列表')

  return (
    <aside
      aria-label="实体列表"
      style={{
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        boxSizing: 'border-box',
        background: darkTheme.color.surface,
        borderRadius: darkTheme.radius.xl,
        padding: darkTheme.spacing.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: darkTheme.spacing.md,
        overflow: 'hidden'
      }}
    >
      <header style={{ position: 'relative', minHeight: 24 }}>
        <h2 style={{ margin: 0, fontSize: 15, lineHeight: '24px', textAlign: 'center', fontWeight: 700 }}>{heading}</h2>
      </header>
      {activeSection === 'sessions' ? (
        sessions.length > 0 ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2, overflow: 'auto', minHeight: 0 }}>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className={`hesper-list-row${isActive ? ' is-active' : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onSelectSession?.(session.id)}
                  >
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</div>
                    <div style={{ fontSize: 11, color: darkTheme.color.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.defaultModelId ?? 'mock/hesper-fast'} · {session.workspacePath ?? '未设置工作目录'}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: 13, textAlign: 'center' }}>暂无会话</div>
        )
      ) : activeSection === 'settings' ? (
        <nav aria-label="设置分类" style={{ display: 'grid', gap: 4 }}>
          <button type="button" className="hesper-settings-row" aria-label="应用设置">
            <span style={{ fontWeight: 700 }}>应用</span>
            <span style={{ fontSize: 12, color: darkTheme.color.textMuted }}>通知和更新</span>
          </button>
          <button type="button" className="hesper-settings-row is-active" aria-current="page" aria-label="AI 设置">
            <span style={{ fontWeight: 700 }}>AI</span>
            <span style={{ fontSize: 12, color: darkTheme.color.textMuted }}>模型、思考、连接</span>
          </button>
        </nav>
      ) : (
        <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: 13, textAlign: 'center' }}>该区域将在后续任务接入真实数据。</div>
      )}
    </aside>
  )
}
