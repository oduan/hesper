import { useState } from 'react'
import type { MessageContentType } from '@hesper/shared'
import { darkTheme } from '../theme'
import { FullscreenOutput } from './FullscreenOutput'

export type OutputBlockProps = {
  content: string
  contentType: MessageContentType
}

export function OutputBlock({ content, contentType }: OutputBlockProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  return (
    <>
      <section
        className="hesper-output-block"
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
          style={{
            position: 'absolute',
            top: darkTheme.spacing.sm,
            right: darkTheme.spacing.sm,
            zIndex: 1,
            borderRadius: darkTheme.radius.md,
            border: `1px solid ${darkTheme.color.border}`,
            background: darkTheme.color.surfaceMuted,
            color: darkTheme.color.text,
            cursor: 'pointer'
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
