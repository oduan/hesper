# Native SQLite Persistence 设计

**日期：** 2026-06-26  
**目标：** 用 Electron/Node 内置 `node:sqlite` 替换桌面端文件持久化路径上的 `sql.js` 整库导出保存机制，消除标记、归档等轻量操作在大数据库下的 1–3 秒延迟。

## 背景与现状

当前 `@hesper/persistence` 使用 `sql.js`：

1. 启动时 `createFilePersistence(path)` 读取整个 `hesper.sqlite` 文件到内存。
2. Repository 写入只是写到内存 SQLite。
3. Electron 主进程的 `savePersistence()` 调用 `exportDatabaseBytes(container.persistence)`。
4. `exportDatabaseBytes()` 调用 `db.export()` 导出整库快照。
5. 主进程把整份快照写回 `hesper.sqlite`。

当前用户本机数据库约 1.14GB，所以任何同步等待 `savePersistence()` 的 IPC 都会等待一次大体积导出/写盘。标记、取消标记、归档、恢复、分类调整都因此出现明显延迟。

```mermaid
graph LR
  A[IPC: 标记/归档] --> B[sql.js 内存 DB 更新]
  B --> C[await savePersistence]
  C --> D[db.export 导出整库]
  D --> E[写回 1GB+ hesper.sqlite]
  E --> F[IPC 返回，UI 更新]
```

## 目标状态

文件持久化改为真正的磁盘 SQLite：

1. 启动时直接打开 `hesper.sqlite`。
2. 开启 WAL：`PRAGMA journal_mode = WAL`。
3. Repository 写入直接落到 SQLite/WAL。
4. Electron 中 `savePersistence()` 不再导出整库；退出时关闭连接并 checkpoint。
5. 标记、归档等 IPC 在 DB 单条写入完成后即可返回。

```mermaid
graph LR
  A[IPC: 标记/归档] --> B[node:sqlite 打开磁盘 DB]
  B --> C[UPDATE/UPSERT 单条写入]
  C --> D[SQLite WAL 增量落盘]
  D --> E[IPC 快速返回，UI 更新]
```

## 选择方案

采用方案 A：Electron/Node 内置 `node:sqlite`。

理由：

- 当前 Node 和 Electron 均已验证支持 `node:sqlite`。
- 不引入 `better-sqlite3` 这类 native addon，避免 Windows/Electron ABI、安装和打包复杂度。
- 现有数据库文件是标准 SQLite 格式，可直接由 native SQLite 打开。
- 唯一代价是当前 Node 会输出 ExperimentalWarning；这是可接受的开发/运行日志噪音，后续 Node 稳定后会自然消失。

## 架构设计

### 1. 新增 SQLite 适配层

新增一个小接口隔离 repository 和具体 SQLite 实现：

```ts
export type SqliteRow = Record<string, unknown>

export type SqliteAdapter = {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): void
  all(sql: string, params?: unknown[]): SqliteRow[]
  get(sql: string, params?: unknown[]): SqliteRow | undefined
  exportDatabaseBytes?: () => Uint8Array
  checkpoint?: () => void
  close?: () => void
}
```

`repositories.ts` 和 `schema.ts` 只依赖 `SqliteAdapter`，不直接依赖 `sql.js` 的 `prepare/step/getAsObject/free`。

### 2. 保留 sql.js 内存适配器

`createInMemoryPersistence(data?)` 继续使用 `sql.js`，原因：

- 大量测试依赖内存数据库。
- 测试 helper 仍用 sql.js 构造 legacy database bytes。
- `exportDatabaseBytes()` 仍可用于内存 DB 测试和兼容场景。

这不是生产文件路径，不影响桌面端大数据库性能。

### 3. 新增 node:sqlite 文件适配器

`createFilePersistence(path)` 改为：

1. 创建父目录。
2. `new DatabaseSync(path)` 打开磁盘 DB。
3. 设置：
   - `PRAGMA journal_mode = WAL`
   - `PRAGMA synchronous = NORMAL`
   - `PRAGMA busy_timeout = 5000`
   - `PRAGMA foreign_keys = ON`
4. 执行 `schemaSql` 和 `migrateDatabaseSchema(adapter)`。
5. 返回 `createRepositories(adapter)`。

文件路径打开后，所有 repository 写入都会由 SQLite 自己增量写入数据库/WAL。

### 4. Electron 主进程保存语义调整

`main.ts` 不再创建 `persistence-save-queue`，也不再调用 `exportDatabaseBytes()` 写整库。

保留同名函数以降低 IPC handler 改动：

```ts
async function savePersistence(): Promise<void> {
  // file-backed SQLite writes are durable at repository write time.
}

function schedulePersistenceSave(): void {
  // no-op for native SQLite file persistence.
}

async function flushScheduledPersistence(): Promise<void> {
  // no-op for native SQLite file persistence.
}
```

退出流程新增 `closePersistence()`：

1. 可选执行 `PRAGMA wal_checkpoint(TRUNCATE)`。
2. `db.close()`。

### 5. 数据兼容与迁移

现有 `hesper.sqlite` 是标准 SQLite 文件，native SQLite 可直接打开。现有 schema 迁移逻辑继续运行，包括：

- legacy sessions 列补齐
- roles legacy `can_be_subagent` 到 `can_be_worker_agent`
- model provider auth columns
- settings theme/soul columns

不会做数据重写或格式转换。首次 native 打开后可能出现 sidecar 文件：

- `hesper.sqlite-wal`
- `hesper.sqlite-shm`

这是 WAL 模式正常行为。

## 错误处理

- 如果 native SQLite 打开失败，错误会在启动时暴露，不静默创建空数据库覆盖用户数据。
- schema 迁移继续沿用现有显式 `ALTER TABLE` 模式。
- 退出 checkpoint/close 失败时记录错误，但不阻止应用退出。

## 测试策略

使用 TDD 分步验证：

1. 文件持久化测试先失败：`createFilePersistence(tempFile)` 保存 session 后，重新打开同一文件必须能读到 session。当前 sql.js 文件路径会失败，因为保存只在内存中。
2. legacy sql.js bytes 兼容测试：把旧格式 bytes 写入文件后，native `createFilePersistence` 能迁移并读取。
3. WAL/关闭测试：file-backed persistence 可以 close；重新打开不丢数据。
4. IPC/main 测试：主进程不再依赖 `exportDatabaseBytes()` 保存整库。
5. 回归测试：现有 persistence/app-core/desktop 测试继续通过。

## 非目标

本次不做以下事项：

- 不重构所有 repository API。
- 不引入 `better-sqlite3`。
- 不把所有批量业务操作一次性改成事务；去掉整库导出后，单条 WAL 写入已解决主要瓶颈。批量事务可作为后续优化。
- 不自动复制 1GB+ 数据库备份，避免首次启动产生额外长时间阻塞。用户如需备份，可手动复制 `hesper.sqlite`。

## 验收标准

- 桌面端启动后直接使用 native file-backed SQLite。
- 标记/取消标记、归档/恢复不再触发整库导出写盘。
- 修改后重新启动应用，元数据变更仍存在。
- `pnpm --filter @hesper/persistence test` 通过。
- `pnpm --filter @hesper/desktop test -- tests/ipc-handlers.test.ts` 通过。
- `pnpm typecheck` 通过。
- 最终 `pnpm check` 通过。
