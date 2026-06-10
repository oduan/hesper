declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: unknown[]): void
    prepare(sql: string): {
      bind(params: unknown[]): void
      step(): boolean
      getAsObject(): Record<string, unknown>
      free(): void
    }
  }

  const initSqlJs: () => Promise<{
    Database: new () => Database
  }>

  export default initSqlJs
}
