import type { ReactNode } from 'react'
import type { Session, ToolDefinition } from '@hesper/shared'
import { createThemeVariables, darkTheme, type ThemeMode } from '../theme'
import { ActivityRail, type AppSection } from './ActivityRail'
import { EntityListPane, type RoleListItem, type SettingsCategory, type SkillListItem } from './EntityListPane'
import { TitleBar, type DesktopPlatform, type WindowControlAction } from './TitleBar'

export type ToolListItem = ToolDefinition & { enabled: boolean }
export type { RoleListItem, SkillListItem } from './EntityListPane'

export type AppShellProps = {
  sessions: Session[]
  activeSection: AppSection
  title: string
  platform?: DesktopPlatform
  activeSessionId?: string
  runningSessionIds?: string[]
  tools?: ToolListItem[]
  activeToolId?: string
  pendingToolIds?: string[]
  roles?: RoleListItem[]
  activeRoleId?: string
  skills?: SkillListItem[]
  activeSkillId?: string
  roleSelectionDisabled?: boolean
  activeSettingsCategory?: SettingsCategory
  appearance?: { themeMode: ThemeMode; fontSize: number }
  onCreateSession?: () => void | Promise<void>
  onSelectSection?: (section: AppSection) => void
  onSelectSession?: (sessionId: string) => void
  onSelectTool?: (toolId: string) => void
  onToggleToolEnabled?: (toolId: string, enabled: boolean) => void
  onSelectRole?: (roleId: string) => void
  onSelectSkill?: (skillId: string) => void
  onSelectSettingsCategory?: (category: SettingsCategory) => void
  onRenameSession?: (sessionId: string, title: string) => void
  onRegenerateSessionTitle?: (sessionId: string, sessionIds?: string[]) => void
  onDeleteSession?: (sessionId: string, sessionIds?: string[]) => void
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
  onSelectSession,
  onSelectTool,
  onToggleToolEnabled,
  onSelectRole,
  onSelectSkill,
  onSelectSettingsCategory,
  onRenameSession,
  onRegenerateSessionTitle,
  onDeleteSession,
  onDeleteRole,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
  children
}: AppShellProps) {
  const themeVariables = createThemeVariables(appearance?.themeMode ?? 'dark', appearance?.fontSize ?? 14)

  return (
    <div
      style={{
        ...themeVariables,
        height: '100vh',
        minHeight: 0,
        overflow: 'hidden',
        background: darkTheme.color.background,
        color: darkTheme.color.text,
        display: 'grid',
        gridTemplateRows: '36px minmax(0, 1fr)',
        fontFamily: 'Inter, Segoe UI, sans-serif',
        fontSize: darkTheme.typography.body
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
          gap: darkTheme.spacing.sm,
          overflow: 'hidden',
          padding: `0 ${darkTheme.spacing.sm} ${darkTheme.spacing.sm} 0`
        }}
      >
        <ActivityRail
          activeSection={activeSection}
          {...(onCreateSession ? { onCreateSession } : {})}
          {...(onSelectSection ? { onSelectSection } : {})}
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
            borderRadius: darkTheme.radius.xl,
            background: darkTheme.color.surface
          }}
        >
          <div style={{ flex: 1, minHeight: 0, padding: darkTheme.spacing.lg, overflow: 'hidden' }}>{children}</div>
        </section>
      </div>
    </div>
  )
}
