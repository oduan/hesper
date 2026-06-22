import { useEffect, useMemo, type CSSProperties } from 'react'
import type { MessageContentType } from '@hesper/shared'
import { themeTokens } from '../theme'
import { createSandboxedHtmlDocument } from './html-document'
import { MarkdownOutput } from './MarkdownOutput'

export type FullscreenOutputProps = {
  open: boolean
  content: string
  contentType: MessageContentType
  onClose: () => void
  onLocalFileClick?: ((path: string) => void) | undefined
}

export function FullscreenOutput({ open, content, contentType, onClose, onLocalFileClick }: FullscreenOutputProps) {
  const sandboxedDocument = useMemo(
    () => (contentType === 'html' ? createSandboxedHtmlDocument(content) : undefined),
    [content, contentType]
  )

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
      aria-label="输出全屏查看"
      data-hesper-fullscreen-output="true"
      style={overlayStyle}
    >
      <div
        aria-label="最大化输出内容"
        style={contentShellStyle}
      >
        <div aria-label="最大化输出操作" style={actionsStyle}>
          <button type="button" aria-label="复制输出内容" onClick={() => { void navigator.clipboard?.writeText(content) }} style={iconButtonStyle}>
            <svg aria-hidden="true" viewBox="0 0 24 24" style={iconStyle}>
              <rect x="8" y="8" width="10" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" aria-label="关闭全屏输出" onClick={onClose} style={iconButtonStyle}>
            <svg aria-hidden="true" viewBox="0 0 24 24" style={iconStyle}>
              <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          aria-label="最大化输出滚动区"
          className="hesper-theme-scrollbar"
          data-hesper-fullscreen-output-scroll="true"
          style={scrollAreaStyle}
        >
          <div aria-label="最大化输出正文" style={contentBodyStyle}>
            {contentType === 'html' ? (
              <iframe
                title="HTML 输出"
                sandbox=""
                srcDoc={sandboxedDocument}
                // User-supplied HTML/preview content keeps a neutral white canvas so external documents render predictably.
                style={{ width: '100%', height: '100%', minHeight: 480, border: 0, background: '#fff' }}
              />
            ) : contentType === 'markdown' ? (
              <MarkdownOutput content={content} onLocalFileClick={onLocalFileClick} />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{content}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  top: 36,
  right: 0,
  bottom: 0,
  left: 0,
  background: themeTokens.color.surface,
  display: 'block',
  padding: 0,
  boxSizing: 'border-box',
  zIndex: 1000
}

const contentShellStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  background: 'transparent',
  borderStyle: 'none'
}

const actionsStyle: CSSProperties = {
  position: 'absolute',
  top: themeTokens.spacing.lg,
  right: themeTokens.spacing.lg,
  zIndex: 2,
  display: 'flex',
  gap: themeTokens.spacing.sm
}

const scrollAreaStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'auto',
  overscrollBehavior: 'contain',
  overflowAnchor: 'none',
  willChange: 'scroll-position',
  boxSizing: 'border-box',
  padding: `${themeTokens.spacing.xl} ${themeTokens.spacing.lg}`
}

const contentBodyStyle: CSSProperties = {
  maxWidth: 1120,
  minHeight: '100%',
  margin: '0 auto',
  background: 'transparent',
  borderStyle: 'none'
}

const iconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: 0,
  outline: 0,
  borderRadius: themeTokens.radius.md,
  background: 'transparent',
  color: themeTokens.color.text,
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer'
}

const iconStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: 'block'
}
