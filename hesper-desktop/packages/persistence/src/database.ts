import initSqlJs from 'sql.js'
import { schemaSql } from './schema'
import { createRepositories, type Persistence } from './repositories'

export async function createInMemoryPersistence(): Promise<Persistence> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(schemaSql)
  return createRepositories(db)
}

export async function createFilePersistence(_path: string): Promise<Persistence> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(schemaSql)
  return createRepositories(db)
}

export function exportDatabaseBytes(_persistence: Persistence): Uint8Array {
  return new Uint8Array()
}
