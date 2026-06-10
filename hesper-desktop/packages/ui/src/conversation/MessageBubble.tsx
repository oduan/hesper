import type { Message } from '@hesper/shared'
import { darkTheme } from '../theme'

export type MessageBubbleProps = {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start'
      }}
    >
      <article
        aria-label={isUser ? '用户消息' : '助手消息'}
        style={{
          maxWidth: '80%',
          padding: `${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
          borderRadius: darkTheme.radius.lg,
          border: `1px solid ${isUser ? darkTheme.color.accent : darkTheme.color.border}`,
          background: isUser ? 'rgba(155, 140, 255, 0.14)' : darkTheme.color.surface,
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5
        }}
      >
        {message.content}
      </article>
    </div>
  )
}
