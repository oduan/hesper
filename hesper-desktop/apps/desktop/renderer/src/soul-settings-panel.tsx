import type { CSSProperties } from 'react'
import { darkTheme } from '@hesper/ui'
import type { AppSettings, UpdateSettingsInput } from '../../electron/ipc-contract'

export type SoulSettingsPanelProps = {
  settings: Pick<AppSettings, 'soul'>
  error?: string
  onUpdate: (patch: UpdateSettingsInput) => void | Promise<AppSettings>
}

export function SoulSettingsPanel({ settings, error, onUpdate }: SoulSettingsPanelProps) {
  const update = (patch: UpdateSettingsInput) => {
    void onUpdate(patch)
  }

  return (
    <section aria-label="SOUL 设置面板" style={panelStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>SOUL</h2>
        <p style={descriptionStyle}>设置主 Agent 的身份、口吻和行为偏好。</p>
      </header>

      {error ? <p role="alert" style={errorStyle}>设置保存失败：{error}</p> : null}

      <div style={cardStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>身份设定</span>
          <textarea
            aria-label="身份设定"
            value={settings.soul}
            onChange={(event) => update({ soul: event.target.value })}
            placeholder="写下主 Agent 的身份、口吻、原则或长期行为偏好。"
            rows={8}
            style={textareaStyle}
          />
        </label>
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

const headerStyle: CSSProperties = {
  display: 'grid',
  gap: 6
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'calc(var(--hesper-font-size, 14px) + 6px)',
  lineHeight: 1.2
}

const descriptionStyle: CSSProperties = {
  margin: 0,
  color: darkTheme.color.textMuted,
  lineHeight: 1.6
}

const cardStyle: CSSProperties = {
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: darkTheme.radius.lg,
  background: darkTheme.color.surfaceMuted,
  padding: darkTheme.spacing.lg,
  display: 'grid',
  gap: darkTheme.spacing.md
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 8
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontWeight: 700
}

const textareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--hesper-color-border, #414868)',
  borderRadius: 10,
  background: 'var(--hesper-color-surface-muted, #24283b)',
  color: 'var(--hesper-color-text, #c0caf5)',
  padding: '10px 12px',
  outline: 'none',
  minHeight: 160,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5
}

const errorStyle: CSSProperties = {
  margin: 0,
  border: `1px solid ${darkTheme.color.danger}`,
  borderRadius: darkTheme.radius.md,
  background: 'rgba(255, 123, 123, 0.12)',
  color: darkTheme.color.danger,
  padding: darkTheme.spacing.md
}
