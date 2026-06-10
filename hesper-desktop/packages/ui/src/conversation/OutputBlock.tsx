import { useEffect, useState } from 'react'
import type { MessageContentType } from '@hesper/shared'
import { darkTheme } from '../theme'
import { FullscreenOutput } from './FullscreenOutput'

export type OutputBlockProps = {
  content: string
  contentType: MessageContentType
}

export function OutputBlock({ content, contentType }: OutputBlockProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    if (!isFullscreen) {
      return undefined
    }

    const handleClosePanels = () => setIsFullscreen(false)
    window.addEventListener('hesper:close-panels', handleClosePanels)
    return () => window.removeEventListener('hesper:close-panels', handleClosePanels)
  }, [isFullscreen])

  return (
    <>
      <section
        className="hesper-output-block"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: 'relative',
          height: 240,
          overflow: 'hidden',
          borderRadius: darkTheme.radius.lg,
          border: `1px solid ${darkTheme.color.border}`,
          background: darkTheme.color.surface
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
            border: `1px solid ${darkTheme.color.border}`,
            background: darkTheme.color.surfaceMuted,
            color: darkTheme.color.text,
            cursor: 'pointer',
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 120ms ease'
          }}
        >
          ⤢
        </button>
        <div style={{ height: '100%', overflow: 'auto', padding: darkTheme.spacing.md }}>
          {contentType === 'html' ? (
            <iframe
              title="HTML 输出预览"
              sandbox=""
              srcDoc={content}
              style={{ width: '100%', height: '100%', minHeight: 200, border: 0, background: '#fff' }}
            />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{content}</div>
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
