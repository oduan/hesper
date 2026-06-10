import { darkTheme } from '../theme'

export type AppSection = 'sessions' | 'skills' | 'roles' | 'tools' | 'settings'

export type ActivityRailProps = {
  activeSection: AppSection
  onCreateSession?: () => void | Promise<void>
  onSelectSection?: (section: AppSection) => void
}

const sections: Array<{ id: AppSection; label: string; shortLabel: string; icon: string }> = [
  { id: 'sessions', label: '所有会话', shortLabel: '会话', icon: '会' },
  { id: 'skills', label: '技能', shortLabel: '技能', icon: '技' },
  { id: 'roles', label: '角色', shortLabel: '角色', icon: '角' },
  { id: 'tools', label: '工具', shortLabel: '工具', icon: '工' },
  { id: 'settings', label: '设置', shortLabel: '设置', icon: '设' }
]

export function ActivityRail({ activeSection, onCreateSession, onSelectSection }: ActivityRailProps) {
  return (
    <aside
      aria-label="功能栏"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: darkTheme.spacing.md,
        background: darkTheme.color.surfaceMuted,
        borderRight: `1px solid ${darkTheme.color.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: darkTheme.spacing.sm
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.04em' }}>hesper</div>
      <button
        type="button"
        aria-label="新建会话"
        onClick={() => {
          void onCreateSession?.()
        }}
        style={{
          border: 0,
          borderRadius: darkTheme.radius.md,
          background: darkTheme.color.accent,
          color: darkTheme.color.text,
          padding: `${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
          textAlign: 'left',
          fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        + 新建
      </button>
      <nav aria-label="主导航" style={{ display: 'grid', gap: darkTheme.spacing.xs }}>
        {sections.map((section) => {
          const isActive = section.id === activeSection
          return (
            <button
              key={section.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-label={section.label}
              onClick={() => onSelectSection?.(section.id)}
              style={{
                borderRadius: darkTheme.radius.md,
                border: `1px solid ${isActive ? darkTheme.color.accent : darkTheme.color.border}`,
                background: isActive ? 'rgba(155, 140, 255, 0.12)' : darkTheme.color.surface,
                color: darkTheme.color.text,
                padding: darkTheme.spacing.sm,
                display: 'grid',
                gap: 4,
                textAlign: 'left',
                cursor: 'pointer'
              }}
            >
              <span style={{ fontSize: 12, color: darkTheme.color.textMuted }}>{section.icon}</span>
              <span style={{ fontSize: 12 }}>{section.shortLabel}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
