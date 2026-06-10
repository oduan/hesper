# Task 3 实施报告

## Status
已完成

## 实现内容
- 新建 `@hesper/persistence` 包配置与测试配置。
- 实现 SQLite schema：`sessions`、`messages`、`agent_runs`、`run_steps`、`runtime_events`。
- 实现本地 persistence repositories：
  - `SessionRepository`
  - `MessageRepository`
  - `RunRepository`
  - `RunStepRepository`
  - `RuntimeEventRepository`
- 实现 `createInMemoryPersistence()`、`createFilePersistence()`、`exportDatabaseBytes()`。
- 读写时对 optional 字段做了 `undefined` 清理，避免显式保留 `undefined`。

## RED / GREEN 测试过程
### RED
先补了 repository 测试，然后运行：
- `cd hesper-desktop && pnpm --filter @hesper/persistence test`

结果：失败，原因是 `database.ts` 尚未实现。

### GREEN
补齐实现后，重新运行：
- `cd hesper-desktop && pnpm --filter @hesper/persistence test`
- `cd hesper-desktop && pnpm --filter @hesper/persistence typecheck`
- `cd hesper-desktop && pnpm check`

## 测试结果
- `pnpm --filter @hesper/persistence test`：通过
- `pnpm --filter @hesper/persistence typecheck`：通过
- `pnpm check`：通过

## 变更文件
- `hesper-desktop/packages/persistence/package.json`
- `hesper-desktop/packages/persistence/tsconfig.json`
- `hesper-desktop/packages/persistence/vitest.config.ts`
- `hesper-desktop/packages/persistence/src/schema.ts`
- `hesper-desktop/packages/persistence/src/database.ts`
- `hesper-desktop/packages/persistence/src/repositories.ts`
- `hesper-desktop/packages/persistence/src/index.ts`
- `hesper-desktop/packages/persistence/src/sqljs.d.ts`
- `hesper-desktop/packages/persistence/src/__tests__/repositories.test.ts`
- `hesper-desktop/pnpm-lock.yaml`

## 提交 SHA
bb71927de2f50bf0306f15f06278f17bfd5bdc09

## 自审结论
实现范围严格限制在 Task 3，没有扩展到 Task 4 app-core。已满足测试、类型检查与仓库检查要求。

## 问题或风险
- `exportDatabaseBytes()` 与 `createFilePersistence()` 当前为最小可用实现，后续需要与 Electron 文件落盘/wiring 进一步对接。
- `runtime_events` 的 event 读取目前以 JSON 形式保存与回放，后续如果 event 契约扩展，需要同步补充更严格的解析与过滤。