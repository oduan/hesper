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
          maxWidth: '78%',
          padding: `${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
          borderRadius: darkTheme.radius.lg,
          border: 0,
          background: isUser ? 'rgba(255, 255, 255, 0.055)' : darkTheme.color.surfaceMuted,
          color: darkTheme.color.text,
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
          fontSize: 13
        }}
      >
        {message.content}
      </article>
    </div>
  )
}
