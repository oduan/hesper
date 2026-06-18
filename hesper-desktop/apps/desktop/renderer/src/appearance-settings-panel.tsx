import type { CSSProperties } from 'react'
import { darkTheme } from '@hesper/ui'
import type { AppSettings, UpdateSettingsInput } from '../../electron/ipc-contract'

export type AppearanceSettingsPanelProps = {
  settings: Pick<AppSettings, 'themeMode' | 'fontSize'>
  error?: string
  onUpdate: (patch: UpdateSettingsInput) => void | Promise<AppSettings>
}

const themeModeOptions: Array<{ value: AppSettings['themeMode']; label: string; description: string }> = [
  { value: 'system', label: '跟随系统', description: '使用系统当前外观' },
  { value: 'light', label: '亮色', description: '浅色背景与深色文字' },
  { value: 'dark', label: '暗色', description: '深色背景与浅色文字' }
]

const fontSizeOptions = [12, 13, 14, 15, 16, 17, 18]

export function AppearanceSettingsPanel({ settings, error, onUpdate }: AppearanceSettingsPanelProps) {
  const update = (patch: UpdateSettingsInput) => {
    void onUpdate(patch)
  }

  return (
    <section aria-label="外观设置面板" style={panelStyle}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 'calc(var(--hesper-font-size, 14px) + 6px)', lineHeight: 1.2 }}>外观</h2>
        <p style={{ margin: 0, color: darkTheme.color.textMuted }}>调整 Hesper 的整体显示方式。设置会立即生效并自动保存。</p>
      </header>

      {error ? <p role="alert" style={errorStyle}>设置保存失败：{error}</p> : null}

      <div style={cardStyle}>
        <div style={fieldHeaderStyle}>
          <div>
            <h3 style={fieldTitleStyle}>色彩模式</h3>
            <p style={fieldDescriptionStyle}>选择亮色、暗色，或跟随系统。</p>
          </div>
          <span style={statusPillStyle}>{themeModeOptions.find((option) => option.value === settings.themeMode)?.label ?? '跟随系统'}</span>
        </div>
        <div role="group" aria-label="色彩模式" style={segmentedGridStyle}>
          {themeModeOptions.map((option) => {
            const isActive = settings.themeMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => update({ themeMode: option.value })}
                style={{
                  ...segmentedButtonStyle,
                  ...(isActive ? segmentedButtonActiveStyle : {})
                }}
              >
                <span style={{ fontWeight: 800 }}>{option.label}</span>
                <span style={{ color: darkTheme.color.textMuted }}>{option.description}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={fieldHeaderStyle}>
          <div>
            <h3 style={fieldTitleStyle}>全局字体大小</h3>
            <p style={fieldDescriptionStyle}>以当前 14px 为基准，调整整个界面的正文尺寸。</p>
          </div>
          <span style={statusPillStyle}>{settings.fontSize}px</span>
        </div>
        <label style={{ display: 'grid', gap: 10 }}>
          <span style={{ color: darkTheme.color.textMuted }}>字体大小</span>
          <input
            aria-label="全局字体大小"
            type="range"
            min={12}
            max={18}
            step={1}
            value={settings.fontSize}
            onChange={(event) => update({ fontSize: Number(event.target.value) })}
            style={rangeStyle}
          />
        </label>
        <div role="group" aria-label="字号快捷选择" style={fontSizeGridStyle}>
          {fontSizeOptions.map((fontSize) => {
            const isActive = settings.fontSize === fontSize
            return (
              <button
                key={fontSize}
                type="button"
                aria-pressed={isActive}
                onClick={() => update({ fontSize })}
                style={{
                  ...fontSizeButtonStyle,
                  ...(isActive ? segmentedButtonActiveStyle : {})
                }}
              >
                {fontSize}px
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const panelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: darkTheme.spacing.lg,
  paddingRight: 4,
  color: darkTheme.color.text,
  fontSize: darkTheme.typography.body
}

const cardStyle: CSSProperties = {
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: darkTheme.radius.lg,
  background: darkTheme.color.surfaceMuted,
  padding: darkTheme.spacing.lg,
  display: 'grid',
  gap: darkTheme.spacing.md
}

const fieldHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: darkTheme.spacing.md
}

const fieldTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: darkTheme.typography.body,
  lineHeight: 1.35
}

const fieldDescriptionStyle: CSSProperties = {
  margin: '4px 0 0',
  color: darkTheme.color.textMuted
}

const statusPillStyle: CSSProperties = {
  minWidth: 72,
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: 999,
  color: darkTheme.color.accent,
  background: darkTheme.color.surface,
  padding: '5px 10px',
  textAlign: 'center',
  fontWeight: 800
}

const segmentedGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: darkTheme.spacing.sm
}

const segmentedButtonStyle: CSSProperties = {
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: darkTheme.radius.md,
  background: darkTheme.color.surface,
  color: darkTheme.color.text,
  padding: '12px',
  cursor: 'pointer',
  display: 'grid',
  gap: 5,
  textAlign: 'left',
  fontSize: darkTheme.typography.body
}

const segmentedButtonActiveStyle: CSSProperties = {
  borderColor: darkTheme.color.accent,
  background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))'
}

const rangeStyle: CSSProperties = {
  width: '100%',
  accentColor: darkTheme.color.accent,
  cursor: 'pointer'
}

const fontSizeGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: darkTheme.spacing.sm
}

const fontSizeButtonStyle: CSSProperties = {
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: darkTheme.radius.md,
  background: darkTheme.color.surface,
  color: darkTheme.color.text,
  minHeight: 38,
  cursor: 'pointer',
  fontSize: darkTheme.typography.body,
  fontWeight: 700
}

const errorStyle: CSSProperties = {
  margin: 0,
  border: `1px solid ${darkTheme.color.danger}`,
  borderRadius: darkTheme.radius.md,
  background: 'rgba(255, 123, 123, 0.12)',
  color: darkTheme.color.danger,
  padding: darkTheme.spacing.md
}
