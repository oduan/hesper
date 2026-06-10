import { useEffect } from 'react'
import type { MessageContentType } from '@hesper/shared'
import { darkTheme } from '../theme'

export type FullscreenOutputProps = {
  open: boolean
  content: string
  contentType: MessageContentType
  onClose: () => void
}

export function FullscreenOutput({ open, content, contentType, onClose }: FullscreenOutputProps) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="全屏输出"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: darkTheme.spacing.xl,
        zIndex: 1000
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          borderRadius: darkTheme.radius.lg,
          overflow: 'hidden',
          background: darkTheme.color.surface,
          border: `1px solid ${darkTheme.color.border}`
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: darkTheme.spacing.md,
            borderBottom: `1px solid ${darkTheme.color.border}`
          }}
        >
          <strong>输出</strong>
          <div style={{ display: 'flex', gap: darkTheme.spacing.sm }}>
            <button type="button" onClick={() => navigator.clipboard?.writeText(content)}>
              复制内容
            </button>
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div style={{ minHeight: 0, overflow: 'auto', padding: darkTheme.spacing.md }}>
          {contentType === 'html' ? (
            <iframe
              title="HTML 输出"
              sandbox=""
              srcDoc={content}
              style={{ width: '100%', height: '100%', minHeight: 480, border: 0, background: '#fff' }}
            />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{content}</div>
          )}
        </div>
      </div>
    </div>
  )
}
