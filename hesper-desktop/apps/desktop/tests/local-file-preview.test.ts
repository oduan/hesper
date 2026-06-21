import actualFs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('readLocalFilePreview', () => {
  afterEach(() => {
    vi.doUnmock('node:fs/promises')
    vi.resetModules()
  })

  it('rejects content that grows past the limit without using unbounded readFile', async () => {
    const workspacePath = await actualFs.mkdtemp(path.join(os.tmpdir(), 'hesper-preview-handle-'))
    try {
      await actualFs.writeFile(path.join(workspacePath, 'growing.md'), 'ok')

      const limitBytes = 1024 * 1024
      const oversizedContent = Buffer.alloc(limitBytes * 2, 'a')
      let cursor = 0
      const close = vi.fn(async () => {})
      const readFile = vi.fn(async () => oversizedContent)
      const read = vi.fn(async (buffer: Buffer, offset: number, length: number) => {
        const bytesRead = Math.min(length, oversizedContent.byteLength - cursor)
        oversizedContent.copy(buffer, offset, cursor, cursor + bytesRead)
        cursor += bytesRead
        return { bytesRead, buffer }
      })
      const stat = vi.fn(async () => ({
        isFile: () => true,
        size: 2
      }))
      const open = vi.fn(async () => ({ stat, read, readFile, close }))

      vi.resetModules()
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return {
          ...actual,
          open,
          default: {
            ...actual,
            open
          }
        }
      })

      const { readLocalFilePreview } = await import('../electron/local-file-preview')

      await expect(readLocalFilePreview({
        workspacePath,
        path: 'growing.md'
      })).rejects.toThrow(/too large/i)
      expect(open).toHaveBeenCalledTimes(1)
      expect(stat).toHaveBeenCalledTimes(1)
      expect(read).toHaveBeenCalled()
      expect(readFile).not.toHaveBeenCalled()
      expect(cursor).toBe(limitBytes + 1)
      expect(read.mock.calls.reduce((sum, call) => sum + (call[2] as number), 0)).toBe(limitBytes + 1)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      await actualFs.rm(workspacePath, { recursive: true, force: true })
    }
  })
})
