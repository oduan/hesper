import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { themeTokens } from '../theme'

export type AppSection = 'sessions' | 'skills' | 'roles' | 'tools' | 'settings'

type SessionCategoryListItem = {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
}

export type ActivityRailSessionScopeCounts = {
  all: number
  marked: number
  archived: number
  byCategoryId?: Record<string, number>
}

export type ActivityRailProps = {
  activeSection: AppSection
  onCreateSession?: () => void | Promise<void>
  onSelectSection?: (section: AppSection) => void
  sessionCategories?: SessionCategoryListItem[]
  sessionScopeCounts?: ActivityRailSessionScopeCounts
  activeSessionCategoryId?: string
  activeSessionSpecialView?: 'marked' | 'archived'
  sessionsExpanded?: boolean
  onToggleSessionsExpanded?: () => void
  onSelectSessionCategory?: (categoryId?: string) => void
  onSelectSessionSpecialView?: (view: 'marked' | 'archived') => void
  onCreateSessionCategory?: () => Promise<SessionCategoryListItem | undefined>
  onRenameSessionCategory?: (categoryId: string, name: string) => void | Promise<void>
  onDeleteSessionCategory?: (categoryId: string) => void | Promise<void>
  onDiscardSessionCategory?: (categoryId: string) => void | Promise<void>
}

type EditingCategoryState = { id: string; name: string; isNew: boolean; realId?: string; pendingCreate?: boolean; queuedCommit?: boolean }
type CategoryMenuState = { kind: 'all' | 'category'; categoryId?: string; x: number; y: number }

type CategoryMenuAction = 'create' | 'rename' | 'delete'

type NavIconName = 'sessions' | 'category' | 'marked' | 'archived' | 'skills' | 'roles' | 'tools' | 'settings'

type NavSection = { id: AppSection; label: string; visibleLabel: string; icon: NavIconName }

const sections: NavSection[] = [
  { id: 'sessions', label: '会话', visibleLabel: '会话', icon: 'sessions' },
  { id: 'skills', label: '技能', visibleLabel: '技能', icon: 'skills' },
  { id: 'roles', label: '角色', visibleLabel: '角色', icon: 'roles' },
  { id: 'tools', label: '工具', visibleLabel: '工具', icon: 'tools' },
  { id: 'settings', label: '设置', visibleLabel: '设置', icon: 'settings' }
]

const defaultSessionScopeCounts: ActivityRailSessionScopeCounts = {
  all: 0,
  marked: 0,
  archived: 0,
  byCategoryId: {}
}

