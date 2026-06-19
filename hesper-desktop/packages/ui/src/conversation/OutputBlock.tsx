import { memo, useEffect, useMemo, useState, type MouseEvent } from 'react'
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

export const OutputBlock = memo(function OutputBlock({ content, contentType, closeFullscreenSignal = 0 }: OutputBlockProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const sandboxedDocument = useMemo(
    () => (contentType === 'html' ? createSandboxedHtmlDocument(content) : undefined),
    [content, contentType]
  )

  useEffect(() => {
    if (closeFullscreenSignal > 0) {
      setIsFullscreen(false)
    }
  }, [closeFullscreenSignal])

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
        style={{
          contain: 'paint',
          position: 'relative',
          height: contentType === 'html' ? outputBlockHtmlHeight : 'auto',
          maxHeight: outputBlockMaxHeight,
          overflow: 'hidden',
          borderRadius: darkTheme.radius.lg,
          border: 0,
          background: darkTheme.color.surfaceMuted
        }}
      >
        <style>{outputBlockChromeCss}</style>
        <button
          type="button"
          aria-label="全屏查看输出"
          data-hesper-output-fullscreen-button="true"
          onClick={() => setIsFullscreen(true)}
          style={{
            position: 'absolute',
            top: darkTheme.spacing.sm,
            right: darkTheme.spacing.sm,
            zIndex: 1,
            borderRadius: darkTheme.radius.md,
            border: 0,
            background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))',
            color: darkTheme.color.text,
            cursor: 'pointer'
          }}
        >
          ⤢
        </button>
        <div
          aria-label="输出内容滚动区"
          className="hesper-theme-scrollbar"
          data-hesper-output-scroll="true"
          style={{
            boxSizing: 'border-box',
            height: contentType === 'html' ? '100%' : 'auto',
            maxHeight: contentType === 'html' ? '100%' : outputBlockMaxHeight,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            overflowAnchor: 'none',
            willChange: 'scroll-position',
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
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: darkTheme.typography.body }}>{content}</div>
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
})

const outputBlockHtmlHeight = 450
const outputBlockMaxHeight = 570

const outputBlockChromeCss = `
.hesper-output-block [data-hesper-output-fullscreen-button="true"] {
  opacity: 0;
  transition: opacity 120ms ease;
}
.hesper-output-block:hover [data-hesper-output-fullscreen-button="true"],
.hesper-output-block:focus-within [data-hesper-output-fullscreen-button="true"] {
  opacity: 1;
}
`
