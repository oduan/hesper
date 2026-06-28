import { AsyncLocalStorage } from 'node:async_hooks'

export type SqliteRow = Record<string, unknown>

export type SqliteAdapter = {
  exec(sql: string): Promise<void>
  run(sql: string, params?: unknown[]): Promise<void>
  all(sql: string, params?: unknown[]): Promise<SqliteRow[]>
  get(sql: string, params?: unknown[]): Promise<SqliteRow | undefined>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  exportDatabaseBytes?: () => Uint8Array
  checkpoint?: () => Promise<void> | void
  vacuum?: () => Promise<void> | void
  close?: () => void
}

export type SqliteOperationGate = {
  run<T>(fn: () => T | Promise<T>): Promise<T>
  transaction<T>(begin: () => void, commit: () => void, rollback: () => void, fn: () => Promise<T>): Promise<T>
}

export function bindSqliteValues(values: unknown[] = []): unknown[] {
  return values.map((value) => (value === undefined ? null : value))
}

export function createSqliteOperationGate(): SqliteOperationGate {
  const storage = new AsyncLocalStorage<symbol>()
  let activeTransactionToken: symbol | undefined
  let tail: Promise<unknown> = Promise.resolve()

  const enqueue = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => undefined)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  const isTransactionOwner = (): boolean => {
    return activeTransactionToken !== undefined && storage.getStore() === activeTransactionToken
  }

  return {
    run(fn) {
      if (isTransactionOwner()) return Promise.resolve().then(fn)
      return enqueue(fn)
    },
    transaction(begin, commit, rollback, fn) {
      if (isTransactionOwner()) return fn()

      const token = Symbol('sqlite-transaction')
      return enqueue(() => storage.run(token, async () => {
        activeTransactionToken = token
        try {
          begin()
          try {
            const result = await fn()
            commit()
            return result
          } catch (error) {
            rollback()
            throw error
          }
        } finally {
          activeTransactionToken = undefined
        }
      }))
    }
  }
}
