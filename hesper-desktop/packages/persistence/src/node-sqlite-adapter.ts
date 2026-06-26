import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { bindSqliteValues, type SqliteAdapter, type SqliteRow } from './sqlite-adapter'

export function createNodeSqliteFileAdapter(filePath: string): SqliteAdapter {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  const db = new DatabaseSync(filePath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')

  const runWithParams = <T>(sql: string, params: unknown[], runner: (statement: StatementSync, bound: unknown[]) => T): T => {
    const statement = db.prepare(sql)
    return runner(statement, bindSqliteValues(params))
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
    checkpoint() {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    },
    close() {
      db.close()
    }
  }
}
