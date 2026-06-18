import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Session } from '@hesper/shared'
import { RunningStatusIcon } from '../conversation/RunningStatusIcon'
import { darkTheme } from '../theme'
import type { AppSection } from './ActivityRail'

export type EntityListPaneProps = {
  title?: string
  activeSection: AppSection
  sessions: Session[]
  activeSessionId?: string
  runningSessionIds?: string[]
  activeSettingsCategory?: 'ai' | 'appearance'
  onSelectSession?: (sessionId: string) => void
  onSelectSettingsCategory?: (category: 'ai' | 'appearance') => void
  onRenameSession?: (sessionId: string, title: string) => void
  onRegenerateSessionTitle?: (sessionId: string, sessionIds?: string[]) => void
  onDeleteSession?: (sessionId: string, sessionIds?: string[]) => void
}

type SessionMenuState = {
  sessionId: string
  sessionIds: string[]
  x: number
  y: number
}

type EditingSessionState = {
  sessionId: string
  title: string
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

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function EntityListPane({
  title,
  activeSection,
  sessions,
  activeSessionId,
  runningSessionIds = [],
  activeSettingsCategory = 'ai',
  onSelectSession,
  onSelectSettingsCategory,
  onRenameSession,
  onRegenerateSessionTitle,
  onDeleteSession
}: EntityListPaneProps) {
  const heading = title ?? (activeSection === 'sessions' ? '所有会话' : activeSection === 'settings' ? '设置' : '列表')
  const runningSessionIdSet = new Set(runningSessionIds)
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>()
  const [editingSession, setEditingSession] = useState<EditingSessionState>()
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [selectionAnchorSessionId, setSelectionAnchorSessionId] = useState<string>()
  const renameInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (!editingSession) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [editingSession?.sessionId])

  useEffect(() => {
    const sessionIdSet = new Set(sessions.map((session) => session.id))
    setSelectedSessionIds((current) => {
      const next = current.filter((sessionId) => sessionIdSet.has(sessionId))
      return arraysEqual(current, next) ? current : next
    })
    setSelectionAnchorSessionId((current) => current && sessionIdSet.has(current) ? current : undefined)
  }, [sessions])

  const getSessionRange = (fromSessionId: string, toSessionId: string): string[] => {
    const fromIndex = sessions.findIndex((session) => session.id === fromSessionId)
    const toIndex = sessions.findIndex((session) => session.id === toSessionId)
    if (fromIndex === -1 || toIndex === -1) return [toSessionId]

    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    return sessions.slice(start, end + 1).map((session) => session.id)
  }

  const handleSessionClick = (sessionId: string, shiftKey: boolean) => {
    if (shiftKey) {
      const anchorSessionId = selectionAnchorSessionId ?? selectedSessionIds[0] ?? activeSessionId ?? sessionId
      setSelectedSessionIds(getSessionRange(anchorSessionId, sessionId))
      setSelectionAnchorSessionId(anchorSessionId)
    } else {
      setSelectedSessionIds([sessionId])
      setSelectionAnchorSessionId(sessionId)
    }
    onSelectSession?.(sessionId)
  }

  const openSessionMenu = (sessionId: string, x: number, y: number) => {
    const sessionIdSet = new Set(sessions.map((session) => session.id))
    const selectedTargets = selectedSessionIds.filter((selectedSessionId) => sessionIdSet.has(selectedSessionId))
    const isSelectedTarget = selectedTargets.includes(sessionId)
    const sessionIds = isSelectedTarget ? selectedTargets : [sessionId]

    setSessionMenu({ sessionId, sessionIds, x, y })
  }

  const startRenameSession = (sessionId: string) => {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return
    setEditingSession({ sessionId, title: session.title })
  }

  const cancelRenameSession = () => setEditingSession(undefined)

  const commitRenameSession = () => {
    if (!editingSession) return

    const nextTitle = editingSession.title.trim()
    const currentTitle = sessions.find((session) => session.id === editingSession.sessionId)?.title
    setEditingSession(undefined)
    if (!nextTitle || nextTitle === currentTitle) return
    onRenameSession?.(editingSession.sessionId, nextTitle)
  }

  const handleMenuAction = (action: typeof sessionMenuItems[number]['key'], menuState: SessionMenuState) => {
    setSessionMenu(undefined)
    switch (action) {
      case 'rename':
        startRenameSession(menuState.sessionId)
        return
      case 'regenerate-title':
        onRegenerateSessionTitle?.(menuState.sessionId, menuState.sessionIds)
        return
      case 'delete':
        onDeleteSession?.(menuState.sessionId, menuState.sessionIds)
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
        <h2 style={{ margin: 0, fontSize: darkTheme.typography.body, lineHeight: '24px', textAlign: 'center', fontWeight: 700 }}>{heading}</h2>
      </header>
      {activeSection === 'sessions' ? (
        sessions.length > 0 ? (
          <ul aria-label="会话列表" className="hesper-theme-scrollbar" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2, overflow: 'auto', minHeight: 0 }}>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              const isSelected = selectedSessionIds.includes(session.id)
              const isRunning = runningSessionIdSet.has(session.id)
              const sessionRowClassName = `hesper-list-row${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`
              return (
                <li key={session.id}>
                  {editingSession?.sessionId === session.id ? (
                    <div
                      className={sessionRowClassName}
                      data-selected={isSelected ? 'true' : undefined}
                      style={sessionRowStyle}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openSessionMenu(session.id, event.clientX, event.clientY)
                      }}
                    >
                      <input
                        ref={renameInputRef}
                        aria-label="重命名会话标题"
                        value={editingSession.title}
                        onChange={(event) => setEditingSession({ sessionId: session.id, title: event.target.value })}
                        onBlur={commitRenameSession}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitRenameSession()
                            return
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelRenameSession()
                          }
                        }}
                        style={renameInputStyle}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={sessionRowClassName}
                      data-selected={isSelected ? 'true' : undefined}
                      style={sessionRowStyle}
                      aria-current={isActive ? 'true' : undefined}
                      aria-selected={isSelected ? 'true' : undefined}
                      onClick={(event) => handleSessionClick(session.id, event.shiftKey)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openSessionMenu(session.id, event.clientX, event.clientY)
                      }}
                    >
                      <div style={sessionTitleRowStyle}>
                        {isRunning ? <RunningStatusIcon ariaHidden /> : null}
                        <span style={sessionTitleTextStyle}>{session.title}</span>
                      </div>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: darkTheme.typography.body, textAlign: 'center' }}>暂无会话</div>
        )
      ) : activeSection === 'settings' ? (
        <nav aria-label="设置分类" style={{ display: 'grid', gap: 4 }}>
          {settingsCategories.map((category) => {
            const isActive = category.id === activeSettingsCategory
            return (
              <button
                key={category.id}
                type="button"
                className={`hesper-settings-row${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={category.label}
                onClick={() => onSelectSettingsCategory?.(category.id)}
              >
                <span style={{ fontWeight: 700 }}>{category.title}</span>
                <span style={{ fontSize: darkTheme.typography.body, color: darkTheme.color.textMuted }}>{category.description}</span>
              </button>
            )
          })}
        </nav>
      ) : (
        <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: darkTheme.typography.body, textAlign: 'center' }}>该区域将在后续任务接入真实数据。</div>
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
          <style>{sessionMenuHoverCss}</style>
          {sessionMenuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="hesper-session-menu-item"
              onClick={() => handleMenuAction(item.key, sessionMenu)}
              style={{
                ...sessionMenuItemStyle,
                ...(item.danger ? { color: darkTheme.color.danger } : {})
              }}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

const settingsCategories: Array<{ id: 'ai' | 'appearance'; title: string; label: string; description: string }> = [
  { id: 'ai', title: 'AI', label: 'AI 设置', description: '模型、思考、连接' },
  { id: 'appearance', title: '外观', label: '外观设置', description: '字体大小、亮色与暗色' }
]

const sessionRowStyle: CSSProperties = {
  alignItems: 'center'
}

const sessionTitleRowStyle: CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 600,
  overflow: 'hidden'
}

const sessionTitleTextStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const renameInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: 0,
  outline: '1px solid rgba(124, 108, 255, 0.55)',
  borderRadius: 6,
  background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))',
  color: darkTheme.color.text,
  font: 'inherit',
  fontWeight: 600,
  padding: '4px 6px'
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
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
  width: '100%',
  minHeight: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  padding: `0 ${darkTheme.spacing.md}`,
  border: 0,
  outline: 0,
  borderRadius: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  fontSize: darkTheme.typography.body,
  cursor: 'pointer',
  textAlign: 'left'
}

const sessionMenuHoverCss = `
.hesper-session-menu-item::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: var(--hesper-color-hover, rgba(122, 162, 247, 0.12));
  opacity: 0;
  transition: opacity 160ms ease;
}

.hesper-session-menu-item:hover::after,
.hesper-session-menu-item:focus-visible::after {
  opacity: 1;
}

.hesper-session-menu-item > span {
  position: relative;
  z-index: 1;
}
`