function NavigationIcon({ name }: { name: NavIconName }) {
  return (
    <span aria-hidden="true" className="hesper-nav-icon" data-hesper-nav-icon={name} style={navIconSlotStyle}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
        {name === 'sessions' ? (
          <>
            <path d="M3.1 3.4h9.8c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H7.1L4 13.7v-2H3.1c-.6 0-1.1-.5-1.1-1.1V4.5c0-.6.5-1.1 1.1-1.1Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
            <path d="M4.8 6.3h6.4M4.8 8.6h4.4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </>
        ) : name === 'category' ? (
          <path d="M2.5 4.5c0-.7.5-1.2 1.2-1.2h3l1.1 1.4h4.5c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2v-7Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        ) : name === 'marked' ? (
          <path d="M4.2 2.8c0-.5.4-.9.9-.9h5.8c.5 0 .9.4.9.9v9.4c0 .7-.8 1.1-1.4.7L8 11.3l-2.4 1.6c-.6.4-1.4 0-1.4-.7V2.8Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        ) : name === 'archived' ? (
          <>
            <path d="M2.8 5.6h10.4v6.1c0 .7-.5 1.2-1.2 1.2H4c-.7 0-1.2-.5-1.2-1.2V5.6Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
            <path d="M2.2 3.6c0-.4.3-.7.7-.7h10.2c.4 0 .7.3.7.7v2H2.2v-2ZM6.1 8.1h3.8" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : name === 'skills' ? (
          <>
            <path d="M8 1.9 9.2 5l3.3 1.1-3.3 1.2L8 10.4 6.8 7.3 3.5 6.1 6.8 5 8 1.9Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
            <path d="M4.4 10.1 5 11.8l1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7ZM12 9.7l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z" fill="currentColor" />
          </>
        ) : name === 'roles' ? (
          <>
            <path d="M8 8.1a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z" fill="none" stroke="currentColor" strokeWidth="1.35" />
            <path d="M3.3 13.4c.5-2.2 2.3-3.5 4.7-3.5s4.2 1.3 4.7 3.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          </>
        ) : name === 'tools' ? (
          <path d="M9.4 2.4a3.6 3.6 0 0 0 4.2 4.2l-5.8 5.8a2.2 2.2 0 0 1-3.1-3.1l5.8-5.8ZM4.6 11.4l-2 2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.35" />
            <path d="M8 1.9v1.4M8 12.7v1.4M3.7 3.7l1 1M11.3 11.3l1 1M1.9 8h1.4M12.7 8h1.4M3.7 12.3l1-1M11.3 4.7l1-1" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  )
}

function NavigationCount({ scope, value }: { scope: 'all' | 'category' | 'marked' | 'archived'; value: number }) {
  return (
    <span aria-hidden="true" className="hesper-nav-count" data-hesper-nav-count={scope} style={navCountStyle}>
      {value}
    </span>
  )
}

function SessionDisclosureIcon({ expanded }: { expanded: boolean }) {
  return (
    <span data-testid="sessions-disclosure-icon" data-state={expanded ? 'expanded' : 'collapsed'} style={disclosureIconSlotStyle}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
        {expanded ? (
          <path d="M4.2 6.1 8 9.9l3.8-3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M6.1 4.2 9.9 8l-3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  )
}

export function ActivityRail({
  activeSection,
  onCreateSession,
  onSelectSection,
  sessionCategories = [],
  sessionScopeCounts = defaultSessionScopeCounts,
  activeSessionCategoryId,
  activeSessionSpecialView,
  sessionsExpanded,
  onToggleSessionsExpanded,
  onSelectSessionCategory,
  onSelectSessionSpecialView,
  onCreateSessionCategory,
  onRenameSessionCategory,
  onDeleteSessionCategory,
  onDiscardSessionCategory
}: ActivityRailProps) {
  const [fallbackSessionsExpanded, setFallbackSessionsExpanded] = useState(() => sessionsExpanded ?? true)
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState>()
  const [editingCategory, setEditingCategory] = useState<EditingCategoryState>()
  const renameInputRef = useRef<HTMLInputElement>(null)
  const categoryMenuFirstItemRef = useRef<HTMLButtonElement>(null)
  const editingCategoryRef = useRef<EditingCategoryState | undefined>(undefined)
  const committingCategoryIdRef = useRef<string | undefined>(undefined)
  const cancelledDraftCategoryIdsRef = useRef<Set<string>>(new Set())
  const draftCategoryIdRef = useRef(0)
  const isSessionsExpandedControlled = sessionsExpanded !== undefined && onToggleSessionsExpanded !== undefined
  const effectiveSessionsExpanded = isSessionsExpandedControlled ? sessionsExpanded : fallbackSessionsExpanded
  const sessionCategoriesForDisplay = editingCategory?.isNew && editingCategory.realId
    ? sessionCategories.filter((category) => category.id !== editingCategory.realId)
    : sessionCategories
  const visibleCategories =
    editingCategory?.isNew && !sessionCategoriesForDisplay.some((category) => category.id === editingCategory.id)
      ? [...sessionCategoriesForDisplay, { id: editingCategory.id, name: editingCategory.name }]
      : sessionCategoriesForDisplay

  useEffect(() => {
    if (!isSessionsExpandedControlled && sessionsExpanded !== undefined) {
      setFallbackSessionsExpanded(sessionsExpanded)
    }
  }, [isSessionsExpandedControlled, sessionsExpanded])

  useEffect(() => {
    if (!categoryMenu) return undefined

    const close = () => setCategoryMenu(undefined)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('click', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [categoryMenu])

  useEffect(() => {
    if (categoryMenu) {
      categoryMenuFirstItemRef.current?.focus()
    }
  }, [categoryMenu])

  useEffect(() => {
    editingCategoryRef.current = editingCategory
  }, [editingCategory])

  useEffect(() => {
    if (!editingCategory) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [editingCategory?.id])

  const setSessionsExpanded = (expanded: boolean) => {
    if (effectiveSessionsExpanded === expanded) return
    if (isSessionsExpandedControlled) {
      onToggleSessionsExpanded()
      return
    }
    setFallbackSessionsExpanded(expanded)
  }

  const handleToggleSessionsExpanded = () => {
    setCategoryMenu(undefined)
    setSessionsExpanded(!effectiveSessionsExpanded)
  }

  const handleSelectAllSessions = () => {
    onSelectSection?.('sessions')
    onSelectSessionCategory?.(undefined)
  }

  const handleSelectCategory = (categoryId: string) => {
    onSelectSection?.('sessions')
    onSelectSessionCategory?.(categoryId)
  }

  const handleSelectSpecialView = (view: 'marked' | 'archived') => {
    onSelectSection?.('sessions')
    onSelectSessionSpecialView?.(view)
  }

  const openAllCategoriesMenu = (x: number, y: number) => {
    setCategoryMenu({ kind: 'all', x, y })
  }

  const openCategoryMenu = (categoryId: string, x: number, y: number) => {
    setCategoryMenu({ kind: 'category', categoryId, x, y })
  }

  const startRenameCategory = (categoryId: string, isNew = false) => {
    const category = visibleCategories.find((candidate) => candidate.id === categoryId)
    if (!category) return
    setEditingCategory({ id: category.id, name: category.name, isNew })
  }

  const cancelEditingCategory = () => {
    const current = editingCategory
    setEditingCategory(undefined)
    if (!current?.isNew) return
    if (current.pendingCreate) {
      cancelledDraftCategoryIdsRef.current.add(current.id)
      return
    }
    void onDeleteSessionCategory?.(current.realId ?? current.id)
  }

  const commitEditingCategoryFor = async (current: EditingCategoryState, existingNameOverride?: string) => {
    if (committingCategoryIdRef.current === current.id) return

    if (current.pendingCreate) {
      setEditingCategory((candidate) => (candidate?.id === current.id ? { ...candidate, queuedCommit: true } : candidate))
      return
    }

    const targetCategoryId = current.realId ?? current.id
    const nextName = current.name.trim()
    const existingName = existingNameOverride ?? sessionCategories.find((category) => category.id === targetCategoryId)?.name

    if (!nextName) {
      setEditingCategory(undefined)
      if (current.isNew) {
        await onDeleteSessionCategory?.(targetCategoryId)
      }
      return
    }

    if (!current.isNew && nextName === existingName) {
      setEditingCategory(undefined)
      return
    }

    committingCategoryIdRef.current = current.id
    try {
      await onRenameSessionCategory?.(targetCategoryId, nextName)
      setEditingCategory((candidate) => (candidate?.id === current.id ? undefined : candidate))
    } finally {
      if (committingCategoryIdRef.current === current.id) {
        committingCategoryIdRef.current = undefined
      }
    }
  }

  const commitEditingCategory = async () => {
    if (!editingCategory) return
    await commitEditingCategoryFor(editingCategory)
  }

  const handleCategoryMenuAction = async (action: CategoryMenuAction, menuState: CategoryMenuState) => {
    setCategoryMenu(undefined)

    switch (action) {
      case 'create': {
        const draftId = `category-draft-${++draftCategoryIdRef.current}`
        setSessionsExpanded(true)
        onSelectSection?.('sessions')
        setEditingCategory({ id: draftId, name: '新分类', isNew: true, pendingCreate: true })

        const category = await onCreateSessionCategory?.()
        if (!category) {
          setEditingCategory((candidate) => (candidate?.id === draftId ? undefined : candidate))
          return
        }

        const latestEditingCategory = editingCategoryRef.current
        if (cancelledDraftCategoryIdsRef.current.has(draftId) || latestEditingCategory?.id !== draftId) {
          cancelledDraftCategoryIdsRef.current.delete(draftId)
          await onDiscardSessionCategory?.(category.id)
          return
        }

        onSelectSessionCategory?.(category.id)
        const nextEditingCategory: EditingCategoryState = { ...latestEditingCategory, realId: category.id, pendingCreate: false }
        setEditingCategory(nextEditingCategory)
        if (nextEditingCategory.queuedCommit) {
          await commitEditingCategoryFor(nextEditingCategory, category.name)
        }
        return
      }
      case 'rename': {
        if (!menuState.categoryId) return
        startRenameCategory(menuState.categoryId)
        return
      }
      case 'delete': {
        if (!menuState.categoryId) return
        const categoryId = menuState.categoryId
        window.setTimeout(() => {
          void onDeleteSessionCategory?.(categoryId)
        }, 0)
        return
      }
    }
  }

  return (
    <aside
      aria-label="功能栏"
      style={{
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: `${themeTokens.spacing.sm} ${themeTokens.spacing.sm} ${themeTokens.spacing.md}`,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: themeTokens.spacing.md
      }}
    >
      <button
        type="button"
        className="hesper-nav-item hesper-nav-item-strong"
        aria-label="新建会话"
        onClick={() => {
          void onCreateSession?.()
        }}
      >
        新建会话
      </button>
      <nav aria-label="主导航" style={{ display: 'grid', gap: 2 }}>
        {sections.map((section) => {
          if (section.id === 'sessions') {
            const isAllSessionsActive = activeSection === 'sessions' && !activeSessionCategoryId && !activeSessionSpecialView
            const disclosureLabel = effectiveSessionsExpanded ? '收起会话分类' : '展开会话分类'
            return (
              <div key={section.id} style={sessionsGroupStyle}>
                <div
                  className={`hesper-nav-item${isAllSessionsActive ? ' is-active' : ''}`}
                  style={allSessionsPrimaryRowStyle}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openAllCategoriesMenu(event.clientX, event.clientY)
                  }}
                >
                  <button
                    type="button"
                    aria-label={disclosureLabel}
                    aria-expanded={effectiveSessionsExpanded}
                    onClick={handleToggleSessionsExpanded}
                    style={sessionsDisclosureButtonStyle}
                  >
                    <SessionDisclosureIcon expanded={effectiveSessionsExpanded} />
                  </button>
                  <button
                    type="button"
                    className={isAllSessionsActive ? 'is-active' : undefined}
                    aria-current={isAllSessionsActive ? 'page' : undefined}
                    aria-label="所有会话"
                    onClick={handleSelectAllSessions}
                    style={allSessionsPrimaryButtonStyle}
                  >
                    <NavigationIcon name="sessions" />
                    <span style={navLabelStyle}>所有会话</span>
                    <NavigationCount scope="all" value={sessionScopeCounts.all} />
                  </button>
                </div>
                {effectiveSessionsExpanded ? (
                  <nav aria-label="会话分类导航" style={sessionCategoryListStyle}>
                    {visibleCategories.length > 0 ? <span aria-hidden="true" data-testid="session-category-connector" style={sessionCategoryConnectorStyle} /> : null}
                    {visibleCategories.map((category) => {
                      const isEditing = editingCategory?.id === category.id
                      const isActive = activeSection === 'sessions' && activeSessionCategoryId === category.id
                      return (
                        <div key={category.id} style={categoryItemWrapperStyle}>
                          {isEditing ? (
                            <div className="hesper-session-category-row is-active" style={{ ...categoryRowStyle, cursor: 'text' }}>
                              <span data-testid={`session-category-surface-${category.id}`} className="hesper-session-category-surface" style={categorySurfaceStyle}>
                                <input
                                  ref={renameInputRef}
                                  aria-label="重命名分类"
                                  value={editingCategory.name}
                                  onClick={(event) => {
                                    if (editingCategory.isNew) {
                                      event.currentTarget.select()
                                    }
                                  }}
                                  onChange={(event) => {
                                    const nextName = event.currentTarget.value
                                    setEditingCategory((current) => (current?.id === category.id ? { ...current, name: nextName } : current))
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitEditingCategory()
                                    } else if (event.key === 'Escape') {
                                      event.preventDefault()
                                      cancelEditingCategory()
                                    }
                                  }}
                                  onBlur={() => {
                                    commitEditingCategory()
                                  }}
                                  style={categoryRenameInputStyle}
                                />
                              </span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={`hesper-session-category-row${isActive ? ' is-active' : ''}`}
                              aria-current={isActive ? 'page' : undefined}
                              aria-label={category.name}
                              onClick={() => handleSelectCategory(category.id)}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                openCategoryMenu(category.id, event.clientX, event.clientY)
                              }}
                              style={categoryRowStyle}
                            >
                              <span data-testid={`session-category-surface-${category.id}`} className="hesper-session-category-surface" style={categorySurfaceStyle}>
                                <NavigationIcon name="category" />
                                <span style={navLabelStyle}>{category.name}</span>
                                <NavigationCount scope="category" value={sessionScopeCounts.byCategoryId?.[category.id] ?? 0} />
                              </span>
                            </button>
                          )}
                        </div>
                      )
                    })}
                    <span aria-hidden="true" data-testid="session-special-separator" style={sessionSpecialSeparatorStyle} />
                    <button
                      type="button"
                      className={`hesper-session-category-row${activeSection === 'sessions' && activeSessionSpecialView === 'marked' ? ' is-active' : ''}`}
                      aria-current={activeSection === 'sessions' && activeSessionSpecialView === 'marked' ? 'page' : undefined}
                      aria-label="已标记"
                      onClick={() => handleSelectSpecialView('marked')}
                      style={categoryRowStyle}
                    >
                      <span className="hesper-session-category-surface" style={categorySurfaceStyle}>
                        <NavigationIcon name="marked" />
                        <span style={navLabelStyle}>已标记</span>
                        <NavigationCount scope="marked" value={sessionScopeCounts.marked} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`hesper-session-category-row${activeSection === 'sessions' && activeSessionSpecialView === 'archived' ? ' is-active' : ''}`}
                      aria-current={activeSection === 'sessions' && activeSessionSpecialView === 'archived' ? 'page' : undefined}
                      aria-label="归档"
                      onClick={() => handleSelectSpecialView('archived')}
                      style={categoryRowStyle}
                    >
                      <span className="hesper-session-category-surface" style={categorySurfaceStyle}>
                        <NavigationIcon name="archived" />
                        <span style={navLabelStyle}>归档</span>
                        <NavigationCount scope="archived" value={sessionScopeCounts.archived} />
                      </span>
                    </button>
                  </nav>
                ) : null}
              </div>
            )
          }

          const isActive = section.id === activeSection
          return (
            <button
              key={section.id}
              type="button"
              className={`hesper-nav-item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={section.label}
              onClick={() => onSelectSection?.(section.id)}
              style={navSectionButtonStyle}
            >
              <NavigationIcon name={section.icon} />
              <span style={navLabelStyle}>{section.visibleLabel}</span>
            </button>
          )
        })}
      </nav>
      {categoryMenu ? (
        <div
          role="menu"
          aria-label={categoryMenu.kind === 'all' ? '会话分类操作' : '分类操作'}
          style={{
            ...categoryMenuStyle,
            left: categoryMenu.x,
            top: categoryMenu.y
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <style>{categoryMenuHoverCss}</style>
          {categoryMenu.kind === 'all' ? (
            <button
              ref={categoryMenuFirstItemRef}
              type="button"
              role="menuitem"
              className="hesper-category-menu-item"
              onClick={() => {
                void handleCategoryMenuAction('create', categoryMenu)
              }}
              style={categoryMenuItemStyle}
            >
              <span>新建分类</span>
            </button>
          ) : (
            <>
              <button
                ref={categoryMenuFirstItemRef}
                type="button"
                role="menuitem"
                className="hesper-category-menu-item"
                onClick={() => {
                  void handleCategoryMenuAction('rename', categoryMenu)
                }}
                style={categoryMenuItemStyle}
              >
                <span>重命名</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="hesper-category-menu-item"
                onClick={() => {
                  void handleCategoryMenuAction('delete', categoryMenu)
                }}
                style={{ ...categoryMenuItemStyle, color: themeTokens.color.danger }}
              >
                <span>删除</span>
              </button>
            </>
          )}
        </div>
      ) : null}
    </aside>
  )
}

const disclosureIconSlotStyle: CSSProperties = {
  width: 16,
  height: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 16px'
}

const navIconSlotStyle: CSSProperties = {
  width: 16,
  height: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 16px',
  opacity: 0.82
}

const navLabelStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const navCountStyle: CSSProperties = {
  marginLeft: 'auto',
  minWidth: 18,
  textAlign: 'right',
  color: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: '16px',
  fontVariantNumeric: 'tabular-nums'
}

const navSectionButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0
}

const sessionsGroupStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  minWidth: 0
}

const activityRailItemHeight = 32

const allSessionsPrimaryRowStyle: CSSProperties = {
  minHeight: activityRailItemHeight,
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  width: '100%',
  padding: '0 10px 0 4px',
  gap: 4,
  boxSizing: 'border-box'
}

const sessionsDisclosureButtonStyle: CSSProperties = {
  width: 24,
  height: activityRailItemHeight,
  flex: '0 0 24px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  padding: 0,
  cursor: 'pointer'
}

const allSessionsPrimaryButtonStyle: CSSProperties = {
  flex: 1,
  alignSelf: 'stretch',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  padding: 0,
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left'
}

const sessionCategoryConnectorLeft = 16
const sessionCategorySurfaceLeft = sessionCategoryConnectorLeft + 4
const sessionCategoryTextInset = 12

const sessionCategoryListStyle: CSSProperties = {
  position: 'relative',
  display: 'grid',
  gap: 2,
  minWidth: 0
}

const sessionCategoryConnectorStyle: CSSProperties = {
  position: 'absolute',
  left: sessionCategoryConnectorLeft,
  top: -2,
  bottom: 6,
  width: 1,
  borderRadius: 1,
  background: themeTokens.color.border,
  pointerEvents: 'none',
  zIndex: 2
}

const categoryItemWrapperStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1
}

const sessionSpecialSeparatorStyle: CSSProperties = {
  margin: `3px 0 3px ${sessionCategorySurfaceLeft + sessionCategoryTextInset}px`,
  height: 1,
  background: themeTokens.color.border,
  borderRadius: 1
}

const categoryRowStyle: CSSProperties = {
  width: '100%',
  minHeight: activityRailItemHeight,
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  border: 0,
  outline: 0,
  borderRadius: 0,
  background: 'transparent',
  color: themeTokens.color.textMuted,
  padding: 0,
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left'
}

const categorySurfaceStyle: CSSProperties = {
  marginLeft: sessionCategorySurfaceLeft,
  width: `calc(100% - ${sessionCategorySurfaceLeft}px)`,
  minHeight: activityRailItemHeight,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  boxSizing: 'border-box',
  borderRadius: 10,
  paddingLeft: sessionCategoryTextInset,
  paddingRight: 10,
  transition: 'background 120ms ease, color 120ms ease'
}

const categoryRenameInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 600,
  padding: 0
}

const categoryMenuStyle: CSSProperties = {
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

const categoryMenuItemStyle: CSSProperties = {
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

const categoryMenuHoverCss = `
.hesper-category-menu-item::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: ${themeTokens.color.hover};
  opacity: 0;
  transition: opacity 160ms ease;
}

.hesper-category-menu-item:hover::after,
.hesper-category-menu-item:focus-visible::after {
  opacity: 1;
}

.hesper-category-menu-item > span {
  position: relative;
  z-index: 1;
}
`
