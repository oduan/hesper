import { useEffect, useMemo, useState } from 'react'
import type { MessageContentType } from '@hesper/shared'
import { darkTheme } from '../theme'
import { FullscreenOutput } from './FullscreenOutput'
import { createSandboxedHtmlDocument } from './html-document'
import { MarkdownOutput } from './MarkdownOutput'

export type OutputBlockProps = {
  content: string
  contentType: MessageContentType
  closeFullscreenSignal?: number
}

export function OutputBlock({ content, contentType, closeFullscreenSignal = 0 }: OutputBlockProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const sandboxedDocument = useMemo(
    () => (contentType === 'html' ? createSandboxedHtmlDocument(content) : undefined),
    [content, contentType]
  )

  useEffect(() => {
    if (closeFullscreenSignal > 0) {
      setIsFullscreen(false)
    }
  }, [closeFullscreenSignal])

  return (
    <>
      <section
        className="hesper-output-block"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: 'relative',
          height: contentType === 'html' ? 260 : 'auto',
          maxHeight: 340,
          overflow: 'hidden',
          borderRadius: darkTheme.radius.lg,
          border: 0,
          background: darkTheme.color.surfaceMuted
        }}
      >
        <button
          type="button"
          aria-label="全屏查看输出"
          onClick={() => setIsFullscreen(true)}
          onFocus={() => setIsHovered(true)}
          onBlur={() => setIsHovered(false)}
          style={{
            position: 'absolute',
            top: darkTheme.spacing.sm,
            right: darkTheme.spacing.sm,
            zIndex: 1,
            borderRadius: darkTheme.radius.md,
            border: 0,
            background: 'rgba(255, 255, 255, 0.055)',
            color: darkTheme.color.text,
            cursor: 'pointer',
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 120ms ease'
          }}
        >
          ⤢
        </button>
        <div className="hesper-theme-scrollbar" style={{ height: '100%', overflow: 'auto', padding: darkTheme.spacing.md }}>
          {contentType === 'html' ? (
            <iframe
              title="HTML 输出预览"
              sandbox=""
              srcDoc={sandboxedDocument}
              style={{ width: '100%', height: '100%', minHeight: 200, border: 0, borderRadius: darkTheme.radius.md, background: '#fff' }}
            />
          ) : contentType === 'markdown' ? (
            <MarkdownOutput content={content} />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 13 }}>{content}</div>
          )}
        </div>
      </section>
      <FullscreenOutput
        open={isFullscreen}
        content={content}
        contentType={contentType}
        onClose={() => setIsFullscreen(false)}
      />
    </>
  )
}
