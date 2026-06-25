import * as fs from 'fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js') as () => Promise<{ Database: new (data?: Uint8Array) => any }>
import { migrateDatabaseSchema, schemaSql } from './schema'
import { createRepositories, type Persistence } from './repositories'

async function createDatabase(data?: Uint8Array): Promise<Persistence> {
  const SQL = await initSqlJs()
  const db = new SQL.Database(data)
  db.run(schemaSql)
  migrateDatabaseSchema(db)
  return createRepositories(db)
}

export async function createInMemoryPersistence(data?: Uint8Array): Promise<Persistence> {
  return createDatabase(data)
}

export async function createFilePersistence(path: string): Promise<Persistence> {
  const bytes = fs.existsSync(path) ? fs.readFileSync(path) : undefined
  return createDatabase(bytes)
}

export function exportDatabaseBytes(persistence: Persistence): Uint8Array {
  return persistence.exportDatabaseBytes()
}
