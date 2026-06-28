import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import type { Session, ToolDefinition } from '@hesper/shared'
import { createThemeVariables, themeTokens, type ThemeMode } from '../theme'
import { ActivityRail, type ActivityRailSessionScopeCounts, type AppSection } from './ActivityRail'
import { EntityListPane, type RoleListItem, type SessionCategoryListItem, type SettingsCategory, type SkillListItem } from './EntityListPane'
import { TitleBar, type DesktopPlatform, type WindowControlAction } from './TitleBar'

const shellBackgroundForColorScheme = (colorScheme: ThemeMode) => {
  const isDark = colorScheme === 'dark'
  return [
    `radial-gradient(circle at 18% 12%, rgba(255, 255, 255, ${isDark ? '0.05' : '0.18'}), transparent 30%)`,
    `radial-gradient(circle at 82% 4%, rgba(0, 0, 0, ${isDark ? '0.14' : '0.035'}), transparent 34%)`,
    `linear-gradient(180deg, rgba(255, 255, 255, ${isDark ? '0.025' : '0.08'}) 0%, rgba(255, 255, 255, 0) 54%, rgba(0, 0, 0, ${isDark ? '0.16' : '0.04'}) 100%)`,
    themeTokens.color.background
  ].join(', ')
}

const paneSurfaceShadow = `0 2px 6px -4px ${themeTokens.color.shadow}`

export type ToolListItem = ToolDefinition & { enabled: boolean }
export type { RoleListItem, SessionCategoryListItem, SkillListItem } from './EntityListPane'

export type AppShellProps = {
  sessions: Session[]
  sessionScopeSourceSessions?: Session[]
  activeSection: AppSection
  title: string
  brandName?: string
  platform?: DesktopPlatform
  activeSessionId?: string
  entityListTitle?: string
  runningSessionIds?: string[]
  sessionCategories?: SessionCategoryListItem[]
  activeSessionCategoryId?: string
  activeSessionSpecialView?: 'marked' | 'archived'
  sessionsExpanded?: boolean
  tools?: ToolListItem[]
  activeToolId?: string
  pendingToolIds?: string[]
  roles?: RoleListItem[]
  activeRoleId?: string
  skills?: SkillListItem[]
  activeSkillId?: string
  roleSelectionDisabled?: boolean
  activeSettingsCategory?: SettingsCategory
  appearance?: { themeId?: string; themeMode: ThemeMode; fontSize: number }
  onCreateSession?: () => void | Promise<void>
  onSelectSection?: (section: AppSection) => void
  onToggleSessionsExpanded?: () => void
  onSelectSession?: (sessionId: string) => void
  onSelectSessionCategory?: (categoryId?: string) => void
  onSelectSessionSpecialView?: (view: 'marked' | 'archived') => void
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
  onCreateSessionCategory?: () => Promise<SessionCategoryListItem | undefined>
  onRenameSessionCategory?: (categoryId: string, name: string) => void | Promise<void>
  onDeleteSessionCategory?: (categoryId: string) => void | Promise<void>
  onDiscardSessionCategory?: (categoryId: string) => void | Promise<void>
  onDeleteRole?: (roleId: string, roleIds?: string[]) => void
  onWindowMinimize?: WindowControlAction
  onWindowToggleMaximize?: WindowControlAction
  onWindowClose?: WindowControlAction
  children?: ReactNode
}

