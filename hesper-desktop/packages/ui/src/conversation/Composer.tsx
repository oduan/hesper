import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { OutputMode } from '@hesper/shared'
import { darkTheme } from '../theme'

export type ComposerProps = {
  workspacePath?: string
  modelId: string
  outputMode: OutputMode
  onSend: (content: string) => void
}

export function Composer({ workspacePath, modelId, outputMode, onSend }: ComposerProps) {
  const [value, setValue] = useState('')
  const canSend = useMemo(() => value.trim().length > 0, [value])

  const handleSend = () => {
    const content = value.trim()
    if (!content) {
      return
    }

    onSend(content)
    setValue('')
  }

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
          resize: 'vertical',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: darkTheme.spacing.md, alignItems: 'center' }}>
        <div style={{ color: darkTheme.color.textMuted, fontSize: 13 }}>工作目录：{workspacePath ?? '未设置'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: darkTheme.spacing.sm }}>
          <span style={{ fontSize: 13, color: darkTheme.color.textMuted }}>模型：{modelId}</span>
          <span style={{ fontSize: 13, color: darkTheme.color.textMuted }}>输出：{outputMode}</span>
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
    </section>
  )
}
