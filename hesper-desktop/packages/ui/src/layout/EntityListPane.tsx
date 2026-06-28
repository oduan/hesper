import { useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent as ReactWheelEvent } from 'react'
import type { Session, ToolDefinition } from '@hesper/shared'
import { RunningStatusIcon } from '../conversation/RunningStatusIcon'
import { themeTokens } from '../theme'
import type { AppSection } from './ActivityRail'

const paneSurfaceShadow = `0 2px 6px -4px ${themeTokens.color.shadow}`

type ToolListItem = ToolDefinition & { enabled: boolean }

export type RoleListItem = {
  id: string
  name: string
  description?: string
}

export type SkillListItem = {
  id: string
  name: string
  description?: string
}

export type SessionCategoryListItem = {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
}

export type SettingsCategory = 'ai' | 'appearance' | 'ssh' | 'soul'

export type EntityListPaneProps = {
  title?: string
  activeSection: AppSection
  sessions: Session[]
  activeSessionId?: string
  runningSessionIds?: string[]
  sessionCategories?: SessionCategoryListItem[]
  tools?: ToolListItem[]
  activeToolId?: string
  pendingToolIds?: string[]
  roles?: RoleListItem[]
  activeRoleId?: string
  skills?: SkillListItem[]
  activeSkillId?: string
  roleSelectionDisabled?: boolean
  activeSettingsCategory?: SettingsCategory
  onSelectSession?: (sessionId: string) => void
  onSelectTool?: (toolId: string) => void
  onToggleToolEnabled?: (toolId: string, enabled: boolean) => void
  onSelectRole?: (roleId: string) => void
  onSelectSkill?: (skillId: string) => void
  onSelectSettingsCategory?: (category: SettingsCategory) => void
  onRenameSession?: (sessionId: string, title: string) => void
  onRegenerateSessionTitle?: (sessionId: string, sessionIds?: string[]) => void
  onArchiveSession?: (sessionId: string, sessionIds?: string[]) => void
  onRestoreSession?: (sessionId: string, sessionIds?: string[]) => void
  onDeleteSession?: (sessionId: string, sessionIds?: string[]) => void
  onSetSessionCategory?: (sessionId: string, sessionIds: string[] | undefined, categoryId?: string) => void
  onSetSessionMarked?: (sessionId: string, sessionIds: string[] | undefined, isMarked: boolean) => void
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

type SessionMenuItemKey = 'rename' | 'regenerate-title' | 'category' | 'mark' | 'unmark' | 'archive' | 'restore' | 'delete'

type SessionMenuItem = {
  key: SessionMenuItemKey
  label: string
  danger?: boolean
  hasSubmenu?: boolean
}

type RoleMenuItem = {
  key: 'delete'
  label: string
  danger?: boolean
}

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
        <circle cx="11.9" cy="4.2" r="2.15" fill={themeTokens.color.accent} stroke={themeTokens.color.surface} strokeWidth="1" />
      </svg>
    </span>
  )
}

