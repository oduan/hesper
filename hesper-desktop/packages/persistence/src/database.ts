import { createRequire } from 'node:module'
import { createNodeSqliteFileAdapter } from './node-sqlite-adapter'
import { createRepositories, type Persistence } from './repositories'
import { migrateDatabaseSchema, schemaSql } from './schema'
import { createSqlJsAdapter } from './sqljs-adapter'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js') as () => Promise<{ Database: new (data?: Uint8Array) => any }>

async function createSqlJsPersistence(data?: Uint8Array): Promise<Persistence> {
  const SQL = await initSqlJs()
  const db = new SQL.Database(data)
  const adapter = createSqlJsAdapter(db)
  adapter.exec(schemaSql)
  migrateDatabaseSchema(adapter)
  return createRepositories(adapter)
}

export async function createInMemoryPersistence(data?: Uint8Array): Promise<Persistence> {
  return createSqlJsPersistence(data)
}

export async function createFilePersistence(path: string): Promise<Persistence> {
  const adapter = createNodeSqliteFileAdapter(path)
  adapter.exec(schemaSql)
  migrateDatabaseSchema(adapter)
  return createRepositories(adapter)
}

export function exportDatabaseBytes(persistence: Persistence): Uint8Array {
  return persistence.exportDatabaseBytes()
}
