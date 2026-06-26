import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { themeTokens } from '../theme'

export type AppSection = 'sessions' | 'skills' | 'roles' | 'tools' | 'settings'

type SessionCategoryListItem = {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
}

export type ActivityRailProps = {
  activeSection: AppSection
  onCreateSession?: () => void | Promise<void>
  onSelectSection?: (section: AppSection) => void
  sessionCategories?: SessionCategoryListItem[]
  activeSessionCategoryId?: string
  sessionsExpanded?: boolean
  onToggleSessionsExpanded?: () => void
  onSelectSessionCategory?: (categoryId?: string) => void
  onCreateSessionCategory?: () => Promise<SessionCategoryListItem | undefined>
  onRenameSessionCategory?: (categoryId: string, name: string) => void | Promise<void>
  onDeleteSessionCategory?: (categoryId: string) => void | Promise<void>
}

type EditingCategoryState = { id: string; name: string; isNew: boolean }
type CategoryMenuState = { kind: 'all' | 'category'; categoryId?: string; x: number; y: number }

type CategoryMenuAction = 'create' | 'rename' | 'delete'

const sections: Array<{ id: AppSection; label: string; visibleLabel: string }> = [
  { id: 'sessions', label: '会话', visibleLabel: '会话' },
  { id: 'skills', label: '技能', visibleLabel: '技能' },
  { id: 'roles', label: '角色', visibleLabel: '角色' },
  { id: 'tools', label: '工具', visibleLabel: '工具' },
  { id: 'settings', label: '设置', visibleLabel: '设置' }
]

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
  activeSessionCategoryId,
  sessionsExpanded,
  onToggleSessionsExpanded,
  onSelectSessionCategory,
  onCreateSessionCategory,
  onRenameSessionCategory,
  onDeleteSessionCategory
}: ActivityRailProps) {
  const [fallbackSessionsExpanded, setFallbackSessionsExpanded] = useState(() => sessionsExpanded ?? true)
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState>()
  const [editingCategory, setEditingCategory] = useState<EditingCategoryState>()
  const renameInputRef = useRef<HTMLInputElement>(null)
  const categoryMenuFirstItemRef = useRef<HTMLButtonElement>(null)
  const isSessionsExpandedControlled = sessionsExpanded !== undefined && onToggleSessionsExpanded !== undefined
  const effectiveSessionsExpanded = isSessionsExpandedControlled ? sessionsExpanded : fallbackSessionsExpanded
  const visibleCategories =
    editingCategory?.isNew && !sessionCategories.some((category) => category.id === editingCategory.id)
      ? [...sessionCategories, { id: editingCategory.id, name: editingCategory.name }]
      : sessionCategories

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
    if (!editingCategory) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [editingCategory?.id])

  const handleToggleSessionsExpanded = () => {
    setCategoryMenu(undefined)
    if (isSessionsExpandedControlled) {
      onToggleSessionsExpanded()
      return
    }
    setFallbackSessionsExpanded((expanded) => !expanded)
  }

  const handleSelectAllSessions = () => {
    onSelectSection?.('sessions')
    onSelectSessionCategory?.(undefined)
  }

  const handleSelectCategory = (categoryId: string) => {
    onSelectSection?.('sessions')
    onSelectSessionCategory?.(categoryId)
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
    if (current?.isNew) {
      void onDeleteSessionCategory?.(current.id)
    }
  }

  const commitEditingCategory = () => {
    if (!editingCategory) return

    const current = editingCategory
    const nextName = current.name.trim()
    const existingName = sessionCategories.find((category) => category.id === current.id)?.name
    setEditingCategory(undefined)

    if (!nextName) {
      if (current.isNew) {
        void onDeleteSessionCategory?.(current.id)
      }
      return
    }

    if (!current.isNew && nextName === existingName) return
    void onRenameSessionCategory?.(current.id, nextName)
  }

  const handleCategoryMenuAction = async (action: CategoryMenuAction, menuState: CategoryMenuState) => {
    setCategoryMenu(undefined)

    switch (action) {
      case 'create': {
        const category = await onCreateSessionCategory?.()
        if (!category) return
        onSelectSection?.('sessions')
        onSelectSessionCategory?.(category.id)
        setEditingCategory({ id: category.id, name: category.name, isNew: true })
        return
      }
      case 'rename': {
        if (!menuState.categoryId) return
        startRenameCategory(menuState.categoryId)
        return
      }
      case 'delete': {
        if (!menuState.categoryId) return
        void onDeleteSessionCategory?.(menuState.categoryId)
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
        background: themeTokens.color.background,
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
            const isAllSessionsActive = activeSection === 'sessions' && !activeSessionCategoryId
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
                    <span>所有会话</span>
                  </button>
                </div>
                {effectiveSessionsExpanded ? (
                  <nav aria-label="会话分类导航" style={sessionCategoryListStyle}>
                    {visibleCategories.map((category) => {
                      const isEditing = editingCategory?.id === category.id
                      const isActive = activeSection === 'sessions' && activeSessionCategoryId === category.id
                      return (
                        <div key={category.id}>
                          {isEditing ? (
                            <div style={categoryEditingRowStyle}>
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
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={`hesper-nav-item${isActive ? ' is-active' : ''}`}
                              aria-current={isActive ? 'page' : undefined}
                              aria-label={category.name}
                              onClick={() => handleSelectCategory(category.id)}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                openCategoryMenu(category.id, event.clientX, event.clientY)
                              }}
                              style={categoryRowStyle}
                            >
                              {category.name}
                            </button>
                          )}
                        </div>
                      )
                    })}
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
            >
              {section.visibleLabel}
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

const sessionsGroupStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  minWidth: 0
}

const allSessionsPrimaryRowStyle: CSSProperties = {
  minHeight: 34,
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
  height: 34,
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
  border: 0,
  background: 'transparent',
  color: 'inherit',
  padding: 0,
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left'
}

const sessionCategoryListStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  minWidth: 0
}

const categoryRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  width: '100%',
  textAlign: 'left',
  paddingLeft: 40
}

const categoryEditingRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  paddingLeft: 40,
  paddingRight: 8
}

const categoryRenameInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: 0,
  outline: `1px solid ${themeTokens.color.accent}`,
  borderRadius: 6,
  background: themeTokens.color.softControl,
  color: themeTokens.color.text,
  font: 'inherit',
  fontWeight: 600,
  padding: '4px 6px'
}

const categoryMenuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  minWidth: 180,
  padding: '4px 0',
  borderRadius: themeTokens.radius.md,
  border: `1px solid ${themeTokens.color.border}`,
  background: themeTokens.color.surfaceMuted,
  boxShadow: `0 18px 50px ${themeTokens.color.shadow}`,
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
