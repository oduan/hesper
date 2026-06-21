import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Session, ToolDefinition } from '@hesper/shared'
import { RunningStatusIcon } from '../conversation/RunningStatusIcon'
import { darkTheme } from '../theme'
import type { AppSection } from './ActivityRail'

type ToolListItem = ToolDefinition & { enabled: boolean }

export type RoleListItem = {
  id: string
  name: string
  description?: string
}

export type EntityListPaneProps = {
  title?: string
  activeSection: AppSection
  sessions: Session[]
  activeSessionId?: string
  runningSessionIds?: string[]
  tools?: ToolListItem[]
  activeToolId?: string
  pendingToolIds?: string[]
  roles?: RoleListItem[]
  activeRoleId?: string
  activeSettingsCategory?: 'ai' | 'appearance'
  onSelectSession?: (sessionId: string) => void
  onSelectTool?: (toolId: string) => void
  onToggleToolEnabled?: (toolId: string, enabled: boolean) => void
  onSelectRole?: (roleId: string) => void
  onSelectSettingsCategory?: (category: 'ai' | 'appearance') => void
  onRenameSession?: (sessionId: string, title: string) => void
  onRegenerateSessionTitle?: (sessionId: string, sessionIds?: string[]) => void
  onDeleteSession?: (sessionId: string, sessionIds?: string[]) => void
  onDeleteRole?: (roleId: string, roleIds?: string[]) => void
}

type SessionMenuState = {
  sessionId: string
  sessionIds: string[]
  x: number
  y: number
}