export function AppShell({
  sessions,
  sessionScopeSourceSessions,
  activeSection,
  title,
  brandName,
  platform,
  activeSessionId,
  entityListTitle,
  runningSessionIds,
  sessionCategories,
  activeSessionCategoryId,
  activeSessionSpecialView,
  sessionsExpanded,
  tools,
  activeToolId,
  pendingToolIds,
  roles,
  activeRoleId,
  skills,
  activeSkillId,
  roleSelectionDisabled,
  activeSettingsCategory,
  appearance,
  onCreateSession,
  onSelectSection,
  onToggleSessionsExpanded,
  onSelectSession,
  onSelectSessionCategory,
  onSelectSessionSpecialView,
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
  onCreateSessionCategory,
  onRenameSessionCategory,
  onDeleteSessionCategory,
  onDiscardSessionCategory,
  onDeleteRole,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
  children
}: AppShellProps) {
  const themeId = appearance?.themeId ?? 'hesper'
  const themeMode = appearance?.themeMode ?? 'dark'
  const fontSize = appearance?.fontSize ?? 14
  const themeVariables = useMemo(
    () => createThemeVariables({
      themeId,
      mode: themeMode,
      fontSize
    }),
    [fontSize, themeId, themeMode]
  )

  const colorScheme = themeVariables.colorScheme === 'dark' ? 'dark' : 'light'
  const shellBackground = useMemo(() => shellBackgroundForColorScheme(colorScheme), [colorScheme])
  const sessionScopeCountSessions = sessionScopeSourceSessions ?? sessions
  const sessionScopeCounts = useMemo<ActivityRailSessionScopeCounts>(() => {
    const byCategoryId: Record<string, number> = {}
    let all = 0
    let marked = 0
    let archived = 0

    for (const session of sessionScopeCountSessions) {
      if (session.status === 'archived') {
        archived += 1
        continue
      }

      if (session.status !== 'active') {
        continue
      }

      all += 1
      if (session.isMarked) {
        marked += 1
      }
      if (session.categoryId) {
        byCategoryId[session.categoryId] = (byCategoryId[session.categoryId] ?? 0) + 1
      }
    }

    return { all, marked, archived, byCategoryId }
  }, [sessionScopeCountSessions])

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    const previousVariables = new Map<string, string>()
    const previousColorScheme = root.style.colorScheme

    for (const [name, value] of Object.entries(themeVariables)) {
      if (name === 'colorScheme') {
        root.style.colorScheme = String(value)
        continue
      }

      if (!name.startsWith('--')) {
        continue
      }

      previousVariables.set(name, root.style.getPropertyValue(name))
      root.style.setProperty(name, String(value))
    }

    return () => {
      root.style.colorScheme = previousColorScheme
      for (const [name, value] of previousVariables) {
        if (value) {
          root.style.setProperty(name, value)
        } else {
          root.style.removeProperty(name)
        }
      }
    }
  }, [themeVariables])

  return (
    <div
      style={{
        ...themeVariables,
        height: '100vh',
        minHeight: 0,
        overflow: 'hidden',
        background: shellBackground,
        color: themeTokens.color.text,
        display: 'grid',
        gridTemplateRows: '36px minmax(0, 1fr)',
        fontFamily: 'var(--hesper-font-family-sans, Inter, MiSans, "Segoe UI", sans-serif)',
        fontSize: themeTokens.typography.body
      }}
    >
      <TitleBar
        title={title}
        {...(brandName ? { brandName } : {})}
        {...(platform ? { platform } : {})}
        {...(onWindowMinimize ? { onMinimize: onWindowMinimize } : {})}
        {...(onWindowToggleMaximize ? { onToggleMaximize: onWindowToggleMaximize } : {})}
        {...(onWindowClose ? { onClose: onWindowClose } : {})}
      />
      <div
        aria-label="主工作区"
        style={{
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '204px 427px minmax(0, 1fr)',
          gap: themeTokens.spacing.sm,
          overflow: 'hidden',
          alignItems: 'stretch',
          padding: `0 ${themeTokens.spacing.sm} ${themeTokens.spacing.sm} 0`
        }}
      >
        <ActivityRail
          activeSection={activeSection}
          {...(onCreateSession ? { onCreateSession } : {})}
          {...(onSelectSection ? { onSelectSection } : {})}
          {...(sessionCategories ? { sessionCategories } : {})}
          sessionScopeCounts={sessionScopeCounts}
          {...(activeSessionCategoryId ? { activeSessionCategoryId } : {})}
          {...(activeSessionSpecialView ? { activeSessionSpecialView } : {})}
          {...(sessionsExpanded !== undefined ? { sessionsExpanded } : {})}
          {...(onToggleSessionsExpanded ? { onToggleSessionsExpanded } : {})}
          {...(onSelectSessionCategory ? { onSelectSessionCategory } : {})}
          {...(onSelectSessionSpecialView ? { onSelectSessionSpecialView } : {})}
          {...(onCreateSessionCategory ? { onCreateSessionCategory } : {})}
          {...(onRenameSessionCategory ? { onRenameSessionCategory } : {})}
          {...(onDeleteSessionCategory ? { onDeleteSessionCategory } : {})}
          {...(onDiscardSessionCategory ? { onDiscardSessionCategory } : {})}
        />
        <EntityListPane
          activeSection={activeSection}
          sessions={sessions}
          {...(activeSection === 'sessions' && entityListTitle ? { title: entityListTitle } : {})}
          {...(activeSessionId ? { activeSessionId } : {})}
          {...(runningSessionIds ? { runningSessionIds } : {})}
          {...(sessionCategories ? { sessionCategories } : {})}
          {...(tools ? { tools } : {})}
          {...(activeToolId ? { activeToolId } : {})}
          {...(pendingToolIds ? { pendingToolIds } : {})}
          {...(roles ? { roles } : {})}
          {...(activeRoleId ? { activeRoleId } : {})}
          {...(skills ? { skills } : {})}
          {...(activeSkillId ? { activeSkillId } : {})}
          {...(roleSelectionDisabled ? { roleSelectionDisabled } : {})}
          {...(activeSettingsCategory ? { activeSettingsCategory } : {})}
          {...(onSelectSession ? { onSelectSession } : {})}
          {...(onSelectTool ? { onSelectTool } : {})}
          {...(onToggleToolEnabled ? { onToggleToolEnabled } : {})}
          {...(onSelectRole ? { onSelectRole } : {})}
          {...(onSelectSkill ? { onSelectSkill } : {})}
          {...(onSelectSettingsCategory ? { onSelectSettingsCategory } : {})}
          {...(onRenameSession ? { onRenameSession } : {})}
          {...(onRegenerateSessionTitle ? { onRegenerateSessionTitle } : {})}
          {...(onArchiveSession ? { onArchiveSession } : {})}
          {...(onRestoreSession ? { onRestoreSession } : {})}
          {...(onDeleteSession ? { onDeleteSession } : {})}
          {...(onSetSessionCategory ? { onSetSessionCategory } : {})}
          {...(onSetSessionMarked ? { onSetSessionMarked } : {})}
          {...(onDeleteRole ? { onDeleteRole } : {})}
        />
        <section
          aria-label="详情区域"
          style={{
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            maxHeight: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderColor: themeTokens.color.border,
            borderStyle: 'solid',
            borderWidth: '1px',
            borderRadius: themeTokens.radius.xl,
            background: themeTokens.color.surface,
            boxShadow: paneSurfaceShadow
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: activeSection === 'sessions' ? 0 : themeTokens.spacing.lg }}>{children}</div>
        </section>
      </div>
    </div>
  )
}
