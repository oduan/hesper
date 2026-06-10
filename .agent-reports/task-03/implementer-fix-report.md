# Task 3 修复报告

## Status
已完成

## 修复内容
- 修复 `runtime_events` 事件关联逻辑：新增统一 `extractRunId(event)`，覆盖 `run.created`、`run.started`、`message.delta`、`run.retrying`、`run.failed`、`run.succeeded`、`step.created`、`step.updated`、`message.completed`。
- `message.completed` 若缺少 `message.runId` 会抛出明确错误。
- `append()` 与 `listByRun()` 都使用 shared schema 解析与校验。
- 实现真实文件持久化语义：
  - `createFilePersistence(path)` 支持从文件字节加载数据库
  - `exportDatabaseBytes()` 返回当前数据库字节
- 修复稳定顺序：为各表增加 `sort_seq`，更新不会改变首次插入顺序。
- 修正 build/typecheck 配置，构建产物输出与 `dist/index.js` / `dist/index.d.ts` 匹配，并清理多余的 shared/test 产物。
- 去掉深层导入，改用 `@hesper/shared` 公开导出。
- 扩展 `sqljs.d.ts` 以支持 `new Database(data?: Uint8Array)` 和 `db.export()`。

## RED / GREEN 测试过程
### RED
先补充/更新测试后运行：
- `cd hesper-desktop && pnpm --filter @hesper/persistence test`

初始结果失败，暴露出：
- `runtime_events` 事件写入未覆盖所有变体
- 绑定 `undefined` 导致 sql.js 报错
- build 产物包含多余目录

### GREEN
修复后重新运行：
- `cd hesper-desktop && pnpm --filter @hesper/persistence test`
- `cd hesper-desktop && pnpm --filter @hesper/persistence typecheck`
- `cd hesper-desktop && pnpm --filter @hesper/persistence build`
- `cd hesper-desktop && pnpm check`

## 测试结果
- `pnpm --filter @hesper/persistence test`：通过
- `pnpm --filter @hesper/persistence typecheck`：通过
- `pnpm --filter @hesper/persistence build`：通过
- `pnpm check`：通过

## 变更文件
- `hesper-desktop/packages/persistence/package.json`
- `hesper-desktop/packages/persistence/tsconfig.json`
- `hesper-desktop/packages/persistence/tsconfig.build.json`
- `hesper-desktop/packages/persistence/tsconfig.typecheck.json`
- `hesper-desktop/packages/persistence/vitest.config.ts`
- `hesper-desktop/packages/persistence/src/schema.ts`
- `hesper-desktop/packages/persistence/src/database.ts`
- `hesper-desktop/packages/persistence/src/repositories.ts`
- `hesper-desktop/packages/persistence/src/sqljs.d.ts`
- `hesper-desktop/packages/persistence/src/index.ts`
- `hesper-desktop/packages/persistence/src/__tests__/repositories.test.ts`

## 提交 SHA
69d38f2f3b2638aa592be70ab369a59caf08b78c

## 自审结论
修复点已覆盖评审指出的 Critical/Important 问题，且未扩展到 Task 4。构建产物已恢复到可消费的包入口结构，persistence 的文件/内存持久化语义更接近实际需求。
