import actualFs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('readLocalFilePreview', () => {
  afterEach(() => {
    vi.doUnmock('node:fs/promises')
    vi.resetModules()
  })

  it('rejects content that grows past the limit at the file-handle read point', async () => {
    const workspacePath = await actualFs.mkdtemp(path.join(os.tmpdir(), 'hesper-preview-handle-'))
    try {
      await actualFs.writeFile(path.join(workspacePath, 'growing.md'), 'ok')

      const oversizedContent = Buffer.alloc(1024 * 1024 + 1, 'a')
      const close = vi.fn(async () => {})
      const readFile = vi.fn(async () => oversizedContent)
      const stat = vi.fn(async () => ({
        isFile: () => true,
        size: 2
      }))
      const open = vi.fn(async () => ({ stat, readFile, close }))

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
      expect(readFile).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      await actualFs.rm(workspacePath, { recursive: true, force: true })
    }
  })
})
