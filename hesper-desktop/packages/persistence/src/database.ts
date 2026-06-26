import { createRequire } from 'node:module'
import { createRepositories, type Persistence } from './repositories'
import { migrateDatabaseSchema, schemaSql } from './schema'
import { createSqlJsAdapter } from './sqljs-adapter'

async function createSqlJsPersistence(data?: Uint8Array): Promise<Persistence> {
  const require = createRequire(import.meta.url)
  const initSqlJs = require('sql.js') as () => Promise<{ Database: new (data?: Uint8Array) => any }>
  const SQL = await initSqlJs()
  const db = new SQL.Database(data)
  const adapter = createSqlJsAdapter(db)
  await adapter.exec(schemaSql)
  await migrateDatabaseSchema(adapter)
  return await createRepositories(adapter)
}

export async function createInMemoryPersistence(data?: Uint8Array): Promise<Persistence> {
  return createSqlJsPersistence(data)
}

export async function createFilePersistence(path: string): Promise<Persistence> {
  const { createNodeSqliteFileAdapter } = await import('./node-sqlite-adapter')
  const adapter = createNodeSqliteFileAdapter(path)
  await adapter.exec(schemaSql)
  await migrateDatabaseSchema(adapter)
  return await createRepositories(adapter)
}

export function exportDatabaseBytes(persistence: Persistence): Uint8Array {
  if (!persistence.exportDatabaseBytes) {
    throw new Error('Database byte export is not available for this persistence backend.')
  }
  return persistence.exportDatabaseBytes()
}
