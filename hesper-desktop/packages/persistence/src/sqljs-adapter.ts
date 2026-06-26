/// <reference path="./sqljs.d.ts" />
import type { Database } from 'sql.js'
import { bindSqliteValues, type SqliteAdapter, type SqliteRow } from './sqlite-adapter'

export function createSqlJsAdapter(db: Database): SqliteAdapter {
  const all = (sql: string, params: unknown[] = []): SqliteRow[] => {
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
      db.run(sql)
    },
    run(sql, params = []) {
      db.run(sql, bindSqliteValues(params))
    },
    all,
    get(sql, params = []) {
      return all(sql, params)[0]
    },
    exportDatabaseBytes() {
      return db.export()
    },
    close() {
      db.close()
    }
  }
}
