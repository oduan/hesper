import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAttachmentStorage } from '../electron/attachment-storage'

describe('attachment storage', () => {
  it('writes text draft attachments to disk and returns file-backed metadata', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-attachments-'))
    try {
      const storage = createAttachmentStorage(userDataPath)
      const [attachment] = await storage.saveDraftAttachments({
        sessionId: 'session-1',
        messageId: 'message-1',
        draftAttachments: [
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 11, content: 'hello world' }
        ]
      })

      expect(attachment).toEqual(expect.objectContaining({
        id: expect.stringMatching(/^attachment-/),
        kind: 'text',
        name: 'notes.txt',
        mimeType: 'text/plain',
        bytes: 11,
        relativePath: expect.stringMatching(/^attachments\/session-1\/message-1\/.+\.txt$/)
      }))
      expect(JSON.stringify(attachment)).not.toContain('content')
      const content = await fs.readFile(path.join(userDataPath, ...attachment!.relativePath.split('/')), 'utf8')
      expect(content).toBe('hello world')
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('stores metadata bytes from actual written content instead of renderer input', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-attachments-'))
    try {
      const storage = createAttachmentStorage(userDataPath)
      const [textAttachment, imageAttachment] = await storage.saveDraftAttachments({
        sessionId: 'session-1',
        messageId: 'message-1',
        draftAttachments: [
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 999, content: '你好' },
          { kind: 'image', name: 'pixel.png', mimeType: 'image/png', bytes: 999, dataUrl: 'data:image/png;base64,aGVsbG8=' }
        ]
      })

      expect(textAttachment?.bytes).toBe(Buffer.byteLength('你好', 'utf8'))
      expect(imageAttachment?.bytes).toBe(Buffer.from('aGVsbG8=', 'base64').byteLength)
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('reads stored image draft attachments back as data URLs', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-attachments-'))
    try {
      const storage = createAttachmentStorage(userDataPath)
      const dataUrl = 'data:image/png;base64,aGVsbG8='
      const [attachment] = await storage.saveDraftAttachments({
        sessionId: 'session-1',
        messageId: 'message-1',
        draftAttachments: [
          { kind: 'image', name: 'pixel.png', mimeType: 'image/png', bytes: 5, dataUrl }
        ]
      })

      await expect(storage.readAttachmentDataUrl({ relativePath: attachment!.relativePath, mimeType: attachment!.mimeType })).resolves.toEqual({ dataUrl })
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('removes the message attachment directory when saving a later draft attachment fails', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-attachments-'))
    try {
      const storage = createAttachmentStorage(userDataPath)
      const messageDirectory = path.join(userDataPath, 'attachments', 'session-1', 'message-rollback')

      await expect(storage.saveDraftAttachments({
        sessionId: 'session-1',
        messageId: 'message-rollback',
        draftAttachments: [
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, content: 'hello' },
          { kind: 'image', name: 'broken.png', mimeType: 'image/png', bytes: 5, dataUrl: 'not-a-data-url' }
        ]
      })).rejects.toThrow('Image draft attachment must be a base64 data URL')

      await expect(fs.access(messageDirectory)).rejects.toThrow()
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('removes all attachment files for a deleted session', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-attachments-'))
    try {
      const storage = createAttachmentStorage(userDataPath)
      await storage.saveDraftAttachments({
        sessionId: 'session-delete',
        messageId: 'message-1',
        draftAttachments: [
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, content: 'hello' }
        ]
      })
      await storage.saveDraftAttachments({
        sessionId: 'session-delete',
        messageId: 'message-2',
        draftAttachments: [
          { kind: 'text', name: 'more.txt', mimeType: 'text/plain', bytes: 4, content: 'more' }
        ]
      })
      const [keptAttachment] = await storage.saveDraftAttachments({
        sessionId: 'session-keep',
        messageId: 'message-keep',
        draftAttachments: [
          { kind: 'text', name: 'keep.txt', mimeType: 'text/plain', bytes: 4, content: 'keep' }
        ]
      })

      await storage.deleteSessionAttachments({ sessionId: 'session-delete' })

      await expect(fs.access(path.join(userDataPath, 'attachments', 'session-delete'))).rejects.toThrow()
      await expect(fs.readFile(path.join(userDataPath, ...keptAttachment!.relativePath.split('/')), 'utf8')).resolves.toBe('keep')
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('rejects relative paths that traverse outside the attachments root', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-attachments-'))
    try {
      const storage = createAttachmentStorage(userDataPath)
      await expect(storage.readAttachmentDataUrl({ relativePath: '../secret.png', mimeType: 'image/png' })).rejects.toThrow(/attachments|path|traversal|relative/i)
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })
})