type RoleMenuState = {
  roleId: string
  roleIds: string[]
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

type RoleMenuItem = {
  key: 'delete'
  label: string
  danger?: boolean
}

const sessionMenuItems: SessionMenuItem[] = [
  { key: 'rename', label: '重命名' },
  { key: 'regenerate-title', label: '重新生成标题' },
  { key: 'delete', label: '删除', danger: true }
]

const roleMenuItems: RoleMenuItem[] = [
  { key: 'delete', label: '删除', danger: true }
]

function NewMessageIcon() {
  return (
    <span aria-hidden="true" data-session-unread-icon="new-message" style={newMessageIconSlotStyle}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
        <path
          d="M3.2 3.8h9.6c.7 0 1.2.5 1.2 1.2v5.7c0 .7-.5 1.2-1.2 1.2H7.1l-3 2.1v-2.1h-.9c-.7 0-1.2-.5-1.2-1.2V5c0-.7.5-1.2 1.2-1.2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.45"
          strokeLinejoin="round"
        />
        <circle cx="11.9" cy="4.2" r="2.15" fill="var(--hesper-color-accent, #7aa2f7)" stroke="var(--hesper-color-surface, #16161e)" strokeWidth="1" />
      </svg>
    </span>
  )
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function formatRelativeSessionTime(updatedAt: string, nowMs: number): string {
  const updatedMs = new Date(updatedAt).getTime()
  if (!Number.isFinite(updatedMs)) return ''
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - updatedMs) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}秒`
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}分钟`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}小时`
  return `${Math.floor(elapsedHours / 24)}天`
}

export function EntityListPane({
  title,
  activeSection,
  sessions,
  activeSessionId,
  runningSessionIds = [],
  tools = [],
  activeToolId,
  pendingToolIds = [],
  roles = [],
  activeRoleId,
  activeSettingsCategory = 'ai',
  onSelectSession,
  onSelectTool,
  onToggleToolEnabled,
  onSelectRole,
  onSelectSettingsCategory,
  onRenameSession,
  onRegenerateSessionTitle,
  onDeleteSession,
  onDeleteRole
}: EntityListPaneProps) {
  const heading = title ?? (activeSection === 'sessions' ? '所有会话' : activeSection === 'settings' ? '设置' : activeSection === 'tools' ? '工具' : activeSection === 'roles' ? '角色' : '列表')
  const runningSessionIdSet = new Set(runningSessionIds)
  const pendingToolIdSet = new Set(pendingToolIds)
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>()
  const [roleMenu, setRoleMenu] = useState<RoleMenuState>()
  const [editingSession, setEditingSession] = useState<EditingSessionState>()
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [selectionAnchorSessionId, setSelectionAnchorSessionId] = useState<string>()
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [selectionAnchorRoleId, setSelectionAnchorRoleId] = useState<string>()
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now())
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (activeSection !== 'sessions') return undefined

    const refreshRelativeTime = () => setRelativeNowMs(Date.now())
    const interval = window.setInterval(refreshRelativeTime, 1_000)
    window.addEventListener('focus', refreshRelativeTime)
    document.addEventListener('visibilitychange', refreshRelativeTime)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshRelativeTime)
      document.removeEventListener('visibilitychange', refreshRelativeTime)
    }
  }, [activeSection])

  useEffect(() => {
    if (!sessionMenu && !roleMenu) return undefined

    const close = () => {
      setSessionMenu(undefined)
      setRoleMenu(undefined)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [sessionMenu, roleMenu])

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

  useEffect(() => {
    const roleIdSet = new Set(roles.map((role) => role.id))
    setSelectedRoleIds((current) => {
      const next = current.filter((roleId) => roleIdSet.has(roleId))
      return arraysEqual(current, next) ? current : next
    })
    setSelectionAnchorRoleId((current) => current && roleIdSet.has(current) ? current : undefined)
  }, [roles])

  const getSessionRange = (fromSessionId: string, toSessionId: string): string[] => {
    const fromIndex = sessions.findIndex((session) => session.id === fromSessionId)
    const toIndex = sessions.findIndex((session) => session.id === toSessionId)
    if (fromIndex === -1 || toIndex === -1) return [toSessionId]

    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    return sessions.slice(start, end + 1).map((session) => session.id)
  }

  const getRoleRange = (fromRoleId: string, toRoleId: string): string[] => {
    const fromIndex = roles.findIndex((role) => role.id === fromRoleId)
    const toIndex = roles.findIndex((role) => role.id === toRoleId)
    if (fromIndex === -1 || toIndex === -1) return [toRoleId]

    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    return roles.slice(start, end + 1).map((role) => role.id)
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

  const handleRoleClick = (roleId: string, shiftKey: boolean) => {
    if (shiftKey) {
      const anchorRoleId = selectionAnchorRoleId ?? selectedRoleIds[0] ?? activeRoleId ?? roleId
      setSelectedRoleIds(getRoleRange(anchorRoleId, roleId))
      setSelectionAnchorRoleId(anchorRoleId)
    } else {
      setSelectedRoleIds([roleId])
      setSelectionAnchorRoleId(roleId)
    }
    onSelectRole?.(roleId)
  }

  const openSessionMenu = (sessionId: string, x: number, y: number) => {
    const sessionIdSet = new Set(sessions.map((session) => session.id))
    const selectedTargets = selectedSessionIds.filter((selectedSessionId) => sessionIdSet.has(selectedSessionId))
    const isSelectedTarget = selectedTargets.includes(sessionId)
    const sessionIds = isSelectedTarget ? selectedTargets : [sessionId]

    setRoleMenu(undefined)
    setSessionMenu({ sessionId, sessionIds, x, y })
  }

  const openRoleMenu = (roleId: string, x: number, y: number) => {
    const roleIdSet = new Set(roles.map((role) => role.id))
    const selectedTargets = selectedRoleIds.filter((selectedRoleId) => roleIdSet.has(selectedRoleId))
    const isSelectedTarget = selectedTargets.includes(roleId)
    const roleIds = isSelectedTarget ? selectedTargets : [roleId]

    if (!isSelectedTarget) {
      setSelectedRoleIds([roleId])
      setSelectionAnchorRoleId(roleId)
    }

    setSessionMenu(undefined)
    setRoleMenu({ roleId, roleIds, x, y })
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

  const handleRoleMenuAction = (action: typeof roleMenuItems[number]['key'], menuState: RoleMenuState) => {
    setRoleMenu(undefined)
    switch (action) {
      case 'delete':
        onDeleteRole?.(menuState.roleId, menuState.roleIds)
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
              const hasUnreadCompletion = Boolean(session.unreadCompletedAt)
              const relativeUpdatedAt = formatRelativeSessionTime(session.updatedAt, relativeNowMs)
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
                      aria-label={session.title}
                      onClick={(event) => handleSessionClick(session.id, event.shiftKey)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openSessionMenu(session.id, event.clientX, event.clientY)
                      }}
                    >
                      <div style={sessionTitleRowStyle}>
                        {isRunning ? <RunningStatusIcon ariaHidden /> : hasUnreadCompletion ? <NewMessageIcon /> : null}
                        <span style={sessionTitleTextStyle}>{session.title}</span>
                      </div>
                      {relativeUpdatedAt ? <span aria-hidden="true" style={sessionRelativeTimeStyle}>{relativeUpdatedAt}</span> : null}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: darkTheme.typography.body, textAlign: 'center' }}>暂无会话</div>
        )
      ) : activeSection === 'roles' ? (
        <div style={{ display: 'grid', minHeight: 0 }}>
          {roles.length > 0 ? (
            <ul aria-label="角色列表" className="hesper-theme-scrollbar" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, overflow: 'auto', minHeight: 0 }}>
              {roles.map((role) => {
                const isActive = role.id === activeRoleId
                const isSelected = selectedRoleIds.includes(role.id)
                const roleDescription = role.description || '暂无简介'
                return (
                  <li key={role.id}>
                    <button
                      type="button"
                      className={`hesper-list-row${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                      data-selected={isSelected ? 'true' : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      aria-selected={isSelected ? 'true' : undefined}
                      aria-label={`${role.name} ${roleDescription}`.trim()}
                      onClick={(event) => handleRoleClick(role.id, event.shiftKey)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openRoleMenu(role.id, event.clientX, event.clientY)
                      }}
                      style={roleRowStyle}
                    >
                      <span style={roleNameStyle}>{role.name}</span>
                      <span style={roleDescriptionStyle}>{roleDescription}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: darkTheme.typography.body, textAlign: 'center' }}>暂无角色</div>
          )}
        </div>
      ) : activeSection === 'tools' ? (
        tools.length > 0 ? (
          <ul aria-label="工具列表" className="hesper-theme-scrollbar" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, overflow: 'auto', minHeight: 0 }}>
            {tools.map((tool) => {
              const isActive = tool.id === activeToolId
              const isPending = pendingToolIdSet.has(tool.id)
              return (
                <li key={tool.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`hesper-list-row${isActive ? ' is-active' : ''}`}
                    aria-selected={isActive ? 'true' : undefined}
                    data-tool-id={tool.id}
                    style={toolRowStyle}
                    onClick={() => onSelectTool?.(tool.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onSelectTool?.(tool.id)
                    }}
                  >
                    <div style={toolTextColumnStyle}>
                      <span style={toolNameStyle}>{tool.name}</span>
                      <span style={toolDescriptionStyle}>{tool.description}</span>
                    </div>
                    <ToolEnableSwitch
                      enabled={tool.enabled}
                      pending={isPending}
                      label={`${tool.name} 全局开关`}
                      onToggle={() => onToggleToolEnabled?.(tool.id, !tool.enabled)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: darkTheme.typography.body, textAlign: 'center' }}>暂无内置工具</div>
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
      {roleMenu ? (
        <div
          role="menu"
          aria-label="角色操作"
          style={{
            ...sessionMenuStyle,
            left: roleMenu.x,
            top: roleMenu.y
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <style>{sessionMenuHoverCss}</style>
          {roleMenuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="hesper-session-menu-item"
              onClick={() => handleRoleMenuAction(item.key, roleMenu)}
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

function ToolEnableSwitch({ enabled, pending, label, onToggle }: { enabled: boolean; pending: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={pending}
      data-tool-enabled={enabled ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      style={toolToggleStyle(enabled, pending)}
    >
      <span aria-hidden="true" data-tool-toggle-track="true" style={toolToggleTrackStyle(enabled)}>
        <span data-tool-toggle-knob="true" style={toolToggleKnobStyle(enabled)} />
      </span>
    </button>
  )
}

const settingsCategories: Array<{ id: 'ai' | 'appearance'; title: string; label: string; description: string }> = [
  { id: 'ai', title: 'AI', label: 'AI 设置', description: '模型、思考、连接' },
  { id: 'appearance', title: '外观', label: '外观设置', description: '字体大小、亮色与暗色' }
]

const sessionRowStyle: CSSProperties = {
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: 10
}

const toolRowStyle: CSSProperties = {
  minHeight: 66,
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: 10
}

const roleRowStyle: CSSProperties = {
  minHeight: 58,
  gridTemplateColumns: 'minmax(0, 1fr)',
  alignItems: 'center',
  gap: 3,
  textAlign: 'left'
}

const roleNameStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 700
}

const roleDescriptionStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 12,
  lineHeight: '16px'
}

const toolTextColumnStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 3
}

const toolNameStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 700
}

const toolDescriptionStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 12,
  lineHeight: '16px'
}

function toolToggleStyle(_enabled: boolean, pending: boolean): CSSProperties {
  return {
    width: 52,
    height: 32,
    flex: '0 0 auto',
    border: 0,
    borderRadius: 999,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    opacity: pending ? 0.62 : 1,
    cursor: pending ? 'progress' : 'pointer'
  }
}

function toolToggleTrackStyle(enabled: boolean): CSSProperties {
  return {
    position: 'relative',
    width: 46,
    height: 24,
    borderRadius: 999,
    border: `1px solid ${enabled ? 'var(--hesper-color-tool-toggle, #7aa2f7)' : 'var(--hesper-color-border, #414868)'}`,
    background: enabled ? 'var(--hesper-color-tool-toggle, #7aa2f7)' : 'var(--hesper-color-surface-muted, #24283b)',
    boxShadow: enabled ? '0 0 0 3px var(--hesper-color-tool-toggle-soft, rgba(122, 162, 247, 0.14))' : 'inset 0 0 0 1px rgba(148, 163, 184, 0.10)',
    transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease'
  }
}

function toolToggleKnobStyle(enabled: boolean): CSSProperties {
  return {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 18,
    height: 18,
    borderRadius: 999,
    background: enabled ? 'var(--hesper-color-surface, #16161e)' : 'var(--hesper-color-text-muted, #737aa2)',
    boxShadow: enabled ? '0 3px 10px rgba(0, 0, 0, 0.24)' : '0 2px 7px rgba(0, 0, 0, 0.18)',
    transform: enabled ? 'translateX(22px)' : 'translateX(0)',
    transition: 'transform 160ms ease, background 160ms ease, box-shadow 160ms ease'
  }
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

const sessionRelativeTimeStyle: CSSProperties = {
  flex: '0 0 auto',
  color: 'var(--hesper-color-text-muted, #737aa2)',
  fontSize: 11,
  fontWeight: 600,
  opacity: 0.72,
  whiteSpace: 'nowrap'
}

const newMessageIconSlotStyle: CSSProperties = {
  width: 18,
  height: 18,
  flex: '0 0 18px',
  display: 'inline-grid',
  placeItems: 'center',
  color: 'var(--hesper-color-accent, #7aa2f7)'
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
