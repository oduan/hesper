import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { bindSqliteValues, type SqliteAdapter, type SqliteRow } from './sqlite-adapter'

export function createNodeSqliteFileAdapter(filePath: string): SqliteAdapter {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  const db = new DatabaseSync(filePath)
  const journalMode = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: unknown } | undefined
  if (String(journalMode?.journal_mode ?? '').toLowerCase() !== 'wal') {
    db.close()
    throw new Error(`Failed to enable SQLite WAL journal mode for ${filePath}.`)
  }
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')

  let transactionDepth = 0

  const runWithParams = <T>(sql: string, params: unknown[], runner: (statement: StatementSync, bound: SQLInputValue[]) => T): T => {
    const statement = db.prepare(sql)
    return runner(statement, bindSqliteValues(params) as SQLInputValue[])
  }

  return {
    exec(sql) {
      db.exec(sql)
    },
    run(sql, params = []) {
      runWithParams(sql, params, (statement, bound) => {
        statement.run(...bound)
      })
    },
    all(sql, params = []) {
      return runWithParams(sql, params, (statement, bound) => statement.all(...bound) as SqliteRow[])
    },
    get(sql, params = []) {
      return runWithParams(sql, params, (statement, bound) => statement.get(...bound) as SqliteRow | undefined)
    },
    async transaction(fn) {
      if (transactionDepth > 0) return fn()
      transactionDepth += 1
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        transactionDepth -= 1
      }
    },
    checkpoint() {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    },
    close() {
      db.close()
    }
  }
}
