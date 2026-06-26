export type SqliteRow = Record<string, unknown>

export type SqliteAdapter = {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): void
  all(sql: string, params?: unknown[]): SqliteRow[]
  get(sql: string, params?: unknown[]): SqliteRow | undefined
  exportDatabaseBytes?: () => Uint8Array
  checkpoint?: () => void
  close?: () => void
}

export function bindSqliteValues(values: unknown[] = []): unknown[] {
  return values.map((value) => (value === undefined ? null : value))
}
