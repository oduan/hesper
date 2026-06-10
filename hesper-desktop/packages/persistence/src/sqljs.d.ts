declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: unknown[]): void
    prepare(sql: string): {
      bind(params: unknown[]): void
      step(): boolean
      getAsObject(): Record<string, unknown>
      free(): void
    }
    export(): Uint8Array
  }

  const initSqlJs: () => Promise<{
    Database: new (data?: Uint8Array) => Database
  }>

  export default initSqlJs
}
