import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { OutputMode } from '@hesper/shared'
import { darkTheme } from '../theme'

export type ComposerProps = {
  workspacePath?: string
  modelId: string
  outputMode: OutputMode
  modelOptions?: string[]
  onSend: (content: string) => void
  onSelectWorkspace?: () => void
  onModelChange?: (modelId: string) => void
  onOutputModeChange?: (outputMode: OutputMode) => void
  sendSignal?: number
}

const defaultModelOptions = ['mock/hesper-fast', 'openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514']

export function Composer({
  workspacePath,
  modelId,
  outputMode,
  modelOptions = defaultModelOptions,
  onSend,
  onSelectWorkspace,
  onModelChange,
  onOutputModeChange,
  sendSignal = 0
}: ComposerProps) {
  const [value, setValue] = useState('')
  const canSend = useMemo(() => value.trim().length > 0, [value])

  const handleSend = useCallback(() => {
    const content = value.trim()
    if (!content) {
      return
    }

    onSend(content)
    setValue('')
  }, [onSend, value])

  useEffect(() => {
    if (sendSignal > 0) {
      handleSend()
    }
  }, [handleSend, sendSignal])

  return (
    <section
      aria-label="消息输入区"
      style={{
        display: 'grid',
        gap: darkTheme.spacing.sm,
        border: `1px solid ${darkTheme.color.border}`,
        borderRadius: darkTheme.radius.xl,
        background: darkTheme.color.surface,
        padding: darkTheme.spacing.md
      }}
    >
      <textarea
        aria-label="消息输入框"
        placeholder="输入消息，支持 @skills"
        rows={5}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSend()
          }
        }}
        style={{
          width: '100%',
          resize: 'none',
          minHeight: 120,
          maxHeight: 240,
          overflow: 'auto',
          borderRadius: darkTheme.radius.lg,
          border: `1px solid ${darkTheme.color.border}`,
          background: darkTheme.color.surfaceMuted,
          color: darkTheme.color.text,
          padding: darkTheme.spacing.md,
          font: 'inherit',
          lineHeight: 1.5
        }}
      />
      <div style={{ display: 'grid', gap: darkTheme.spacing.sm }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: darkTheme.spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            aria-label="选择工作目录"
            onClick={() => onSelectWorkspace?.()}
            style={controlButtonStyle}
          >
            工作目录：{workspacePath ?? '未设置'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: darkTheme.spacing.sm, flexWrap: 'wrap' }}>
            <label style={controlLabelStyle}>
              <span>模型：</span>
              <select aria-label="选择模型" value={modelId} onChange={(event) => onModelChange?.(event.target.value)} style={selectStyle}>
                {modelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label style={controlLabelStyle}>
              <span>输出：</span>
              <select
                aria-label="选择输出模式"
                value={outputMode}
                onChange={(event) => onOutputModeChange?.(event.target.value as OutputMode)}
                style={selectStyle}
              >
                <option value="markdown">markdown</option>
                <option value="html">html</option>
              </select>
            </label>
            <button
              type="button"
              aria-label="发送"
              disabled={!canSend}
              onClick={handleSend}
              style={{
                width: 40,
                height: 40,
                borderRadius: '999px',
                border: 0,
                background: canSend ? darkTheme.color.accent : darkTheme.color.border,
                color: darkTheme.color.text,
                cursor: canSend ? 'pointer' : 'not-allowed'
              }}
            >
              ↑
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: darkTheme.spacing.xs, flexWrap: 'wrap' }}>
          <span style={placeholderChipStyle}>Tools · 即将支持</span>
          <span style={placeholderChipStyle}>Skills · 即将支持</span>
          <span style={placeholderChipStyle}>Roles · 即将支持</span>
        </div>
      </div>
    </section>
  )
}

const controlButtonStyle = {
  borderRadius: darkTheme.radius.md,
  border: `1px solid ${darkTheme.color.border}`,
  background: darkTheme.color.surfaceMuted,
  color: darkTheme.color.textMuted,
  cursor: 'pointer',
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`,
  fontSize: 13
}

const controlLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: darkTheme.spacing.xs,
  color: darkTheme.color.textMuted,
  fontSize: 13
}

const selectStyle = {
  borderRadius: darkTheme.radius.md,
  border: `1px solid ${darkTheme.color.border}`,
  background: darkTheme.color.surfaceMuted,
  color: darkTheme.color.text,
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`
}

const placeholderChipStyle = {
  borderRadius: darkTheme.radius.xl,
  border: `1px dashed ${darkTheme.color.border}`,
  color: darkTheme.color.textMuted,
  padding: `2px ${darkTheme.spacing.sm}`,
  fontSize: 12
}
