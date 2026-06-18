import { useEffect, useMemo, useRef, type CSSProperties, type WheelEvent } from 'react'
import type { MessageContentType } from '@hesper/shared'
import { darkTheme } from '../theme'
import { createSandboxedHtmlDocument } from './html-document'
import { MarkdownOutput } from './MarkdownOutput'

export type FullscreenOutputProps = {
  open: boolean
  content: string
  contentType: MessageContentType
  onClose: () => void
}

export function FullscreenOutput({ open, content, contentType, onClose }: FullscreenOutputProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
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

  const handleWheelCapture = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaX === 0 && event.deltaY === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    if (scrollRef.current) {
      scrollRef.current.scrollTop += event.deltaY
      scrollRef.current.scrollLeft += event.deltaX
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="输出全屏查看"
      data-hesper-fullscreen-output="true"
      onWheelCapture={handleWheelCapture}
      style={overlayStyle}
    >
      <div
        aria-label="最大化输出内容"
        style={contentShellStyle}
      >
        <div style={toolbarStyle}>
          <strong>输出</strong>
          <div style={{ display: 'flex', gap: darkTheme.spacing.sm }}>
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
        </div>
        <div
          ref={scrollRef}
          aria-label="最大化输出滚动区"
          className="hesper-theme-scrollbar"
          data-hesper-fullscreen-output-scroll="true"
          style={{ minHeight: 0, overflow: 'auto', padding: darkTheme.spacing.lg }}
        >
          {contentType === 'html' ? (
            <iframe
              title="HTML 输出"
              sandbox=""
              srcDoc={sandboxedDocument}
              style={{ width: '100%', height: '100%', minHeight: 480, border: 0, background: '#fff' }}
            />
          ) : contentType === 'markdown' ? (
            <MarkdownOutput content={content} />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{content}</div>
          )}
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
  background: 'rgba(0, 0, 0, 0.58)',
  display: 'grid',
  placeItems: 'stretch center',
  padding: 0,
  boxSizing: 'border-box',
  zIndex: 1000
}

const contentShellStyle: CSSProperties = {
  width: '100%',
  maxWidth: 1120,
  height: '100%',
  minHeight: 0,
  margin: '0 auto',
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  borderRadius: darkTheme.radius.xl,
  overflow: 'hidden',
  background: darkTheme.color.surface,
  border: `1px solid ${darkTheme.color.border}`,
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.38)'
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `${darkTheme.spacing.md} ${darkTheme.spacing.lg}`,
  borderBottom: `1px solid ${darkTheme.color.border}`
}

const iconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: 0,
  outline: 0,
  borderRadius: darkTheme.radius.md,
  background: 'rgba(255, 255, 255, 0.055)',
  color: darkTheme.color.text,
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer'
}

const iconStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: 'block'
}
