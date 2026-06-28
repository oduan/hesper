import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { bindSqliteValues, createSqliteOperationGate, type SqliteAdapter, type SqliteRow } from './sqlite-adapter'

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

  const gate = createSqliteOperationGate()

  const runWithParams = <T>(sql: string, params: unknown[], runner: (statement: StatementSync, bound: SQLInputValue[]) => T): T => {
    const statement = db.prepare(sql)
    return runner(statement, bindSqliteValues(params) as SQLInputValue[])
  }

  return {
    exec(sql) {
      return gate.run(() => {
        db.exec(sql)
      })
    },
    run(sql, params = []) {
      return gate.run(() => {
        runWithParams(sql, params, (statement, bound) => {
          statement.run(...bound)
        })
      })
    },
    all(sql, params = []) {
      return gate.run(() => runWithParams(sql, params, (statement, bound) => statement.all(...bound) as SqliteRow[]))
    },
    get(sql, params = []) {
      return gate.run(() => runWithParams(sql, params, (statement, bound) => statement.get(...bound) as SqliteRow | undefined))
    },
    transaction(fn) {
      return gate.transaction(
        () => db.exec('BEGIN IMMEDIATE'),
        () => db.exec('COMMIT'),
        () => db.exec('ROLLBACK'),
        fn
      )
    },
    checkpoint() {
      return gate.run(() => {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      })
    },
    vacuum() {
      return gate.run(() => {
        db.exec('VACUUM')
      })
    },
    close() {
      db.close()
    }
  }
}
