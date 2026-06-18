import { useEffect, useState, type CSSProperties } from 'react'
import type { Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import type { AppSection } from './ActivityRail'

export type EntityListPaneProps = {
  title?: string
  activeSection: AppSection
  sessions: Session[]
  activeSessionId?: string
  onSelectSession?: (sessionId: string) => void
  onRenameSession?: (sessionId: string) => void
  onRegenerateSessionTitle?: (sessionId: string) => void
  onDeleteSession?: (sessionId: string) => void
}

type SessionMenuState = {
  sessionId: string
  x: number
  y: number
}

type SessionMenuItem = {
  key: 'rename' | 'regenerate-title' | 'delete'
  label: string
  danger?: boolean
}

const sessionMenuItems: SessionMenuItem[] = [
  { key: 'rename', label: '重命名' },
  { key: 'regenerate-title', label: '重新生成标题' },
  { key: 'delete', label: '删除', danger: true }
]

export function EntityListPane({
  title,
  activeSection,
  sessions,
  activeSessionId,
  onSelectSession,
  onRenameSession,
  onRegenerateSessionTitle,
  onDeleteSession
}: EntityListPaneProps) {
  const heading = title ?? (activeSection === 'sessions' ? '所有会话' : activeSection === 'settings' ? '设置' : '列表')
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>()

  useEffect(() => {
    if (!sessionMenu) return undefined

    const close = () => setSessionMenu(undefined)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [sessionMenu])

  const handleMenuAction = (action: typeof sessionMenuItems[number]['key'], sessionId: string) => {
    setSessionMenu(undefined)
    switch (action) {
      case 'rename':
        onRenameSession?.(sessionId)
        return
      case 'regenerate-title':
        onRegenerateSessionTitle?.(sessionId)
        return
      case 'delete':
        onDeleteSession?.(sessionId)
        return
    }
  }

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
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setSessionMenu({ sessionId: session.id, x: event.clientX, y: event.clientY })
                    }}
                  >
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</div>
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
      {sessionMenu ? (
        <div
          role="menu"
          aria-label="会话操作"
          style={{
            ...sessionMenuStyle,
            left: sessionMenu.x,
            top: sessionMenu.y
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {sessionMenuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => handleMenuAction(item.key, sessionMenu.sessionId)}
              style={{
                ...sessionMenuItemStyle,
                ...(item.danger ? { color: darkTheme.color.danger } : {})
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

const sessionMenuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  minWidth: 180,
  padding: '4px 0',
  borderRadius: darkTheme.radius.md,
  border: `1px solid ${darkTheme.color.border}`,
  background: darkTheme.color.surfaceMuted,
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.36)',
  overflow: 'hidden'
}

const sessionMenuItemStyle: CSSProperties = {
  width: '100%',
  minHeight: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  padding: `0 ${darkTheme.spacing.md}`,
  border: 0,
  borderRadius: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left'
}
