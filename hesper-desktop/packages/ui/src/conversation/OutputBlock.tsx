import { useEffect, useMemo, useState, type MouseEvent, type WheelEvent } from 'react'
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

  const handleOutputWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || (event.deltaX === 0 && event.deltaY === 0)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.scrollTop += event.deltaY
    event.currentTarget.scrollLeft += event.deltaX
  }

  const handleOutputClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setIsFullscreen(true)
  }

  return (
    <>
      <section
        className="hesper-output-block"
        onClickCapture={handleOutputClickCapture}
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
        <div
          aria-label="输出内容滚动区"
          className="hesper-theme-scrollbar"
          data-hesper-output-scroll="true"
          onWheel={handleOutputWheel}
          style={{
            boxSizing: 'border-box',
            height: contentType === 'html' ? '100%' : 'auto',
            maxHeight: contentType === 'html' ? '100%' : 340,
            overflow: 'auto',
            padding: darkTheme.spacing.md
          }}
        >
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
