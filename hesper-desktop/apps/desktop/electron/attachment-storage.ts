import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MessageAttachment } from '@hesper/shared'

export type ImageDraftAttachment = {
  kind: 'image'
  name: string
  mimeType: string
  bytes: number
  dataUrl: string
}

export type TextDraftAttachment = {
  kind: 'text'
  name: string
  mimeType: string
  bytes: number
  content: string
}

export type DraftAttachment = ImageDraftAttachment | TextDraftAttachment

export type SaveDraftAttachmentsInput = {
  sessionId: string
  messageId: string
  draftAttachments: DraftAttachment[]
}

export type AttachmentReadDataUrlInput = {
  relativePath: string
  mimeType: string
}

export type AttachmentDataUrlResult = {
  dataUrl: string
}

export type AttachmentStorage = {
  saveDraftAttachments(input: SaveDraftAttachmentsInput): Promise<MessageAttachment[]>
  readAttachmentDataUrl(input: AttachmentReadDataUrlInput): Promise<AttachmentDataUrlResult>
  readTextAttachment(relativePath: string): Promise<string>
  readImageAttachment(relativePath: string): Promise<Buffer>
  deleteMessageAttachments(input: { sessionId: string; messageId: string }): Promise<void>
  deleteSessionAttachments(input: { sessionId: string }): Promise<void>
}

function assertSafePathSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid attachment ${label}`)
  }
  return value
}

function sanitizeFileName(name: string): string {
  const baseName = name.split(/[\\/]/).pop()?.trim() ?? ''
  const sanitized = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  return sanitized || 'attachment'
}

function toPosixRelativePath(...segments: string[]): string {
  return segments.join('/')
}

function assertImageMimeType(mimeType: string): void {
  if (!mimeType.toLowerCase().startsWith('image/')) {
    throw new Error('Attachment data URL reads only support image MIME types')
  }
}

function decodeBase64DataUrl(dataUrl: string, mimeType: string): Buffer {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=_-]*)$/u.exec(dataUrl)
  if (!match) {
    throw new Error('Image draft attachment must be a base64 data URL')
  }
  if (match[1] !== mimeType) {
    throw new Error('Image draft attachment data URL MIME type does not match metadata')
  }
  return Buffer.from(match[2]!, 'base64')
}

function isWithinDirectory(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function createAttachmentStorage(userDataPath: string): AttachmentStorage {
  const attachmentRoot = path.resolve(userDataPath, 'attachments')

  const resolveRelativeAttachmentPath = (relativePath: string): string => {
    if (
      path.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath) ||
      path.posix.isAbsolute(relativePath) ||
      relativePath.includes('\\') ||
      !relativePath.startsWith('attachments/')
    ) {
      throw new Error('Invalid attachment relative path')
    }

    const parts = relativePath.split('/')
    if (parts.some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error('Invalid attachment relative path traversal')
    }

    const resolved = path.resolve(userDataPath, ...parts)
    if (!isWithinDirectory(resolved, attachmentRoot)) {
      throw new Error('Attachment path escapes attachment root')
    }
    return resolved
  }

  const resolveSessionDirectory = (sessionId: string): string => {
    return path.join(attachmentRoot, assertSafePathSegment(sessionId, 'sessionId'))
  }

  const resolveMessageDirectory = (sessionId: string, messageId: string): string => {
    return path.join(resolveSessionDirectory(sessionId), assertSafePathSegment(messageId, 'messageId'))
  }

  return {
    async saveDraftAttachments({ sessionId, messageId, draftAttachments }) {
      const safeSessionId = assertSafePathSegment(sessionId, 'sessionId')
      const safeMessageId = assertSafePathSegment(messageId, 'messageId')
      const messageDirectory = path.join(attachmentRoot, safeSessionId, safeMessageId)

      try {
        await fs.mkdir(messageDirectory, { recursive: true })

        const attachments: MessageAttachment[] = []
        for (const draftAttachment of draftAttachments) {
          const id = `attachment-${crypto.randomUUID()}`
          const fileName = `${id}-${sanitizeFileName(draftAttachment.name)}`
          const relativePath = toPosixRelativePath('attachments', safeSessionId, safeMessageId, fileName)
          const filePath = resolveRelativeAttachmentPath(relativePath)

          const data = draftAttachment.kind === 'image'
            ? (() => {
                assertImageMimeType(draftAttachment.mimeType)
                return decodeBase64DataUrl(draftAttachment.dataUrl, draftAttachment.mimeType)
              })()
            : Buffer.from(draftAttachment.content, 'utf8')
          await fs.writeFile(filePath, data)

          attachments.push({
            id,
            kind: draftAttachment.kind,
            name: draftAttachment.name,
            mimeType: draftAttachment.mimeType,
            bytes: data.byteLength,
            relativePath
          })
        }

        return attachments
      } catch (error) {
        await fs.rm(messageDirectory, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    },

    async readAttachmentDataUrl({ relativePath, mimeType }) {
      assertImageMimeType(mimeType)
      const data = await fs.readFile(resolveRelativeAttachmentPath(relativePath))
      return { dataUrl: `data:${mimeType};base64,${data.toString('base64')}` }
    },

    async readTextAttachment(relativePath) {
      return fs.readFile(resolveRelativeAttachmentPath(relativePath), 'utf8')
    },

    async readImageAttachment(relativePath) {
      return fs.readFile(resolveRelativeAttachmentPath(relativePath))
    },

    async deleteMessageAttachments({ sessionId, messageId }) {
      await fs.rm(resolveMessageDirectory(sessionId, messageId), { recursive: true, force: true })
    },

    async deleteSessionAttachments({ sessionId }) {
      await fs.rm(resolveSessionDirectory(sessionId), { recursive: true, force: true })
    }
  }
}
