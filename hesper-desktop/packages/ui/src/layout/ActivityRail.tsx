import { darkTheme } from '../theme'

export type AppSection = 'sessions' | 'skills' | 'roles' | 'tools' | 'settings'

export type ActivityRailProps = {
  activeSection: AppSection
  onCreateSession?: () => void | Promise<void>
  onSelectSection?: (section: AppSection) => void
}

const sections: Array<{ id: AppSection; label: string; visibleLabel: string }> = [
  { id: 'sessions', label: '所有会话', visibleLabel: '会话' },
  { id: 'skills', label: '技能', visibleLabel: '技能' },
  { id: 'roles', label: '角色', visibleLabel: '角色' },
  { id: 'tools', label: '工具', visibleLabel: '工具' },
  { id: 'settings', label: '设置', visibleLabel: '设置' }
]

export function ActivityRail({ activeSection, onCreateSession, onSelectSection }: ActivityRailProps) {
  return (
    <aside
      aria-label="功能栏"
      style={{
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: `${darkTheme.spacing.sm} ${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
        background: darkTheme.color.background,
        display: 'flex',
        flexDirection: 'column',
        gap: darkTheme.spacing.md
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
    </aside>
  )
}
