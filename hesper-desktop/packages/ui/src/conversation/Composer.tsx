import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import type { OutputMode } from '@hesper/shared'
import { darkTheme } from '../theme'
import { ThemedSelect } from './ThemedSelect'

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
  outputMode: _outputMode,
  modelOptions = defaultModelOptions,
  onSend,
  onSelectWorkspace,
  onModelChange,
  onOutputModeChange: _onOutputModeChange,
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
        border: 0,
        borderRadius: darkTheme.radius.xl,
        background: darkTheme.color.surfaceMuted,
        padding: darkTheme.spacing.md
      }}
    >
      <textarea
        aria-label="消息输入框"
        placeholder="输入消息，支持 @skills"
        rows={4}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSend()
          }
        }}
        style={textareaStyle}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: darkTheme.spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="hesper-soft-control"
          aria-label="选择工作目录"
          onClick={() => onSelectWorkspace?.()}
          style={controlButtonStyle}
        >
          工作目录：{workspacePath ?? '未设置'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: darkTheme.spacing.sm, flexWrap: 'wrap' }}>
          <div style={controlLabelStyle}>
            <span>模型</span>
            <ThemedSelect
              ariaLabel="选择模型"
              value={modelId}
              options={modelOptions}
              {...(onModelChange ? { onChange: onModelChange } : {})}
              minWidth={150}
              maxWidth={220}
              menuPlacement="top"
            />
          </div>
          <button
            type="button"
            className="hesper-send-button"
            aria-label="发送"
            disabled={!canSend}
            onClick={handleSend}
            style={{
              ...sendButtonStyle,
              opacity: canSend ? 1 : 0.45,
              cursor: canSend ? 'pointer' : 'not-allowed'
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </section>
  )
}

const textareaStyle = {
  width: '100%',
  resize: 'none',
  minHeight: 96,
  maxHeight: 210,
  overflow: 'auto',
  borderRadius: darkTheme.radius.lg,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: 0,
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5
} satisfies CSSProperties

const controlButtonStyle = {
  borderRadius: darkTheme.radius.md,
  border: 0,
  outline: 0,
  background: 'rgba(255, 255, 255, 0.045)',
  color: darkTheme.color.textMuted,
  cursor: 'pointer',
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`,
  fontSize: 12,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const controlLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: darkTheme.spacing.xs,
  color: darkTheme.color.textMuted,
  fontSize: 12
} satisfies CSSProperties

const sendButtonStyle = {
  width: 34,
  height: 34,
  borderRadius: '999px',
  border: 0,
  outline: 0,
  background: 'rgba(127, 158, 232, 0.22)',
  color: darkTheme.color.text
} satisfies CSSProperties
