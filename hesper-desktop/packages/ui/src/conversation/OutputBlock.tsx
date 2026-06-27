import { memo, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { MessageContentType } from '@hesper/shared'
import { themeTokens } from '../theme'
import { FullscreenOutput } from './FullscreenOutput'
import { createSandboxedHtmlDocument } from './html-document'
import { MarkdownOutput } from './MarkdownOutput'

export type OutputBlockProps = {
  content: string
  contentType: MessageContentType
  closeFullscreenSignal?: number
  onLocalFileClick?: ((path: string) => void) | undefined
}

export const OutputBlock = memo(function OutputBlock({ content, contentType, closeFullscreenSignal = 0, onLocalFileClick }: OutputBlockProps) {
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

    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('a, button')) {
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
          minWidth: 0,
          maxWidth: '100%',
          height: contentType === 'html' ? outputBlockHtmlHeight : 'auto',
          maxHeight: outputBlockMaxHeight,
          overflow: 'hidden',
          borderRadius: themeTokens.radius.md,
          border: 0,
          background: themeTokens.color.surfaceMuted,
          boxShadow: `0 6px 18px ${themeTokens.color.shadow}`
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
            top: themeTokens.spacing.sm,
            right: themeTokens.spacing.sm,
            zIndex: 1,
            width: 30,
            height: 28,
            borderRadius: themeTokens.radius.sm,
            border: 0,
            background: themeTokens.color.softControl,
            color: themeTokens.color.text,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            boxShadow: `0 4px 10px ${themeTokens.color.shadow}`
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
            minWidth: 0,
            height: contentType === 'html' ? '100%' : 'auto',
            maxHeight: contentType === 'html' ? '100%' : outputBlockMaxHeight,
            overflowX: 'hidden',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            overflowAnchor: 'none',
            willChange: 'scroll-position',
            padding: themeTokens.spacing.md
          }}
        >
          {contentType === 'html' ? (
            <iframe
              title="HTML 输出预览"
              sandbox=""
              srcDoc={sandboxedDocument}
              // User-supplied HTML/preview content keeps a neutral white canvas so external documents render predictably.
              style={{ width: '100%', height: '100%', minHeight: 200, border: 0, borderRadius: themeTokens.radius.md, background: '#fff' }}
            />
          ) : contentType === 'markdown' ? (
            <MarkdownOutput content={content} onLocalFileClick={onLocalFileClick} />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: themeTokens.typography.body }}>{content}</div>
          )}
        </div>
      </section>
      <FullscreenOutput
        open={isFullscreen}
        content={content}
        contentType={contentType}
        onClose={() => setIsFullscreen(false)}
        onLocalFileClick={onLocalFileClick}
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
