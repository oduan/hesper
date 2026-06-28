/// <reference path="./sqljs.d.ts" />
import type { Database } from 'sql.js'
import { bindSqliteValues, createSqliteOperationGate, type SqliteAdapter, type SqliteRow } from './sqlite-adapter'

export function createSqlJsAdapter(db: Database): SqliteAdapter {
  const gate = createSqliteOperationGate()

  const allSync = (sql: string, params: unknown[] = []): SqliteRow[] => {
    const stmt = db.prepare(sql)
    try {
      stmt.bind(bindSqliteValues(params))
      const rows: SqliteRow[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as SqliteRow)
      return rows
    } finally {
      stmt.free()
    }
  }

  return {
    exec(sql) {
      return gate.run(() => {
        db.run(sql)
      })
    },
    run(sql, params = []) {
      return gate.run(() => {
        db.run(sql, bindSqliteValues(params))
      })
    },
    all(sql, params = []) {
      return gate.run(() => allSync(sql, params))
    },
    get(sql, params = []) {
      return gate.run(() => allSync(sql, params)[0])
    },
    transaction(fn) {
      return gate.transaction(
        () => db.run('BEGIN IMMEDIATE'),
        () => db.run('COMMIT'),
        () => db.run('ROLLBACK'),
        fn
      )
    },
    exportDatabaseBytes() {
      return db.export()
    },
    vacuum() {
      return gate.run(() => {
        db.run('VACUUM')
      })
    },
    close() {
      db.close()
    }
  }
}
