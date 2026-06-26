import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import type { Session, ToolDefinition } from '@hesper/shared'
import { createThemeVariables, themeTokens, type ThemeMode } from '../theme'
import { ActivityRail, type AppSection } from './ActivityRail'
import { EntityListPane, type RoleListItem, type SettingsCategory, type SkillListItem } from './EntityListPane'
import { TitleBar, type DesktopPlatform, type WindowControlAction } from './TitleBar'

export type ToolListItem = ToolDefinition & { enabled: boolean }
export type { RoleListItem, SkillListItem } from './EntityListPane'

export type SessionCategoryListItem = {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
}

export type AppShellProps = {
  sessions: Session[]
  activeSection: AppSection
  title: string
  platform?: DesktopPlatform
  activeSessionId?: string
  runningSessionIds?: string[]
  sessionCategories?: SessionCategoryListItem[]
  activeSessionCategoryId?: string
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
  onSelectTool?: (toolId: string) => void
  onToggleToolEnabled?: (toolId: string, enabled: boolean) => void
  onSelectRole?: (roleId: string) => void
  onSelectSkill?: (skillId: string) => void
  onSelectSettingsCategory?: (category: SettingsCategory) => void
  onRenameSession?: (sessionId: string, title: string) => void
  onRegenerateSessionTitle?: (sessionId: string, sessionIds?: string[]) => void
  onDeleteSession?: (sessionId: string, sessionIds?: string[]) => void
  onCreateSessionCategory?: () => Promise<SessionCategoryListItem>
  onRenameSessionCategory?: (categoryId: string, name: string) => void | Promise<void>
  onDeleteSessionCategory?: (categoryId: string) => void | Promise<void>
  onDeleteRole?: (roleId: string, roleIds?: string[]) => void
  onWindowMinimize?: WindowControlAction
  onWindowToggleMaximize?: WindowControlAction
  onWindowClose?: WindowControlAction
  children?: ReactNode
}

export function AppShell({
  sessions,
  activeSection,
  title,
  platform,
  activeSessionId,
  runningSessionIds,
  sessionCategories,
  activeSessionCategoryId,
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
  onSelectTool,
  onToggleToolEnabled,
  onSelectRole,
  onSelectSkill,
  onSelectSettingsCategory,
  onRenameSession,
  onRegenerateSessionTitle,
  onDeleteSession,
  onCreateSessionCategory,
  onRenameSessionCategory,
  onDeleteSessionCategory,
  onDeleteRole,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
  children
}: AppShellProps) {
  const themeId = appearance?.themeId ?? 'catppuccin'
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
        background: themeTokens.color.background,
        color: themeTokens.color.text,
        display: 'grid',
        gridTemplateRows: '36px minmax(0, 1fr)',
        fontFamily: 'Inter, Segoe UI, sans-serif',
        fontSize: themeTokens.typography.body
      }}
    >
      <TitleBar
        title={title}
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
          padding: `0 ${themeTokens.spacing.sm} ${themeTokens.spacing.sm} 0`
        }}
      >
        <ActivityRail
          activeSection={activeSection}
          {...(onCreateSession ? { onCreateSession } : {})}
          {...(onSelectSection ? { onSelectSection } : {})}
          {...(sessionCategories ? { sessionCategories } : {})}
          {...(activeSessionCategoryId ? { activeSessionCategoryId } : {})}
          {...(sessionsExpanded !== undefined ? { sessionsExpanded } : {})}
          {...(onToggleSessionsExpanded ? { onToggleSessionsExpanded } : {})}
          {...(onSelectSessionCategory ? { onSelectSessionCategory } : {})}
          {...(onCreateSessionCategory ? { onCreateSessionCategory } : {})}
          {...(onRenameSessionCategory ? { onRenameSessionCategory } : {})}
          {...(onDeleteSessionCategory ? { onDeleteSessionCategory } : {})}
        />
        <EntityListPane
          activeSection={activeSection}
          sessions={sessions}
          {...(activeSessionId ? { activeSessionId } : {})}
          {...(runningSessionIds ? { runningSessionIds } : {})}
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
          {...(onDeleteSession ? { onDeleteSession } : {})}
          {...(onDeleteRole ? { onDeleteRole } : {})}
        />
        <section
          aria-label="详情区域"
          style={{
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: themeTokens.radius.xl,
            background: themeTokens.color.surface
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: activeSection === 'sessions' ? 0 : themeTokens.spacing.lg }}>{children}</div>
        </section>
      </div>
    </div>
  )
}
