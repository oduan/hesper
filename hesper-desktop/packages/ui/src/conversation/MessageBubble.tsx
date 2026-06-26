import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Message, MessageAttachment } from '@hesper/shared'
import { themeTokens } from '../theme'

export type MessageBubbleProps = {
  message: Message
  loadAttachmentDataUrl?: (attachment: MessageAttachment) => Promise<string>
}

export function MessageBubble({ message, loadAttachmentDataUrl }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const timestamp = isUser ? formatMessageTimestamp(message.createdAt) : undefined
  const shouldRenderContentBubble = message.content.trim().length > 0

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start'
      }}
    >
      <div style={messageStackStyle(isUser)}>
        <MessageAttachments
          message={message}
          isUser={isUser}
          {...(loadAttachmentDataUrl ? { loadAttachmentDataUrl } : {})}
        />
        {shouldRenderContentBubble ? (
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
        ) : null}
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

type MessageAttachmentsProps = {
  message: Message
  isUser: boolean
  loadAttachmentDataUrl?: (attachment: MessageAttachment) => Promise<string>
}

const emptyAttachments: MessageAttachment[] = []

type LoadedImageDataUrl = {
  cacheKey: string
  dataUrl: string
}

function MessageAttachments({ message, isUser, loadAttachmentDataUrl }: MessageAttachmentsProps) {
  const attachments = message.attachments ?? emptyAttachments
  const imageAttachments = useMemo(() => attachments.filter((attachment) => attachment.kind === 'image'), [attachments])
  const textAttachments = useMemo(() => attachments.filter((attachment) => attachment.kind === 'text'), [attachments])
  const imageAttachmentSignature = useMemo(() => imageAttachments.map(createImageAttachmentCacheKey).join('\u0001'), [imageAttachments])
  const hasAttachmentDataUrlLoader = Boolean(loadAttachmentDataUrl)
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, LoadedImageDataUrl>>({})
  const imageDataUrlsRef = useRef(imageDataUrls)
  const loadAttachmentDataUrlRef = useRef(loadAttachmentDataUrl)
  const pendingImageCacheKeysRef = useRef(new Set<string>())

  useEffect(() => {
    imageDataUrlsRef.current = imageDataUrls
  }, [imageDataUrls])

  useEffect(() => {
    loadAttachmentDataUrlRef.current = loadAttachmentDataUrl
  }, [loadAttachmentDataUrl])

  useEffect(() => {
    let cancelled = false
    const activeCacheKeys = new Map(imageAttachments.map((attachment) => [attachment.id, createImageAttachmentCacheKey(attachment)] as const))
    const activeCacheKeySet = new Set(activeCacheKeys.values())

    for (const pendingCacheKey of pendingImageCacheKeysRef.current) {
      if (!activeCacheKeySet.has(pendingCacheKey)) {
        pendingImageCacheKeysRef.current.delete(pendingCacheKey)
      }
    }

    setImageDataUrls((current) => {
      let changed = false
      const next: Record<string, LoadedImageDataUrl> = {}

      for (const [attachmentId, loadedImage] of Object.entries(current)) {
        if (activeCacheKeys.get(attachmentId) === loadedImage.cacheKey) {
          next[attachmentId] = loadedImage
        } else {
          changed = true
        }
      }

      return changed ? next : current
    })

    if (!hasAttachmentDataUrlLoader || imageAttachments.length === 0) {
      return () => {
        cancelled = true
      }
    }

    for (const attachment of imageAttachments) {
      const cacheKey = createImageAttachmentCacheKey(attachment)
      const loadedImage = imageDataUrlsRef.current[attachment.id]
      if (loadedImage?.cacheKey === cacheKey || pendingImageCacheKeysRef.current.has(cacheKey)) {
        continue
      }

      pendingImageCacheKeysRef.current.add(cacheKey)
      void Promise.resolve().then(() => {
        const loader = loadAttachmentDataUrlRef.current
        if (!loader) throw new Error('Attachment loader unavailable')
        return loader(attachment)
      }).then(
        (dataUrl) => {
          if (cancelled) return
          setImageDataUrls((current) => {
            if (activeCacheKeys.get(attachment.id) !== cacheKey) {
              return current
            }
            return { ...current, [attachment.id]: { cacheKey, dataUrl } }
          })
        },
        () => {
          // Keep historical message rendering resilient if an attachment file is missing.
        }
      ).finally(() => {
        pendingImageCacheKeysRef.current.delete(cacheKey)
      })
    }

    return () => {
      cancelled = true
    }
  }, [hasAttachmentDataUrlLoader, imageAttachmentSignature])

  if (attachments.length === 0) {
    return null
  }

  return (
    <div aria-label="消息附件" style={attachmentListStyle(isUser)}>
      {imageAttachments.map((attachment) => {
        const loadedImage = imageDataUrls[attachment.id]
        const dataUrl = loadedImage?.cacheKey === createImageAttachmentCacheKey(attachment) ? loadedImage.dataUrl : undefined
        return dataUrl ? (
          <img
            key={attachment.id}
            alt="图片附件"
            src={dataUrl}
            style={attachmentImageStyle}
          />
        ) : (
          <div key={attachment.id} aria-label="图片附件加载中" style={attachmentImagePlaceholderStyle} />
        )
      })}
      {textAttachments.map((attachment) => (
        <div key={attachment.id} style={fileChipStyle}>
          <span aria-hidden="true" style={fileChipIconStyle}>📄</span>
          <span style={fileChipTextStyle}>{attachment.name}</span>
          <span style={fileChipMetaStyle}>{formatAttachmentMeta(attachment)}</span>
        </div>
      ))}
    </div>
  )
}

function createImageAttachmentCacheKey(attachment: MessageAttachment): string {
  return [attachment.id, attachment.relativePath, attachment.mimeType].join('\u0000')
}

function formatAttachmentMeta(attachment: MessageAttachment): string {
  const parts = [attachment.mimeType, formatBytes(attachment.bytes)].filter(Boolean)
  return parts.join(' · ')
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

function attachmentListStyle(isUser: boolean): CSSProperties {
  return {
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: themeTokens.spacing.xs,
    justifyContent: isUser ? 'flex-end' : 'flex-start',
    alignItems: 'flex-end'
  }
}

const attachmentImageStyle = {
  display: 'block',
  maxWidth: 128,
  maxHeight: 96,
  width: 'auto',
  height: 'auto',
  objectFit: 'cover',
  borderRadius: themeTokens.radius.md,
  boxShadow: `0 4px 14px ${themeTokens.color.shadow}`
} satisfies CSSProperties

const attachmentImagePlaceholderStyle = {
  width: 96,
  height: 64,
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.softControl,
  opacity: 0.72
} satisfies CSSProperties

const fileChipStyle = {
  minWidth: 0,
  maxWidth: 180,
  display: 'inline-grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  columnGap: themeTokens.spacing.xs,
  rowGap: 2,
  alignItems: 'center',
  padding: `4px ${themeTokens.spacing.sm}`,
  borderRadius: 999,
  background: themeTokens.color.surfaceMuted,
  color: themeTokens.color.text,
  boxShadow: `0 4px 14px ${themeTokens.color.shadow}`
} satisfies CSSProperties

const fileChipIconStyle = {
  gridRow: '1 / span 2',
  fontSize: 12,
  lineHeight: 1
} satisfies CSSProperties

const fileChipTextStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  lineHeight: 1.15,
  fontWeight: 600
} satisfies CSSProperties

const fileChipMetaStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.tiny,
  lineHeight: 1.2
} satisfies CSSProperties

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
