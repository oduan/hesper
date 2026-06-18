import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { darkTheme } from '../theme'
import { ThemedSelect, type ThemedSelectOptionGroup } from './ThemedSelect'

export type ModelOptionGroup = ThemedSelectOptionGroup

export type ComposerProps = {
  workspacePath?: string
  modelId: string
  modelOptions?: string[]
  modelOptionGroups?: ModelOptionGroup[]
  onSend: (content: string) => void
  onSelectWorkspace?: () => void
  onModelChange?: (modelId: string) => void
  sendSignal?: number
}

const defaultModelOptions = ['mock/hesper-fast', 'openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514']

export function Composer({
  workspacePath,
  modelId,
  modelOptions = defaultModelOptions,
  modelOptionGroups,
  onSend,
  onSelectWorkspace,
  onModelChange,
  sendSignal = 0
}: ComposerProps) {
  const [value, setValue] = useState('')
  const lastHandledSendSignalRef = useRef(0)
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
    if (sendSignal <= 0 || sendSignal === lastHandledSendSignalRef.current) {
      return
    }

    lastHandledSendSignalRef.current = sendSignal
    handleSend()
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
        className="hesper-theme-scrollbar"
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
        <div style={{ display: 'flex', alignItems: 'center', gap: darkTheme.spacing.xs, flexWrap: 'wrap' }}>
          <div style={modelControlStyle}>
            <ThemedSelect
              ariaLabel="选择模型"
              value={modelId}
              options={modelOptions}
              {...(modelOptionGroups ? { optionGroups: modelOptionGroups } : {})}
              {...(onModelChange ? { onChange: onModelChange } : {})}
              minWidth={0}
              maxWidth={240}
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
            <svg aria-hidden="true" viewBox="0 0 24 24" style={sendIconStyle}>
              <path d="M12 17V7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M6.5 12.5 12 7l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
  borderRadius: 0,
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

const modelControlStyle = {
  display: 'flex',
  alignItems: 'center',
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
  color: darkTheme.color.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1
} satisfies CSSProperties

const sendIconStyle = {
  width: 23,
  height: 23,
  display: 'block'
} satisfies CSSProperties
