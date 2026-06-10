import fs from 'node:fs'
import initSqlJs from 'sql.js'
import { schemaSql } from './schema'
import { createRepositories, type Persistence } from './repositories'

async function createDatabase(data?: Uint8Array): Promise<Persistence> {
  const SQL = await initSqlJs()
  const db = new SQL.Database(data)
  db.run(schemaSql)
  return createRepositories(db)
}

export async function createInMemoryPersistence(): Promise<Persistence> {
  return createDatabase()
}

export async function createFilePersistence(path: string): Promise<Persistence> {
  const bytes = fs.existsSync(path) ? fs.readFileSync(path) : undefined
  return createDatabase(bytes)
}

export function exportDatabaseBytes(persistence: Persistence): Uint8Array {
  return persistence.exportDatabaseBytes()
}
