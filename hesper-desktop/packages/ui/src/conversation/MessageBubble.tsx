import type { CSSProperties } from 'react'
import type { Message } from '@hesper/shared'
import { themeTokens } from '../theme'

export type MessageBubbleProps = {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const timestamp = isUser ? formatMessageTimestamp(message.createdAt) : undefined

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start'
      }}
    >
      <div style={messageStackStyle(isUser)}>
        <article
          aria-label={isUser ? '用户消息' : '助手消息'}
          style={{
            maxWidth: '100%',
            padding: `${themeTokens.spacing.sm} ${themeTokens.spacing.md}`,
            borderRadius: themeTokens.radius.lg,
            border: 0,
            background: isUser ? themeTokens.color.softControl : themeTokens.color.surfaceMuted,
            color: themeTokens.color.text,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            lineHeight: 1.5,
            fontSize: themeTokens.typography.body
          }}
        >
          {message.content}
        </article>
        {timestamp ? (
          <time
            dateTime={message.createdAt}
            aria-label={`发送时间：${timestamp}`}
            style={timestampStyle}
          >
            {timestamp}
          </time>
        ) : null}
      </div>
    </div>
  )
}

function formatMessageTimestamp(value: string): string | undefined {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hours}:${minutes}`
}

function messageStackStyle(isUser: boolean): CSSProperties {
  return {
    maxWidth: '78%',
    display: 'grid',
    justifyItems: isUser ? 'end' : 'start',
    gap: 3
  }
}

const timestampStyle = {
  justifySelf: 'end',
  alignSelf: 'end',
  fontSize: themeTokens.typography.tiny,
  lineHeight: 1,
  color: themeTokens.color.textMuted,
  opacity: 0.72,
  whiteSpace: 'nowrap',
  userSelect: 'none'
} satisfies CSSProperties
