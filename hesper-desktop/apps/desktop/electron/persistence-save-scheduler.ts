export interface PersistenceSaveSchedulerOptions {
  savePersistence: () => Promise<void>
  flushPersistenceQueue: () => Promise<void>
  logError: (message: string, error: unknown) => void
}

export interface PersistenceSaveScheduler {
  schedule: (delayMs?: number) => void
  flushScheduled: () => Promise<void>
}

export function createPersistenceSaveScheduler({
  savePersistence,
  flushPersistenceQueue,
  logError
}: PersistenceSaveSchedulerOptions): PersistenceSaveScheduler {
  let timer: NodeJS.Timeout | undefined

  function schedule(delayMs = 50): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void savePersistence().catch((error) => {
        logError('Failed to save scheduled persistence.', error)
      })
    }, delayMs)
  }

  async function flushScheduled(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }

    await flushPersistenceQueue()
  }

  return { schedule, flushScheduled }
}
