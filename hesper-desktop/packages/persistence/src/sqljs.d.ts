declare module 'sql.js' {
  export type Database = {
    run(sql: string, params?: unknown[]): void
    prepare(sql: string): any
    export(): Uint8Array
  }

  export default function initSqlJs(): Promise<{
    Database: new (data?: Uint8Array) => Database
  }>
}
