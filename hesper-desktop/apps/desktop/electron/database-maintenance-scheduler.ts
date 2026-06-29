import type { Persistence } from '@hesper/persistence'

export const defaultCheckpointIntervalMs = 30 * 60 * 1000
export const defaultVacuumIntervalMs = 7 * 24 * 60 * 60 * 1000

type MaintenancePersistence = Pick<Persistence, 'checkpoint' | 'vacuum'>

type MaintenanceTask = () => Promise<void>

export type DatabaseMaintenanceSchedulerOptions = {
  persistence: MaintenancePersistence
  checkpointIntervalMs?: number
  vacuumIntervalMs?: number
  logError: (message: string, error: unknown) => void
}

export type DatabaseMaintenanceScheduler = {
  start(): void
  stop(): void
  runCheckpoint(): Promise<void>
  runVacuum(): Promise<void>
}

function unrefTimer(timer: NodeJS.Timeout): void {
  timer.unref?.()
}

function createNonOverlappingTaskRunner(): (task: MaintenanceTask, onError: (error: unknown) => void) => Promise<void> {
  let running = false

  return async (task, onError) => {
    if (running) return
    running = true
    try {
      await task()
    } catch (error) {
      onError(error)
    } finally {
      running = false
    }
  }
}

export function createDatabaseMaintenanceScheduler({
  persistence,
  checkpointIntervalMs = defaultCheckpointIntervalMs,
  vacuumIntervalMs = defaultVacuumIntervalMs,
  logError
}: DatabaseMaintenanceSchedulerOptions): DatabaseMaintenanceScheduler {
  let checkpointTimer: NodeJS.Timeout | undefined
  let vacuumTimer: NodeJS.Timeout | undefined
  const runMaintenanceTask = createNonOverlappingTaskRunner()

  async function runCheckpoint(): Promise<void> {
    await persistence.checkpoint?.()
  }

  async function runVacuum(): Promise<void> {
    await persistence.checkpoint?.()
    await persistence.vacuum?.()
    await persistence.checkpoint?.()
  }

  function scheduleInterval(intervalMs: number, task: MaintenanceTask, message: string): NodeJS.Timeout | undefined {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return undefined
    const timer = setInterval(() => {
      void runMaintenanceTask(task, (error) => {
        logError(message, error)
      })
    }, intervalMs)
    unrefTimer(timer)
    return timer
  }

  function start(): void {
    if (!checkpointTimer) {
      checkpointTimer = scheduleInterval(checkpointIntervalMs, runCheckpoint, 'Failed to checkpoint persistence database.')
    }
    if (!vacuumTimer) {
      vacuumTimer = scheduleInterval(vacuumIntervalMs, runVacuum, 'Failed to vacuum persistence database.')
    }
  }

  function stop(): void {
    if (checkpointTimer) {
      clearInterval(checkpointTimer)
      checkpointTimer = undefined
    }
    if (vacuumTimer) {
      clearInterval(vacuumTimer)
      vacuumTimer = undefined
    }
  }

  return { start, stop, runCheckpoint, runVacuum }
}
