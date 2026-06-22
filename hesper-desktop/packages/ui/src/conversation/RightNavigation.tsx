import { themeTokens } from '../theme'

export type NavigationItem = {
  id: string
  label: string
  kind: 'user' | 'assistant' | 'warning' | 'tool'
}

export type RightNavigationProps = {
  open: boolean
  items: NavigationItem[]
  onClose?: () => void
  onNavigate?: (id: string) => void
}

const kindLabels: Record<NavigationItem['kind'], string> = {
  user: '用户消息',
  assistant: '助手输出',
  warning: '警告',
  tool: '工具节点'
}

export function RightNavigation({ open, items, onClose, onNavigate }: RightNavigationProps) {
  if (!open) {
    return null
  }

  return (
    <aside
      aria-label="右侧导航"
      style={{
        width: 280,
        borderLeft: `1px solid ${themeTokens.color.border}`,
        background: themeTokens.color.surface,
        padding: themeTokens.spacing.md,
        display: 'grid',
        alignContent: 'start',
        gap: themeTokens.spacing.sm
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>会话导航</strong>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="关闭导航">
            关闭
          </button>
        ) : null}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: themeTokens.spacing.xs }}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onNavigate?.(item.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                borderRadius: themeTokens.radius.md,
                border: `1px solid ${themeTokens.color.border}`,
                background: themeTokens.color.surfaceMuted,
                color: themeTokens.color.text,
                padding: themeTokens.spacing.sm,
                cursor: 'pointer'
              }}
            >
              <div style={{ fontSize: themeTokens.typography.body, color: themeTokens.color.textMuted }}>{kindLabels[item.kind]}</div>
              <div>{item.label}</div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
