import { describe, expect, it, vi } from 'vitest'
import { createBeforeQuitHandler } from '../electron/before-quit'

describe('createBeforeQuitHandler', () => {
  it('prevents the first quit, flushes persistence, and retries quit once', async () => {
    const flushScheduledPersistence = vi.fn(async () => {})
    const savePersistence = vi.fn(async () => {})
    const disposeIpcHandlers = vi.fn()
    const quit = vi.fn()
    const preventDefault = vi.fn()

    const handler = createBeforeQuitHandler({
      flushScheduledPersistence,
      savePersistence,
      disposeIpcHandlers: () => disposeIpcHandlers(),
      quit,
      logError: vi.fn()
    })

    handler({ preventDefault })
    await Promise.resolve()
    await Promise.resolve()

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(flushScheduledPersistence).toHaveBeenCalledTimes(1)
    expect(savePersistence).toHaveBeenCalledTimes(1)
    expect(disposeIpcHandlers).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)

    handler({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(flushScheduledPersistence).toHaveBeenCalledTimes(1)
    expect(savePersistence).toHaveBeenCalledTimes(1)
    expect(disposeIpcHandlers).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('logs flush failures and still retries quit without blocking forever', async () => {
    const flushScheduledPersistence = vi.fn(async () => {
      throw new Error('flush failed')
    })
    const savePersistence = vi.fn(async () => {})
    const quit = vi.fn()
    const preventDefault = vi.fn()
    const logError = vi.fn()

    const handler = createBeforeQuitHandler({
      flushScheduledPersistence,
      savePersistence,
      disposeIpcHandlers: vi.fn(),
      quit,
      logError
    })

    handler({ preventDefault })
    await Promise.resolve()
    await Promise.resolve()

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('Failed to flush persistence before quit.', expect.any(Error))
    expect(quit).toHaveBeenCalledTimes(1)
    expect(savePersistence).not.toHaveBeenCalled()
  })
})
