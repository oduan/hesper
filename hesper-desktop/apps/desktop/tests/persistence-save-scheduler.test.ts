import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPersistenceSaveScheduler } from '../electron/persistence-save-scheduler'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function tick(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createPersistenceSaveScheduler', () => {
  it('catches scheduled save failures and logs them', async () => {
    vi.useFakeTimers()

    const savePersistence = vi.fn(async () => {
      throw new Error('save failed')
    })
    const flushPersistenceQueue = vi.fn(async () => {})
    const logError = vi.fn()
    const unhandledRejection = vi.fn()

    process.once('unhandledRejection', unhandledRejection)

    const scheduler = createPersistenceSaveScheduler({
      savePersistence,
      flushPersistenceQueue,
      logError
    })

    scheduler.schedule(50)
    await vi.advanceTimersByTimeAsync(50)
    await tick()

    expect(savePersistence).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('Failed to save scheduled persistence.', expect.any(Error))
    expect(unhandledRejection).not.toHaveBeenCalled()
  })

  it('flushScheduled clears a pending timer and only waits for the queue', async () => {
    vi.useFakeTimers()

    const savePersistence = vi.fn(async () => {})
    const queueFlush = deferred()
    const flushPersistenceQueue = vi.fn(async () => {
      await queueFlush.promise
    })
    const logError = vi.fn()
    const scheduler = createPersistenceSaveScheduler({
      savePersistence,
      flushPersistenceQueue,
      logError
    })

    scheduler.schedule(50)
    const flushPromise = scheduler.flushScheduled()

    await tick()
    expect(savePersistence).not.toHaveBeenCalled()
    expect(flushPersistenceQueue).toHaveBeenCalledTimes(1)

    let flushResolved = false
    flushPromise.then(() => {
      flushResolved = true
    })

    await tick()
    expect(flushResolved).toBe(false)

    queueFlush.resolve()
    await flushPromise

    expect(flushResolved).toBe(true)

    await vi.advanceTimersByTimeAsync(50)
    await tick()
    expect(savePersistence).not.toHaveBeenCalled()
  })
})
