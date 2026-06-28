import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseMaintenanceScheduler } from '../electron/database-maintenance-scheduler'

async function tick(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createDatabaseMaintenanceScheduler', () => {
  it('runs periodic WAL checkpoints', async () => {
    vi.useFakeTimers()
    const checkpoint = vi.fn()
    const vacuum = vi.fn()
    const scheduler = createDatabaseMaintenanceScheduler({
      persistence: { checkpoint, vacuum },
      checkpointIntervalMs: 50,
      vacuumIntervalMs: 0,
      logError: vi.fn()
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(50)
    await tick()

    expect(checkpoint).toHaveBeenCalledTimes(1)
    expect(vacuum).not.toHaveBeenCalled()

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(50)
    await tick()
    expect(checkpoint).toHaveBeenCalledTimes(1)
  })

  it('runs periodic vacuum with checkpoints before and after', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const checkpoint = vi.fn(() => { calls.push('checkpoint') })
    const vacuum = vi.fn(() => { calls.push('vacuum') })
    const scheduler = createDatabaseMaintenanceScheduler({
      persistence: { checkpoint, vacuum },
      checkpointIntervalMs: 0,
      vacuumIntervalMs: 100,
      logError: vi.fn()
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(calls).toEqual(['checkpoint', 'vacuum', 'checkpoint'])
  })

  it('logs maintenance failures without throwing from timer callbacks', async () => {
    vi.useFakeTimers()
    const error = new Error('vacuum failed')
    const checkpoint = vi.fn()
    const vacuum = vi.fn(() => { throw error })
    const logError = vi.fn()
    const scheduler = createDatabaseMaintenanceScheduler({
      persistence: { checkpoint, vacuum },
      checkpointIntervalMs: 0,
      vacuumIntervalMs: 100,
      logError
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(logError).toHaveBeenCalledWith('Failed to vacuum persistence database.', error)
  })
})
