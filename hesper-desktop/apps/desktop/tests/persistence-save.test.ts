import { describe, expect, it } from 'vitest'
import { createPersistenceSaveQueue } from '../electron/persistence-save-queue'

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
}

describe('createPersistenceSaveQueue', () => {
  it('serializes saves and samples bytes only when each queued save starts', async () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const firstWrite = deferred()
    let state = 'first-state'
    const writes: string[] = []

    const queue = createPersistenceSaveQueue({
      exportBytes: () => encoder.encode(state),
      writeFile: async (_filePath, bytes) => {
        writes.push(decoder.decode(bytes))
        if (writes.length === 1) await firstWrite.promise
      },
      mkdir: async () => {},
      dirname: () => '/tmp'
    })

    const firstSave = queue.save('/tmp/hesper.sqlite')
    await tick()
    expect(writes).toEqual(['first-state'])

    state = 'second-state-at-call-time'
    const secondSave = queue.save('/tmp/hesper.sqlite')
    await tick()
    expect(writes).toEqual(['first-state'])

    state = 'second-state-at-execution-time'
    firstWrite.resolve()
    await Promise.all([firstSave, secondSave])

    expect(writes).toEqual(['first-state', 'second-state-at-execution-time'])
  })

  it('flush waits for all queued saves to finish', async () => {
    const firstWrite = deferred()
    const writes: string[] = []
    let flushResolved = false

    const queue = createPersistenceSaveQueue({
      exportBytes: () => new TextEncoder().encode(`snapshot-${writes.length + 1}`),
      writeFile: async (_filePath, bytes) => {
        writes.push(new TextDecoder().decode(bytes))
        if (writes.length === 1) await firstWrite.promise
      },
      mkdir: async () => {},
      dirname: () => '/tmp'
    })

    const firstSave = queue.save('/tmp/hesper.sqlite')
    const secondSave = queue.save('/tmp/hesper.sqlite')
    const flush = queue.flush().then(() => {
      flushResolved = true
    })

    await tick()
    expect(flushResolved).toBe(false)
    expect(writes).toEqual(['snapshot-1'])

    firstWrite.resolve()
    await Promise.all([firstSave, secondSave, flush])

    expect(flushResolved).toBe(true)
    expect(writes).toEqual(['snapshot-1', 'snapshot-2'])
  })
})
