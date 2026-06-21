import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { themeTokens } from '../theme'
import { ThemedSelect, type ThemedSelectOptionGroup } from './ThemedSelect'

export type ModelOptionGroup = ThemedSelectOptionGroup

export type ComposerProps = {
  workspacePath?: string
  modelId: string
  modelOptions?: string[]
  modelOptionGroups?: ModelOptionGroup[]
  value?: string
  running?: boolean
  onDraftChange?: (value: string) => void
  onSend: (content: string) => void
  onStop?: () => void
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
  value: controlledValue,
  running = false,
  onDraftChange,
  onSend,
  onStop,
  onSelectWorkspace,
  onModelChange,
  sendSignal = 0
}: ComposerProps) {
  const [internalValue, setInternalValue] = useState('')
  const value = controlledValue ?? internalValue
  const lastHandledSendSignalRef = useRef(0)
  const canSend = useMemo(() => value.trim().length > 0, [value])
  const setComposerValue = useCallback((nextValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(nextValue)
    }
    onDraftChange?.(nextValue)
  }, [controlledValue, onDraftChange])

  const handleSend = useCallback(() => {
    if (running) {
      onStop?.()
      return
    }

    const content = value.trim()
    if (!content) {
      return
    }

    onSend(content)
    setComposerValue('')
  }, [onSend, onStop, running, setComposerValue, value])

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
        gap: themeTokens.spacing.sm,
        border: 0,
        borderRadius: themeTokens.radius.xl,
        background: themeTokens.color.surfaceMuted,
        padding: themeTokens.spacing.md
      }}
    >
      <textarea
        className="hesper-theme-scrollbar"
        aria-label="消息输入框"
        placeholder="输入消息，支持 @skills"
        rows={4}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setComposerValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSend()
          }
        }}
        style={textareaStyle}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: themeTokens.spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="hesper-soft-control"
          aria-label="选择工作目录"
          onClick={() => onSelectWorkspace?.()}
          style={controlButtonStyle}
        >
          工作目录：{workspacePath ?? '未设置'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: themeTokens.spacing.xs, flexWrap: 'wrap' }}>
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
            aria-label={running ? '停止' : '发送'}
            disabled={!running && !canSend}
            onClick={handleSend}
            style={{
              ...sendButtonStyle,
              opacity: running || canSend ? 1 : 0.45,
              cursor: running || canSend ? 'pointer' : 'not-allowed'
            }}
          >
            {running ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" style={sendIconStyle}>
                <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" style={sendIconStyle}>
                <path d="M12 17V7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M6.5 12.5 12 7l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </section>
  )
}

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'block',
  resize: 'none',
  minHeight: 96,
  maxHeight: 210,
  overflow: 'auto',
  borderRadius: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: themeTokens.color.text,
  padding: '0 1px',
  fontFamily: 'inherit',
  fontSize: themeTokens.typography.body,
  fontWeight: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 1.5
} satisfies CSSProperties

const controlButtonStyle = {
  borderRadius: themeTokens.radius.md,
  border: 0,
  outline: 0,
  background: themeTokens.color.softControl,
  color: themeTokens.color.textMuted,
  cursor: 'pointer',
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
  fontSize: themeTokens.typography.body,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const modelControlStyle = {
  display: 'flex',
  alignItems: 'center',
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body
} satisfies CSSProperties

const sendButtonStyle = {
  width: 34,
  height: 34,
  borderRadius: '999px',
  border: 0,
  outline: 0,
  background: themeTokens.color.softControl,
  color: themeTokens.color.text,
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