function MarkedFlagIcon({ sessionId }: { sessionId: string }) {
  return (
    <span aria-hidden="true" data-testid={`session-marked-icon-${sessionId}`} style={markedFlagIconStyle}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: 'block' }}>
        <path d="M4 2.7c0-.5.4-.9.9-.9h6.2c.5 0 .9.4.9.9v8.8c0 .7-.8 1.1-1.4.7L8 10.4l-2.6 1.8c-.6.4-1.4 0-1.4-.7V2.7Z" fill="currentColor" />
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
  sessionCategories = [],
  tools = [],
  activeToolId,
  pendingToolIds = [],
  roles = [],
  activeRoleId,
  skills = [],
  activeSkillId,
  roleSelectionDisabled = false,
  activeSettingsCategory = 'ai',
  onSelectSession,
  onSelectTool,
  onToggleToolEnabled,
  onSelectRole,
  onSelectSkill,
  onSelectSettingsCategory,
  onRenameSession,
  onRegenerateSessionTitle,
  onArchiveSession,
  onRestoreSession,
  onDeleteSession,
  onSetSessionCategory,
  onSetSessionMarked,
  onDeleteRole
}: EntityListPaneProps) {
  const heading = title ?? (activeSection === 'sessions' ? '所有会话' : activeSection === 'settings' ? '设置' : activeSection === 'tools' ? '工具' : activeSection === 'roles' ? '角色' : activeSection === 'skills' ? '技能' : '列表')
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>()
  const [sessionCategorySubmenuOpen, setSessionCategorySubmenuOpen] = useState(false)
  const [roleMenu, setRoleMenu] = useState<RoleMenuState>()
  const [editingSession, setEditingSession] = useState<EditingSessionState>()
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [selectionAnchorSessionId, setSelectionAnchorSessionId] = useState<string>()
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [selectionAnchorRoleId, setSelectionAnchorRoleId] = useState<string>()
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now())
  const [isSessionScrollbarVisible, setIsSessionScrollbarVisible] = useState(false)
  const runningSessionIdSet = useMemo(() => new Set(runningSessionIds), [runningSessionIds])
  const pendingToolIdSet = useMemo(() => new Set(pendingToolIds), [pendingToolIds])
  const sessionCategoryNameById = useMemo(() => new Map(sessionCategories.map((category) => [category.id, category.name])), [sessionCategories])
  const selectedSessionIdSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds])
  const selectedRoleIdSet = useMemo(() => new Set(selectedRoleIds), [selectedRoleIds])
  const renameInputRef = useRef<HTMLInputElement>(null)
  const roleMenuFirstItemRef = useRef<HTMLButtonElement>(null)
  const sessionListRef = useRef<HTMLUListElement>(null)
  const sessionScrollbarHideTimeoutRef = useRef<number | undefined>(undefined)

  const clearSessionScrollbarHideTimeout = () => {
    if (sessionScrollbarHideTimeoutRef.current === undefined) return
    window.clearTimeout(sessionScrollbarHideTimeoutRef.current)
    sessionScrollbarHideTimeoutRef.current = undefined
  }

  const showSessionScrollbar = () => {
    if (activeSection !== 'sessions') return
    clearSessionScrollbarHideTimeout()
    setIsSessionScrollbarVisible(true)
  }

  const scheduleSessionScrollbarHide = () => {
    if (activeSection !== 'sessions') return
    clearSessionScrollbarHideTimeout()
    sessionScrollbarHideTimeoutRef.current = window.setTimeout(() => {
      setIsSessionScrollbarVisible(false)
      sessionScrollbarHideTimeoutRef.current = undefined
    }, 2_000)
  }

  const handleEntityPaneWheelCapture = (event: ReactWheelEvent<HTMLElement>) => {
    if (activeSection !== 'sessions') return
    const sessionList = sessionListRef.current
    if (!sessionList) return

    const target = event.target
    if (target instanceof Node && sessionList.contains(target)) return

    const maxScrollTop = Math.max(0, sessionList.scrollHeight - sessionList.clientHeight)
    if (maxScrollTop <= 0 || event.deltaY === 0) return

    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, sessionList.scrollTop + event.deltaY))
    if (nextScrollTop === sessionList.scrollTop) return

    event.preventDefault()
    sessionList.scrollTop = nextScrollTop
  }

  useEffect(() => {
    if (activeSection === 'sessions') return undefined
    clearSessionScrollbarHideTimeout()
    setIsSessionScrollbarVisible(false)
    return undefined
  }, [activeSection])

  useEffect(() => () => {
    clearSessionScrollbarHideTimeout()
  }, [])

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
      setSessionCategorySubmenuOpen(false)
      setRoleMenu(undefined)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [sessionMenu, roleMenu])

  useEffect(() => {
    if (roleMenu) {
      roleMenuFirstItemRef.current?.focus()
    }
  }, [roleMenu])

  useEffect(() => {
    if (roleSelectionDisabled) {
      setRoleMenu(undefined)
    }
  }, [roleSelectionDisabled])

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
    if (activeSection !== 'sessions' || !activeSessionId || selectedSessionIds.length === 0) return
    if (!sessions.some((session) => session.id === activeSessionId)) return
    if (selectedSessionIds.includes(activeSessionId)) return

    setSelectedSessionIds([activeSessionId])
    setSelectionAnchorSessionId(activeSessionId)
  }, [activeSection, activeSessionId, selectedSessionIds, sessions])

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
    if (roleSelectionDisabled) return

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
    const isSelectedTarget = selectedSessionIdSet.has(sessionId)
    const sessionIds = isSelectedTarget ? selectedTargets : [sessionId]

    setRoleMenu(undefined)
    setSessionCategorySubmenuOpen(false)
    setSessionMenu({ sessionId, sessionIds, x, y })
  }

  const openRoleMenu = (roleId: string, x: number, y: number) => {
    if (roleSelectionDisabled) return

    const roleIdSet = new Set(roles.map((role) => role.id))
    const selectedTargets = selectedRoleIds.filter((selectedRoleId) => roleIdSet.has(selectedRoleId))
    const isSelectedTarget = selectedRoleIdSet.has(roleId)
    const roleIds = isSelectedTarget ? selectedTargets : [roleId]

    if (!isSelectedTarget) {
      setSelectedRoleIds([roleId])
      setSelectionAnchorRoleId(roleId)
    }

    setSessionMenu(undefined)
    setSessionCategorySubmenuOpen(false)
    setRoleMenu({ roleId, roleIds, x, y })
  }

  const openRoleMenuFromKeyboard = (roleId: string, target: HTMLElement) => {
    if (roleSelectionDisabled) return

    const rect = target.getBoundingClientRect()
    openRoleMenu(roleId, rect.left + 12, rect.top + Math.min(rect.height, 32))
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

  const getSessionMenuItems = (menuState: SessionMenuState): SessionMenuItem[] => {
    const targetSessions = menuState.sessionIds
      .map((sessionId) => sessions.find((session) => session.id === sessionId))
      .filter((session): session is Session => Boolean(session))
    const allMarked = targetSessions.length > 0 && targetSessions.every((session) => session.isMarked)
    const allArchived = targetSessions.length > 0 && targetSessions.every((session) => session.status === 'archived')

    return [
      { key: 'rename', label: '重命名' },
      { key: 'regenerate-title', label: '重新生成标题' },
      { key: 'category', label: '分类', hasSubmenu: true },
      allMarked ? { key: 'unmark', label: '取消标记' } : { key: 'mark', label: '标记' },
      allArchived ? { key: 'restore', label: '取消归档' } : { key: 'archive', label: '归档' },
      { key: 'delete', label: '删除', danger: true }
    ]
  }

  const handleMenuAction = (action: SessionMenuItemKey, menuState: SessionMenuState) => {
    if (action === 'category') {
      setSessionCategorySubmenuOpen(true)
      return
    }

    setSessionMenu(undefined)
    setSessionCategorySubmenuOpen(false)
    switch (action) {
      case 'rename':
        startRenameSession(menuState.sessionId)
        return
      case 'regenerate-title':
        onRegenerateSessionTitle?.(menuState.sessionId, menuState.sessionIds)
        return
      case 'mark':
        onSetSessionMarked?.(menuState.sessionId, menuState.sessionIds, true)
        return
      case 'unmark':
        onSetSessionMarked?.(menuState.sessionId, menuState.sessionIds, false)
        return
      case 'archive':
        onArchiveSession?.(menuState.sessionId, menuState.sessionIds)
        return
      case 'restore':
        onRestoreSession?.(menuState.sessionId, menuState.sessionIds)
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
      onMouseEnter={showSessionScrollbar}
      onMouseMove={showSessionScrollbar}
      onMouseLeave={scheduleSessionScrollbarHide}
      onWheelCapture={handleEntityPaneWheelCapture}
      style={{
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        background: themeTokens.color.surface,
        borderColor: themeTokens.color.border,
        borderStyle: 'solid',
        borderWidth: '1px',
        borderRadius: themeTokens.radius.xl,
        boxShadow: paneSurfaceShadow,
        padding: themeTokens.spacing.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: themeTokens.spacing.md,
        overflow: 'hidden'
      }}
    >
      <header style={{ position: 'relative', minHeight: 24 }}>
        <h2 style={{ margin: 0, fontSize: themeTokens.typography.body, lineHeight: '24px', textAlign: 'center', fontWeight: 500 }}>{heading}</h2>
      </header>
      {activeSection === 'sessions' ? (
        sessions.length > 0 ? (
          <ul
            ref={sessionListRef}
            aria-label="会话列表"
            className={`hesper-theme-scrollbar hesper-session-list-scrollbar ${isSessionScrollbarVisible ? 'is-scrollbar-visible' : 'is-scrollbar-hidden'}`}
            style={sessionListStyle}
          >
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              const isSelected = selectedSessionIdSet.has(session.id)
              const isRunning = runningSessionIdSet.has(session.id)
              const hasUnreadCompletion = Boolean(session.unreadCompletedAt)
              const isEditingSession = editingSession?.sessionId === session.id
              const hasLeadingStatusIcon = !isEditingSession && (isRunning || hasUnreadCompletion)
              const relativeUpdatedAt = formatRelativeSessionTime(session.updatedAt, relativeNowMs)
              const sessionRowClassName = `hesper-list-row${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`
              return (
                <li key={session.id} className="hesper-session-list-item" data-hesper-session-divider="true" style={sessionListItemStyle(hasLeadingStatusIcon)}>
                  {isEditingSession ? (
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
                      <div style={sessionMetaRowStyle}>
                        {session.isMarked ? (
                          <>
                            <MarkedFlagIcon sessionId={session.id} />
                            {session.categoryId && sessionCategoryNameById.get(session.categoryId) ? (
                              <span data-testid={`session-category-chip-${session.id}`} style={sessionCategoryChipStyle}>
                                {sessionCategoryNameById.get(session.categoryId)}
                              </span>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      {relativeUpdatedAt ? <span aria-hidden="true" style={sessionRelativeTimeStyle}>{relativeUpdatedAt}</span> : null}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{ margin: 'auto', color: themeTokens.color.textMuted, fontSize: themeTokens.typography.body, textAlign: 'center' }}>暂无会话</div>
        )
      ) : activeSection === 'roles' ? (
        <div style={{ display: 'grid', minHeight: 0 }}>
          {roles.length > 0 ? (
            <ul aria-label="角色列表" className="hesper-theme-scrollbar" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, overflow: 'auto', minHeight: 0 }}>
              {roles.map((role) => {
                const isActive = role.id === activeRoleId
                const isSelected = selectedRoleIdSet.has(role.id)
                const roleDescription = role.description || '暂无简介'
                return (
                  <li key={role.id}>
                    <button
                      type="button"
                      className={`hesper-list-row${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                      data-selected={isSelected ? 'true' : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      aria-selected={isSelected ? 'true' : undefined}
                      aria-disabled={roleSelectionDisabled ? 'true' : undefined}
                      aria-label={`${role.name} ${roleDescription}`.trim()}
                      onClick={(event) => handleRoleClick(role.id, event.shiftKey)}
                      onKeyDown={(event) => {
                        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                        event.preventDefault()
                        openRoleMenuFromKeyboard(role.id, event.currentTarget)
                      }}
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
            <div style={{ margin: 'auto', color: themeTokens.color.textMuted, fontSize: themeTokens.typography.body, textAlign: 'center' }}>暂无角色</div>
          )}
        </div>
      ) : activeSection === 'skills' ? (
        skills.length > 0 ? (
          <ul aria-label="技能列表" className="hesper-theme-scrollbar" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, overflow: 'auto', minHeight: 0 }}>
            {skills.map((skill) => {
              const isActive = skill.id === activeSkillId
              const skillDescription = skill.description || '暂无简介'
              return (
                <li key={skill.id}>
                  <button
                    type="button"
                    className={`hesper-list-row${isActive ? ' is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    aria-selected={isActive ? 'true' : undefined}
                    aria-label={`${skill.name} ${skillDescription}`.trim()}
                    onClick={() => onSelectSkill?.(skill.id)}
                    style={roleRowStyle}
                  >
                    <span style={roleNameStyle}>{skill.name}</span>
                    <span style={roleDescriptionStyle}>{skillDescription}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{ margin: 'auto', color: themeTokens.color.textMuted, fontSize: themeTokens.typography.body, textAlign: 'center' }}>暂无技能</div>
        )
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
          <div style={{ margin: 'auto', color: themeTokens.color.textMuted, fontSize: themeTokens.typography.body, textAlign: 'center' }}>暂无内置工具</div>
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
                <span style={{ fontWeight: 400 }}>{category.title}</span>
                <span style={{ fontSize: themeTokens.typography.body, color: themeTokens.color.textMuted }}>{category.description}</span>
              </button>
            )
          })}
        </nav>
      ) : (
        <div style={{ margin: 'auto', color: themeTokens.color.textMuted, fontSize: themeTokens.typography.body, textAlign: 'center' }}>该区域将在后续任务接入真实数据。</div>
      )}
      {sessionMenu ? (
        <div
          role="menu"
          aria-label="会话操作"
          style={{
            ...sessionMenuStyle,
            left: sessionMenu.x,
            top: sessionMenu.y,
            overflow: sessionCategorySubmenuOpen ? 'visible' : sessionMenuStyle.overflow
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <style>{sessionMenuHoverCss}</style>
          {getSessionMenuItems(sessionMenu).map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-haspopup={item.hasSubmenu ? 'menu' : undefined}
              aria-expanded={item.hasSubmenu ? sessionCategorySubmenuOpen : undefined}
              className="hesper-session-menu-item"
              onClick={() => handleMenuAction(item.key, sessionMenu)}
              onMouseEnter={() => item.key === 'category' ? setSessionCategorySubmenuOpen(true) : setSessionCategorySubmenuOpen(false)}
              onFocus={() => item.key === 'category' ? setSessionCategorySubmenuOpen(true) : setSessionCategorySubmenuOpen(false)}
              style={{
                ...sessionMenuItemStyle,
                ...(item.danger ? { color: themeTokens.color.danger } : {})
              }}
            >
              <span>{item.label}</span>
              {item.hasSubmenu ? <span aria-hidden="true" style={{ marginLeft: 'auto' }}>›</span> : null}
            </button>
          ))}
          {sessionCategorySubmenuOpen ? (
            <div role="menu" aria-label="会话分类选项" style={sessionCategorySubmenuStyle}>
              <button
                type="button"
                role="menuitem"
                className="hesper-session-menu-item"
                style={sessionMenuItemStyle}
                onClick={() => {
                  onSetSessionCategory?.(sessionMenu.sessionId, sessionMenu.sessionIds, undefined)
                  setSessionMenu(undefined)
                  setSessionCategorySubmenuOpen(false)
                }}
              >
                未分类
              </button>
              {sessionCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  role="menuitem"
                  className="hesper-session-menu-item"
                  style={sessionMenuItemStyle}
                  onClick={() => {
                    onSetSessionCategory?.(sessionMenu.sessionId, sessionMenu.sessionIds, category.id)
                    setSessionMenu(undefined)
                    setSessionCategorySubmenuOpen(false)
                  }}
                >
                  {category.name}
                </button>
              ))}
            </div>
          ) : null}
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
          {roleMenuItems.map((item, index) => (
            <button
              key={item.key}
              ref={index === 0 ? roleMenuFirstItemRef : undefined}
              type="button"
              role="menuitem"
              className="hesper-session-menu-item"
              onClick={() => handleRoleMenuAction(item.key, roleMenu)}
              style={{
                ...sessionMenuItemStyle,
                ...(item.danger ? { color: themeTokens.color.danger } : {})
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

const settingsCategories: Array<{ id: SettingsCategory; title: string; label: string; description: string }> = [
  { id: 'ai', title: 'AI', label: 'AI 设置', description: '模型、思考、连接' },
  { id: 'ssh', title: 'SSH', label: 'SSH 设置', description: '密钥、主机、远程连接' },
  { id: 'soul', title: 'SOUL', label: 'SOUL 设置', description: '身份设定' },
  { id: 'appearance', title: '外观', label: '外观设置', description: '字体大小、亮色与暗色' }
]

// Keep these in sync with .hesper-list-row horizontal padding, status icon slots, and sessionTitleRowStyle.gap.
const sessionRowHorizontalPaddingPx = 10
const sessionLeadingStatusIconWidthPx = 18
const sessionTitleIconGapPx = 6
const sessionDividerLeftPlain = `${sessionRowHorizontalPaddingPx}px`
const sessionDividerLeftWithStatusIcon = `${sessionRowHorizontalPaddingPx + sessionLeadingStatusIconWidthPx + sessionTitleIconGapPx}px`
const sessionDividerRight = `${sessionRowHorizontalPaddingPx}px`

type SessionDividerStyle = CSSProperties & Record<'--hesper-session-divider-left' | '--hesper-session-divider-right', string>

function sessionListItemStyle(hasLeadingStatusIcon: boolean): SessionDividerStyle {
  return {
    '--hesper-session-divider-left': hasLeadingStatusIcon ? sessionDividerLeftWithStatusIcon : sessionDividerLeftPlain,
    '--hesper-session-divider-right': sessionDividerRight
  }
}

const sessionListStyle: SessionDividerStyle = {
  listStyle: 'none',
  margin: 0,
  marginRight: `-${themeTokens.spacing.lg}`,
  padding: `0 ${themeTokens.spacing.lg} 0 0`,
  '--hesper-session-divider-left': sessionDividerLeftPlain,
  '--hesper-session-divider-right': sessionDividerRight,
  display: 'grid',
  gap: 2,
  overflow: 'auto',
  minHeight: 0
}

const sessionRowStyle: CSSProperties = {
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, auto) auto',
  alignItems: 'center',
  columnGap: 8
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
  fontWeight: 400
}

const roleDescriptionStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: themeTokens.color.textMuted,
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
  fontWeight: 400
}

const toolDescriptionStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: themeTokens.color.textMuted,
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
    border: `1px solid ${enabled ? themeTokens.color.toolToggle : themeTokens.color.border}`,
    background: enabled ? themeTokens.color.toolToggle : themeTokens.color.surfaceMuted,
    boxShadow: enabled ? `0 0 0 3px ${themeTokens.color.toolToggleSoft}` : `inset 0 0 0 1px ${themeTokens.color.borderSubtle}`,
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
    background: enabled ? themeTokens.color.surface : themeTokens.color.textMuted,
    boxShadow: enabled ? `0 3px 10px ${themeTokens.color.shadow}` : `0 2px 7px ${themeTokens.color.shadow}`,
    transform: enabled ? 'translateX(22px)' : 'translateX(0)',
    transition: 'transform 160ms ease, background 160ms ease, box-shadow 160ms ease'
  }
}

const sessionTitleRowStyle: CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 400,
  overflow: 'hidden'
}

const sessionTitleTextStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const sessionMetaRowStyle: CSSProperties = {
  minWidth: 0,
  maxWidth: 120,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  overflow: 'hidden'
}

const markedFlagIconStyle: CSSProperties = {
  width: 14,
  height: 14,
  flex: '0 0 14px',
  display: 'inline-grid',
  placeItems: 'center',
  color: themeTokens.color.accent
}

const sessionCategoryChipStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: themeTokens.color.textMuted,
  fontSize: 11,
  fontWeight: 400,
  opacity: 0.82
}

const sessionRelativeTimeStyle: CSSProperties = {
  flex: '0 0 auto',
  color: themeTokens.color.textMuted,
  fontSize: 11,
  fontWeight: 400,
  opacity: 0.72,
  whiteSpace: 'nowrap'
}

const newMessageIconSlotStyle: CSSProperties = {
  width: 18,
  height: 18,
  flex: '0 0 18px',
  display: 'inline-grid',
  placeItems: 'center',
  color: themeTokens.color.accent
}

const renameInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: 0,
  outline: `1px solid ${themeTokens.color.accent}`,
  borderRadius: 6,
  background: themeTokens.color.softControl,
  color: themeTokens.color.text,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  fontWeight: 400,
  padding: '4px 6px'
}

const sessionMenuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  minWidth: 180,
  padding: '4px 0',
  borderRadius: themeTokens.radius.md,
  borderColor: themeTokens.color.border,
  borderStyle: 'solid',
  borderWidth: '1px',
  background: themeTokens.color.surfaceMuted,
  boxShadow: `0 6px 14px -8px ${themeTokens.color.shadow}`,
  overflow: 'hidden'
}

const sessionCategorySubmenuStyle: CSSProperties = {
  ...sessionMenuStyle,
  position: 'absolute',
  left: 'calc(100% + 4px)',
  top: 0,
  minWidth: 148
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
  padding: `0 ${themeTokens.spacing.md}`,
  border: 0,
  outline: 0,
  borderRadius: 0,
  background: 'transparent',
  color: themeTokens.color.text,
  fontSize: themeTokens.typography.body,
  cursor: 'pointer',
  textAlign: 'left'
}

const sessionMenuHoverCss = `
.hesper-session-menu-item::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: ${themeTokens.color.hover};
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
