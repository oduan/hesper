# Hesper Desktop MVP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 `hesper-desktop/` 的第一个可运行桌面端版本，完成高信息密度三栏 UI、会话管理、基于 pi core 的单会话 Agent 闭环、步骤流、输出全屏、队列和重试。

**Architecture:** 采用 Desktop Shell + app-core + agent-runtime + capability modules。Electron 只做窗口、preload、IPC 和系统桥接；`agent-runtime` 封装 `@earendil-works/pi-agent-core`，把 pi core 事件转成 hesper 的持久化事件流；UI 只消费 app-core 聚合状态。

**Tech Stack:** Node >= 22.19.0, pnpm 11.5.2, TypeScript 6.0.3, Electron 42.4.0, React 19.2.7, Vite 8.0.16, Vitest 4.1.8, Playwright 1.60.0, zod 4.4.3, sql.js 1.14.1, `@earendil-works/pi-agent-core` 0.79.1, `@earendil-works/pi-ai` 0.79.1。

---

## 0. 执行约束

- 每个任务按 TDD 执行：先测试，确认失败，再实现，确认通过，再提交。
- 每个任务独立提交一次。
- 提交信息使用 Conventional Commits，并包含：

```bash
Co-Authored-By: Craft Agent <agents-noreply@craft.do>
```

- 不删除仓库根目录下当前未跟踪的 `nul` 文件，除非主人明确同意。实施时可以保持它未跟踪。
- 实施前确认 `node --version` 满足 `>=22.19.0`。
- pi core 集成使用当前包名：`@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`。

## 1. 文件结构总览

实施完成后应有以下核心文件。任务列表会逐步创建它们。

```text
hesper-desktop/
├─ package.json                         # workspace 根脚本和固定依赖
├─ pnpm-workspace.yaml                   # pnpm workspace
├─ tsconfig.base.json                    # 全局 TS 配置
├─ vitest.workspace.ts                   # Vitest workspace 配置
├─ .npmrc                                # 固定依赖和安装策略
├─ apps/
│  └─ desktop/
│     ├─ package.json
│     ├─ electron/
│     │  ├─ main.ts                      # Electron 主进程
│     │  ├─ preload.ts                   # 安全 IPC bridge
│     │  ├─ ipc-handlers.ts              # IPC handlers
│     │  └─ service-container.ts         # app-core/runtime/persistence 组合
│     ├─ renderer/
│     │  ├─ index.html
│     │  ├─ src/
│     │  │  ├─ main.tsx
│     │  │  ├─ App.tsx
│     │  │  ├─ app-store.tsx
│     │  │  ├─ ipc-client.ts
│     │  │  └─ styles.css
│     │  └─ tests/
│     │     ├─ app-shell.test.tsx
│     │     ├─ conversation-view.test.tsx
│     │     └─ shortcuts.test.tsx
│     └─ tests/
│        └─ desktop.e2e.spec.ts
└─ packages/
   ├─ shared/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  └─ src/
   │     ├─ index.ts
   │     ├─ domain.ts                    # Session/Message/Run/Step/Skill/Role/Tool 类型
   │     ├─ events.ts                    # AgentRuntimeEvent 类型
   │     ├─ schemas.ts                   # zod IPC/runtime schema
   │     ├─ result.ts                    # Result helper
   │     ├─ ids.ts                       # id/time helpers
   │     └─ __tests__/
   │        ├─ schemas.test.ts
   │        └─ result.test.ts
   ├─ persistence/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  └─ src/
   │     ├─ index.ts
   │     ├─ schema.ts                    # SQL schema
   │     ├─ database.ts                  # sql.js database wrapper
   │     ├─ repositories.ts              # Repository interfaces + implementation
   │     └─ __tests__/
   │        └─ repositories.test.ts
   ├─ app-core/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  └─ src/
   │     ├─ index.ts
   │     ├─ session-service.ts
   │     ├─ conversation-service.ts
   │     ├─ settings-service.ts
   │     ├─ registry-services.ts
   │     └─ __tests__/
   │        ├─ session-service.test.ts
   │        ├─ conversation-service.test.ts
   │        └─ registry-services.test.ts
   ├─ tools/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  └─ src/
   │     ├─ index.ts
   │     ├─ builtin-tools.ts
   │     └─ __tests__/
   │        └─ builtin-tools.test.ts
   ├─ agent-runtime/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  └─ src/
   │     ├─ index.ts
   │     ├─ runtime.ts                   # queue + lifecycle
   │     ├─ retry-policy.ts
   │     ├─ adapters.ts                  # AgentAdapter interface
   │     ├─ mock-adapter.ts              # deterministic adapter for tests/e2e
   │     ├─ pi-core-adapter.ts           # pi core integration
   │     ├─ map-pi-event.ts              # pi event -> hesper event
   │     └─ __tests__/
   │        ├─ retry-policy.test.ts
   │        ├─ runtime-queue.test.ts
   │        └─ pi-event-mapping.test.ts
   └─ ui/
      ├─ package.json
      ├─ tsconfig.json
      └─ src/
         ├─ index.ts
         ├─ theme.ts
         ├─ layout/
         │  ├─ AppShell.tsx
         │  ├─ ActivityRail.tsx
         │  ├─ EntityListPane.tsx
         │  └─ TitleBar.tsx
         └─ conversation/
            ├─ ConversationView.tsx
            ├─ MessageBubble.tsx
            ├─ RunSteps.tsx
            ├─ OutputBlock.tsx
            ├─ FullscreenOutput.tsx
            ├─ Composer.tsx
            └─ RightNavigation.tsx
```

## 2. 任务列表

### Task 1: 初始化 `hesper-desktop` workspace 和工具链

**Files:**
- Create: `hesper-desktop/package.json`
- Create: `hesper-desktop/pnpm-workspace.yaml`
- Create: `hesper-desktop/tsconfig.base.json`
- Create: `hesper-desktop/vitest.workspace.ts`
- Create: `hesper-desktop/.npmrc`
- Create: `hesper-desktop/README.md`

- [ ] **Step 1: 创建目录**

Run:

```bash
mkdir -p hesper-desktop/apps/desktop/electron hesper-desktop/apps/desktop/renderer/src hesper-desktop/packages/{shared,persistence,app-core,tools,agent-runtime,ui}/src
```

Expected: command exits with code 0 and `hesper-desktop/` exists.

- [ ] **Step 2: 写入 workspace 根 `package.json`**

Create `hesper-desktop/package.json`:

```json
{
  "name": "hesper-desktop-workspace",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.5.2",
  "engines": {
    "node": ">=22.19.0"
  },
  "scripts": {
    "build": "pnpm -r --sort build",
    "typecheck": "pnpm -r --sort typecheck",
    "test": "vitest --run --workspace vitest.workspace.ts",
    "test:watch": "vitest --workspace vitest.workspace.ts",
    "dev": "pnpm --filter @hesper/desktop dev",
    "e2e": "pnpm --filter @hesper/desktop e2e",
    "check": "pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@types/node": "25.9.2",
    "@vitejs/plugin-react": "6.0.2",
    "@vitest/coverage-v8": "4.1.8",
    "concurrently": "10.0.3",
    "electron": "42.4.0",
    "eslint": "10.4.1",
    "jsdom": "29.1.1",
    "playwright": "1.60.0",
    "prettier": "3.8.4",
    "tsx": "4.22.4",
    "typescript": "6.0.3",
    "typescript-eslint": "8.61.0",
    "vite": "8.0.16",
    "vitest": "4.1.8",
    "wait-on": "9.0.10"
  }
}
```

- [ ] **Step 3: 写入 workspace 配置**

Create `hesper-desktop/pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `hesper-desktop/.npmrc`:

```ini
save-exact=true
engine-strict=true
strict-peer-dependencies=false
```

Create `hesper-desktop/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@hesper/shared": ["packages/shared/src/index.ts"],
      "@hesper/persistence": ["packages/persistence/src/index.ts"],
      "@hesper/app-core": ["packages/app-core/src/index.ts"],
      "@hesper/tools": ["packages/tools/src/index.ts"],
      "@hesper/agent-runtime": ["packages/agent-runtime/src/index.ts"],
      "@hesper/ui": ["packages/ui/src/index.ts"]
    }
  }
}
```

Create `hesper-desktop/vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'apps/desktop/vitest.config.ts'
])
```

Create `hesper-desktop/README.md`:

````md
# hesper desktop

MVP1 desktop client for hesper.

- Electron shell
- React renderer
- pi core based agent runtime
- local-first persistence
- high-density native-like UI

## Commands

```bash
pnpm install
pnpm check
pnpm dev
```
````

- [ ] **Step 4: 安装依赖**

Run:

```bash
cd hesper-desktop
corepack enable
corepack prepare pnpm@11.5.2 --activate
pnpm install
```

Expected: `pnpm-lock.yaml` is created and install exits with code 0.

- [ ] **Step 5: 提交 workspace 初始化**

Run:

```bash
git add hesper-desktop/package.json hesper-desktop/pnpm-workspace.yaml hesper-desktop/tsconfig.base.json hesper-desktop/vitest.workspace.ts hesper-desktop/.npmrc hesper-desktop/README.md hesper-desktop/pnpm-lock.yaml
git commit -m "chore: initialize hesper desktop workspace" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 2: 建立 shared 类型、schema 和 Result helper

**Files:**
- Create: `hesper-desktop/packages/shared/package.json`
- Create: `hesper-desktop/packages/shared/tsconfig.json`
- Create: `hesper-desktop/packages/shared/vitest.config.ts`
- Create: `hesper-desktop/packages/shared/src/domain.ts`
- Create: `hesper-desktop/packages/shared/src/events.ts`
- Create: `hesper-desktop/packages/shared/src/schemas.ts`
- Create: `hesper-desktop/packages/shared/src/result.ts`
- Create: `hesper-desktop/packages/shared/src/ids.ts`
- Create: `hesper-desktop/packages/shared/src/index.ts`
- Create: `hesper-desktop/packages/shared/src/__tests__/schemas.test.ts`
- Create: `hesper-desktop/packages/shared/src/__tests__/result.test.ts`

- [ ] **Step 1: 写 package 配置**

Create `hesper-desktop/packages/shared/package.json`:

```json
{
  "name": "@hesper/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "zod": "4.4.3"
  },
  "devDependencies": {}
}
```

Create `hesper-desktop/packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Create `hesper-desktop/packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 2: 写失败测试**

Create `hesper-desktop/packages/shared/src/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { agentRuntimeEventSchema, sessionSchema } from '../schemas'

const now = new Date('2026-06-10T03:00:00.000Z').toISOString()

describe('shared schemas', () => {
  it('validates a session with markdown output mode', () => {
    const parsed = sessionSchema.parse({
      id: 'session-1',
      title: 'Build hesper',
      status: 'active',
      outputMode: 'markdown',
      createdAt: now,
      updatedAt: now
    })

    expect(parsed.title).toBe('Build hesper')
  })

  it('rejects an invalid output mode', () => {
    expect(() =>
      sessionSchema.parse({
        id: 'session-1',
        title: 'Build hesper',
        status: 'active',
        outputMode: 'pdf',
        createdAt: now,
        updatedAt: now
      })
    ).toThrow()
  })

  it('validates a message delta event', () => {
    const parsed = agentRuntimeEventSchema.parse({
      type: 'message.delta',
      runId: 'run-1',
      delta: 'hello'
    })

    expect(parsed.type).toBe('message.delta')
  })
})
```

Create `hesper-desktop/packages/shared/src/__tests__/result.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { err, isErr, isOk, ok, unwrap } from '../result'

describe('Result helpers', () => {
  it('unwraps ok values', () => {
    const value = ok(42)
    expect(isOk(value)).toBe(true)
    expect(unwrap(value)).toBe(42)
  })

  it('throws when unwrapping errors', () => {
    const value = err({ code: 'boom', message: 'Failed' })
    expect(isErr(value)).toBe(true)
    expect(() => unwrap(value)).toThrow('Failed')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/shared test
```

Expected: FAIL because `schemas.ts` and `result.ts` do not exist.

- [ ] **Step 4: 实现 shared 类型和 helper**

Create `hesper-desktop/packages/shared/src/domain.ts`:

```ts
export type SessionStatus = 'active' | 'archived' | 'deleted'
export type OutputMode = 'markdown' | 'html'
export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageContentType = 'markdown' | 'html' | 'plain'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type RunStepType = 'thought' | 'tool_call' | 'tool_result' | 'model_call' | 'retry' | 'warning'
export type RunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export type RunError = {
  code: 'network_error' | 'timeout' | 'rate_limit_transient' | 'stream_interrupted' | 'tool_error' | 'unknown'
  message: string
  retryable: boolean
}

export type Session = {
  id: string
  title: string
  status: SessionStatus
  workspacePath?: string
  defaultModelId?: string
  outputMode: OutputMode
  createdAt: string
  updatedAt: string
}

export type Message = {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  contentType: MessageContentType
  runId?: string
  createdAt: string
}

export type AgentRun = {
  id: string
  sessionId: string
  parentRunId?: string
  status: RunStatus
  modelId: string
  workspacePath?: string
  retryCount: number
  maxRetries: number
  startedAt?: string
  endedAt?: string
  error?: RunError
}

export type RunStep = {
  id: string
  runId: string
  type: RunStepType
  status: RunStepStatus
  title: string
  summary?: string
  detail?: string
  createdAt: string
  completedAt?: string
}

export type Skill = {
  id: string
  name: string
  description?: string
  source: 'builtin' | 'workspace' | 'project'
  path?: string
}

export type Role = {
  id: string
  name: string
  description?: string
  defaultModelId?: string
  allowedSkillIds: string[]
  canBeMainAgent: boolean
  canBeSubagent: boolean
}

export type ToolDefinition = {
  id: string
  name: string
  description: string
  inputSchema: unknown
  category: 'filesystem' | 'git' | 'web' | 'agent' | 'system'
}
```

Create `hesper-desktop/packages/shared/src/events.ts`:

```ts
import type { AgentRun, Message, RunError, RunStep } from './domain'

export type AgentRuntimeEvent =
  | { type: 'run.created'; run: AgentRun }
  | { type: 'run.started'; runId: string }
  | { type: 'step.created'; step: RunStep }
  | { type: 'step.updated'; step: RunStep }
  | { type: 'message.delta'; runId: string; delta: string }
  | { type: 'message.completed'; message: Message }
  | { type: 'run.retrying'; runId: string; retryCount: number; nextRetryAt: string }
  | { type: 'run.failed'; runId: string; error: RunError }
  | { type: 'run.succeeded'; runId: string }
```

Create `hesper-desktop/packages/shared/src/result.ts`:

```ts
export type AppError = {
  code: string
  message: string
  cause?: unknown
}

export type Result<T, E extends AppError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E extends AppError>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok
}

export function isErr<T, E extends AppError>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok
}

export function unwrap<T, E extends AppError>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}
```

Create `hesper-desktop/packages/shared/src/ids.ts`:

```ts
export type IdPrefix = 'session' | 'message' | 'run' | 'step' | 'skill' | 'role' | 'tool'

export function createId(prefix: IdPrefix): string {
  const random = crypto.randomUUID()
  return `${prefix}-${random}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
```

Create `hesper-desktop/packages/shared/src/schemas.ts` with zod schemas matching `domain.ts` and `events.ts`. The implementation must export `sessionSchema`, `messageSchema`, `agentRunSchema`, `runStepSchema`, `skillSchema`, `roleSchema`, `toolDefinitionSchema`, `runErrorSchema`, and `agentRuntimeEventSchema`. Use `z.discriminatedUnion('type', [runCreatedEventSchema, runStartedEventSchema, stepCreatedEventSchema, stepUpdatedEventSchema, messageDeltaEventSchema, messageCompletedEventSchema, runRetryingEventSchema, runFailedEventSchema, runSucceededEventSchema])` for runtime events.

Required code shape:

```ts
import { z } from 'zod'

export const sessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['active', 'archived', 'deleted']),
  workspacePath: z.string().optional(),
  defaultModelId: z.string().optional(),
  outputMode: z.enum(['markdown', 'html']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const runErrorSchema = z.object({
  code: z.enum(['network_error', 'timeout', 'rate_limit_transient', 'stream_interrupted', 'tool_error', 'unknown']),
  message: z.string().min(1),
  retryable: z.boolean()
})
```

Create `hesper-desktop/packages/shared/src/index.ts`:

```ts
export * from './domain'
export * from './events'
export * from './ids'
export * from './result'
export * from './schemas'
```

- [ ] **Step 5: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/shared test
pnpm --filter @hesper/shared typecheck
```

Expected: both pass.

- [ ] **Step 6: 提交 shared contracts**

Run:

```bash
git add hesper-desktop/packages/shared
git commit -m "feat: add shared domain contracts" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 3: 实现本地 persistence repository

**Files:**
- Create: `hesper-desktop/packages/persistence/package.json`
- Create: `hesper-desktop/packages/persistence/tsconfig.json`
- Create: `hesper-desktop/packages/persistence/vitest.config.ts`
- Create: `hesper-desktop/packages/persistence/src/schema.ts`
- Create: `hesper-desktop/packages/persistence/src/database.ts`
- Create: `hesper-desktop/packages/persistence/src/repositories.ts`
- Create: `hesper-desktop/packages/persistence/src/index.ts`
- Create: `hesper-desktop/packages/persistence/src/__tests__/repositories.test.ts`

- [ ] **Step 1: 写 package 配置**

Create `hesper-desktop/packages/persistence/package.json`:

```json
{
  "name": "@hesper/persistence",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "@hesper/shared": "workspace:*",
    "sql.js": "1.14.1"
  },
  "devDependencies": {}
}
```

Create `hesper-desktop/packages/persistence/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Create `hesper-desktop/packages/persistence/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 2: 写 repository 失败测试**

Create `hesper-desktop/packages/persistence/src/__tests__/repositories.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createInMemoryPersistence } from '../database'

const now = '2026-06-10T03:00:00.000Z'

describe('persistence repositories', () => {
  it('creates and lists sessions without deleted sessions', async () => {
    const db = await createInMemoryPersistence()
    await db.sessions.save({
      id: 'session-1',
      title: 'Build hesper',
      status: 'active',
      outputMode: 'markdown',
      createdAt: now,
      updatedAt: now
    })

    await db.sessions.save({
      id: 'session-2',
      title: 'Deleted session',
      status: 'deleted',
      outputMode: 'html',
      createdAt: now,
      updatedAt: now
    })

    const sessions = await db.sessions.listVisible()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).toBe('session-1')
  })

  it('persists messages, runs, steps and runtime events in insertion order', async () => {
    const db = await createInMemoryPersistence()
    await db.messages.save({
      id: 'message-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'hello',
      contentType: 'plain',
      createdAt: now
    })
    await db.runs.save({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      modelId: 'mock-model',
      retryCount: 0,
      maxRetries: 5
    })
    await db.steps.save({
      id: 'step-1',
      runId: 'run-1',
      type: 'thought',
      status: 'succeeded',
      title: 'Thinking',
      createdAt: now
    })
    await db.events.append({ type: 'run.started', runId: 'run-1' })

    expect(await db.messages.listBySession('session-1')).toHaveLength(1)
    expect(await db.runs.listBySession('session-1')).toHaveLength(1)
    expect(await db.steps.listByRun('run-1')).toHaveLength(1)
    expect(await db.events.listByRun('run-1')).toEqual([{ type: 'run.started', runId: 'run-1' }])
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/persistence test
```

Expected: FAIL because persistence files do not exist.

- [ ] **Step 4: 实现 SQL schema**

Create `hesper-desktop/packages/persistence/src/schema.ts`:

```ts
export const schemaSql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  workspace_path TEXT,
  default_model_id TEXT,
  output_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_run_id TEXT,
  status TEXT NOT NULL,
  model_id TEXT NOT NULL,
  workspace_path TEXT,
  retry_count INTEGER NOT NULL,
  max_retries INTEGER NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
```

- [ ] **Step 5: 实现 repository 接口和 sql.js wrapper**

Create `hesper-desktop/packages/persistence/src/repositories.ts`. It must export `Persistence`, `SessionRepository`, `MessageRepository`, `RunRepository`, `RunStepRepository`, and `RuntimeEventRepository`. Each repository exposes the methods used in tests: `save`, `listVisible`, `listBySession`, `listByRun`, and `append`.

Required implementation behavior:

```ts
export type RuntimeEventRecord = import('@hesper/shared').AgentRuntimeEvent

export type SessionRepository = {
  save(session: import('@hesper/shared').Session): Promise<void>
  get(id: string): Promise<import('@hesper/shared').Session | undefined>
  listVisible(): Promise<import('@hesper/shared').Session[]>
}
```

Create `hesper-desktop/packages/persistence/src/database.ts`. It must:

- call `initSqlJs()`;
- create a `SQL.Database`;
- run `schemaSql`;
- return repository implementations;
- export `createInMemoryPersistence()` for tests;
- export `exportDatabaseBytes()` and `createFilePersistence(path)` for Electron wiring.

Required code shape:

```ts
import initSqlJs from 'sql.js'
import { schemaSql } from './schema'
import { createRepositories, type Persistence } from './repositories'

export async function createInMemoryPersistence(): Promise<Persistence> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(schemaSql)
  return createRepositories(db)
}
```

Create `hesper-desktop/packages/persistence/src/index.ts`:

```ts
export * from './database'
export * from './repositories'
export * from './schema'
```

- [ ] **Step 6: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/persistence test
pnpm --filter @hesper/persistence typecheck
```

Expected: both pass.

- [ ] **Step 7: 提交 persistence**

Run:

```bash
git add hesper-desktop/packages/persistence
git commit -m "feat: add local persistence repositories" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 4: 实现 app-core 会话、设置和 registry services

**Files:**
- Create: `hesper-desktop/packages/app-core/package.json`
- Create: `hesper-desktop/packages/app-core/tsconfig.json`
- Create: `hesper-desktop/packages/app-core/vitest.config.ts`
- Create: `hesper-desktop/packages/app-core/src/session-service.ts`
- Create: `hesper-desktop/packages/app-core/src/settings-service.ts`
- Create: `hesper-desktop/packages/app-core/src/registry-services.ts`
- Create: `hesper-desktop/packages/app-core/src/conversation-service.ts`
- Create: `hesper-desktop/packages/app-core/src/index.ts`
- Create: `hesper-desktop/packages/app-core/src/__tests__/session-service.test.ts`
- Create: `hesper-desktop/packages/app-core/src/__tests__/conversation-service.test.ts`
- Create: `hesper-desktop/packages/app-core/src/__tests__/registry-services.test.ts`

- [ ] **Step 1: 写 package 配置**

Create package config with dependencies:

```json
{
  "name": "@hesper/app-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "@hesper/shared": "workspace:*",
    "@hesper/persistence": "workspace:*"
  }
}
```

Create `hesper-desktop/packages/app-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Create `hesper-desktop/packages/app-core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 2: 写 session service 失败测试**

Create `session-service.test.ts`:

```ts
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { SessionService } from '../session-service'

describe('SessionService', () => {
  it('creates sessions with markdown as default output mode', async () => {
    const persistence = await createInMemoryPersistence()
    const service = new SessionService(persistence)

    const session = await service.createSession({ title: 'New chat' })

    expect(session.title).toBe('New chat')
    expect(session.status).toBe('active')
    expect(session.outputMode).toBe('markdown')
  })

  it('archives and soft deletes sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const service = new SessionService(persistence)
    const session = await service.createSession({ title: 'Temporary' })

    await service.archiveSession(session.id)
    expect((await service.getSession(session.id))?.status).toBe('archived')

    await service.deleteSession(session.id)
    expect((await service.getSession(session.id))?.status).toBe('deleted')
  })
})
```

- [ ] **Step 3: 写 registry services 失败测试**

Create `registry-services.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultRoleService, createDefaultSkillService, ToolCatalogService } from '../registry-services'

describe('registry services', () => {
  it('exposes built-in roles with model and skill fields', () => {
    const roles = createDefaultRoleService().listRoles()
    expect(roles.some((role) => role.canBeMainAgent)).toBe(true)
    expect(roles[0]?.allowedSkillIds).toEqual(expect.any(Array))
  })

  it('exposes skill records for builtin/workspace/project sources', () => {
    const skills = createDefaultSkillService().listSkills()
    expect(skills.map((skill) => skill.source)).toContain('builtin')
  })

  it('groups tools by category', () => {
    const service = new ToolCatalogService([
      { id: 'read-file', name: 'Read File', description: 'Read a file', inputSchema: {}, category: 'filesystem' }
    ])
    expect(service.listByCategory('filesystem')).toHaveLength(1)
  })
})
```

- [ ] **Step 4: 实现 services**

Create `session-service.ts` with these public methods and behavior:

```ts
import type { Persistence } from '@hesper/persistence'
import type { OutputMode, Session } from '@hesper/shared'
import { createId, nowIso } from '@hesper/shared'

export class SessionService {
  constructor(private readonly persistence: Persistence) {}

  async createSession(input: { title?: string; workspacePath?: string; defaultModelId?: string; outputMode?: OutputMode }): Promise<Session> {
    const now = nowIso()
    const session: Session = {
      id: createId('session'),
      title: input.title?.trim() || 'New chat',
      status: 'active',
      workspacePath: input.workspacePath,
      defaultModelId: input.defaultModelId,
      outputMode: input.outputMode ?? 'markdown',
      createdAt: now,
      updatedAt: now
    }
    await this.persistence.sessions.save(session)
    return session
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.persistence.sessions.get(id)
  }

  async listSessions(): Promise<Session[]> {
    return this.persistence.sessions.listVisible()
  }

  async updateTitle(id: string, title: string): Promise<Session> {
    return this.updateSession(id, { title: title.trim() || 'Untitled chat' })
  }

  async setWorkspacePath(id: string, workspacePath: string): Promise<Session> {
    return this.updateSession(id, { workspacePath })
  }

  async setDefaultModel(id: string, defaultModelId: string): Promise<Session> {
    return this.updateSession(id, { defaultModelId })
  }

  async setOutputMode(id: string, outputMode: OutputMode): Promise<Session> {
    return this.updateSession(id, { outputMode })
  }

  async archiveSession(id: string): Promise<Session> {
    return this.updateSession(id, { status: 'archived' })
  }

  async deleteSession(id: string): Promise<Session> {
    return this.updateSession(id, { status: 'deleted' })
  }

  private async updateSession(id: string, patch: Partial<Session>): Promise<Session> {
    const existing = await this.persistence.sessions.get(id)
    if (!existing) throw new Error('Session not found: ' + id)
    const updated: Session = { ...existing, ...patch, updatedAt: nowIso() }
    await this.persistence.sessions.save(updated)
    return updated
  }
}
```

When a session does not exist, throw `new Error('Session not found: ' + id)`.

Create `settings-service.ts`:

```ts
export type ThemeMode = 'light' | 'dark' | 'system'

export type AppSettings = {
  defaultModelId: string
  defaultOutputMode: 'markdown' | 'html'
  themeMode: ThemeMode
}

export class SettingsService {
  private settings: AppSettings = {
    defaultModelId: 'mock/hesper-fast',
    defaultOutputMode: 'markdown',
    themeMode: 'system'
  }

  getSettings(): AppSettings { return this.settings }
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...patch }
    return this.settings
  }
}
```

Create `registry-services.ts` with deterministic built-in roles and skills:

```ts
export function createDefaultRoleService() {
  const roles: import('@hesper/shared').Role[] = [
    {
      id: 'role-general-agent',
      name: '通用 Agent',
      description: '默认主 Agent，适合常规开发和研究任务。',
      defaultModelId: 'mock/hesper-fast',
      allowedSkillIds: ['using-superpowers', 'brainstorming', 'writing-plans'],
      canBeMainAgent: true,
      canBeSubagent: true
    }
  ]
  return { listRoles: () => roles }
}
```

Create `conversation-service.ts` with methods: `createUserMessage`, `createAssistantMessage`, `listMessages`, `listRuns`, `listSteps`, and `appendRuntimeEvent`. It should delegate persistence and create ids/timestamps via `@hesper/shared`.

Create `index.ts` exporting all services.

- [ ] **Step 5: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/app-core test
pnpm --filter @hesper/app-core typecheck
```

Expected: both pass.

- [ ] **Step 6: 提交 app-core**

Run:

```bash
git add hesper-desktop/packages/app-core
git commit -m "feat: add app core services" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 5: 实现内置工具 registry

**Files:**
- Create: `hesper-desktop/packages/tools/package.json`
- Create: `hesper-desktop/packages/tools/tsconfig.json`
- Create: `hesper-desktop/packages/tools/vitest.config.ts`
- Create: `hesper-desktop/packages/tools/src/builtin-tools.ts`
- Create: `hesper-desktop/packages/tools/src/index.ts`
- Create: `hesper-desktop/packages/tools/src/__tests__/builtin-tools.test.ts`

- [ ] **Step 1: 写失败测试**

Create `builtin-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createBuiltinToolDefinitions } from '../builtin-tools'

describe('builtin tools', () => {
  it('contains filesystem, git, web, agent and system categories', () => {
    const tools = createBuiltinToolDefinitions()
    expect(new Set(tools.map((tool) => tool.category))).toEqual(
      new Set(['filesystem', 'git', 'web', 'agent', 'system'])
    )
  })

  it('uses stable ids', () => {
    const ids = createBuiltinToolDefinitions().map((tool) => tool.id)
    expect(ids).toContain('filesystem.read-file')
    expect(ids).toContain('git.status')
    expect(ids).toContain('web.fetch-url')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/tools test
```

Expected: FAIL because tool files do not exist.

- [ ] **Step 3: 实现 tool definitions**

Create `builtin-tools.ts`:

```ts
import type { ToolDefinition } from '@hesper/shared'

export function createBuiltinToolDefinitions(): ToolDefinition[] {
  return [
    {
      id: 'filesystem.read-file',
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
    },
    {
      id: 'filesystem.write-file',
      name: 'Write File',
      description: 'Write a text file in the selected workspace.',
      category: 'filesystem',
      inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } }
    },
    {
      id: 'git.status',
      name: 'Git Status',
      description: 'Read git working tree status.',
      category: 'git',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'web.fetch-url',
      name: 'Fetch URL',
      description: 'Fetch and extract text from a URL.',
      category: 'web',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
    },
    {
      id: 'agent.spawn-subagent',
      name: 'Spawn Subagent',
      description: 'Reserved MVP1 definition for future subagent execution.',
      category: 'agent',
      inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' } } }
    },
    {
      id: 'system.show-notification',
      name: 'Show Notification',
      description: 'Show a desktop notification.',
      category: 'system',
      inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }
    }
  ]
}
```

Create `index.ts`:

```ts
export * from './builtin-tools'
```

- [ ] **Step 4: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/tools test
pnpm --filter @hesper/tools typecheck
```

Expected: both pass.

- [ ] **Step 5: 提交 tools registry**

Run:

```bash
git add hesper-desktop/packages/tools
git commit -m "feat: add builtin tool registry" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 6: 实现 agent-runtime 队列、重试和 pi core adapter

**Files:**
- Create: `hesper-desktop/packages/agent-runtime/package.json`
- Create: `hesper-desktop/packages/agent-runtime/tsconfig.json`
- Create: `hesper-desktop/packages/agent-runtime/vitest.config.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/retry-policy.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/adapters.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/mock-adapter.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/map-pi-event.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/pi-core-adapter.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/runtime.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/index.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/__tests__/retry-policy.test.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/__tests__/runtime-queue.test.ts`
- Create: `hesper-desktop/packages/agent-runtime/src/__tests__/pi-event-mapping.test.ts`

- [ ] **Step 1: 写 package 配置**

Create package config:

```json
{
  "name": "@hesper/agent-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.79.1",
    "@earendil-works/pi-ai": "0.79.1",
    "@hesper/shared": "workspace:*",
    "@hesper/persistence": "workspace:*"
  }
}
```

Create `hesper-desktop/packages/agent-runtime/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Create `hesper-desktop/packages/agent-runtime/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 2: 写 retry policy 测试**

Create `retry-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defaultRetryPolicy, getRetryDelayMs, isRetryableRunError } from '../retry-policy'

describe('retry policy', () => {
  it('allows up to five retry attempts for retryable errors', () => {
    expect(defaultRetryPolicy.maxRetries).toBe(5)
    expect(isRetryableRunError({ code: 'stream_interrupted', message: 'lost', retryable: true })).toBe(true)
    expect(isRetryableRunError({ code: 'tool_error', message: 'bad tool', retryable: false })).toBe(false)
  })

  it('uses exponential backoff', () => {
    expect(getRetryDelayMs(defaultRetryPolicy, 0)).toBe(1500)
    expect(getRetryDelayMs(defaultRetryPolicy, 1)).toBe(2400)
    expect(getRetryDelayMs(defaultRetryPolicy, 2)).toBe(3840)
  })
})
```

- [ ] **Step 3: 写 runtime 队列失败测试**

Create `runtime-queue.test.ts`:

```ts
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { MockAgentAdapter } from '../mock-adapter'
import { AgentRuntime } from '../runtime'

describe('AgentRuntime queue', () => {
  it('runs the first prompt immediately and queues the second prompt', async () => {
    const persistence = await createInMemoryPersistence()
    const adapter = new MockAgentAdapter({ delayMs: 5 })
    const runtime = new AgentRuntime({ persistence, adapter })

    const events: string[] = []
    runtime.subscribe((event) => events.push(event.type))

    const first = await runtime.enqueue({ sessionId: 'session-1', prompt: 'first', modelId: 'mock/hesper-fast' })
    const second = await runtime.enqueue({ sessionId: 'session-1', prompt: 'second', modelId: 'mock/hesper-fast' })

    expect(first.status).toBe('running')
    expect(second.status).toBe('queued')

    await runtime.waitForIdle('session-1')
    expect(events).toContain('run.succeeded')

    const runs = await persistence.runs.listBySession('session-1')
    expect(runs.map((run) => run.status)).toEqual(['succeeded', 'succeeded'])
  })
})
```

- [ ] **Step 4: 写 pi event mapping 测试**

Create `pi-event-mapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapPiEventToHesperEvents } from '../map-pi-event'

describe('pi event mapping', () => {
  it('maps assistant text deltas to message.delta', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
    })

    expect(events).toEqual([{ type: 'message.delta', runId: 'run-1', delta: 'hello' }])
  })

  it('maps tool execution start to a running tool step', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'tool_execution_start',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      args: { path: 'README.md' }
    })

    expect(events[0]?.type).toBe('step.created')
  })
})
```

- [ ] **Step 5: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/agent-runtime test
```

Expected: FAIL because runtime files do not exist.

- [ ] **Step 6: 实现 retry policy**

Create `retry-policy.ts`:

```ts
import type { RunError } from '@hesper/shared'

export type RetryPolicy = {
  maxRetries: number
  initialDelayMs: number
  backoffMultiplier: number
  retryableErrors: RunError['code'][]
}

export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 1500,
  backoffMultiplier: 1.6,
  retryableErrors: ['network_error', 'timeout', 'rate_limit_transient', 'stream_interrupted']
}

export function isRetryableRunError(error: RunError, policy = defaultRetryPolicy): boolean {
  return error.retryable && policy.retryableErrors.includes(error.code)
}

export function getRetryDelayMs(policy: RetryPolicy, retryCount: number): number {
  return Math.round(policy.initialDelayMs * policy.backoffMultiplier ** retryCount)
}
```

- [ ] **Step 7: 实现 adapter interface 和 mock adapter**

Create `adapters.ts`:

```ts
import type { AgentRuntimeEvent, RunError } from '@hesper/shared'

export type AgentPromptInput = {
  runId: string
  sessionId: string
  prompt: string
  modelId: string
  workspacePath?: string
  signal: AbortSignal
}

export type AgentAdapter = {
  run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void>
}

export function normalizeUnknownError(error: unknown): RunError {
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return { code: 'timeout', message: error.message, retryable: true }
  }
  if (error instanceof Error && /network|fetch|socket/i.test(error.message)) {
    return { code: 'network_error', message: error.message, retryable: true }
  }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error), retryable: false }
}
```

Create `mock-adapter.ts`:

```ts
import type { Message } from '@hesper/shared'
import type { AgentAdapter } from './adapters'

export class MockAgentAdapter implements AgentAdapter {
  constructor(private readonly options: { delayMs?: number; failTimes?: number } = {}) {}
  private attempts = 0

  async run(input, emit) {
    this.attempts += 1
    if (this.options.failTimes && this.attempts <= this.options.failTimes) {
      throw new Error('stream interrupted')
    }

    emit({
      type: 'step.created',
      step: {
        id: `step-${input.runId}-thought`,
        runId: input.runId,
        type: 'thought',
        status: 'succeeded',
        title: 'Mock thinking',
        summary: 'Generated deterministic mock response',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      }
    })

    const text = `Mock response for: ${input.prompt}`
    for (const char of text) {
      if (input.signal.aborted) throw new Error('aborted')
      emit({ type: 'message.delta', runId: input.runId, delta: char })
      if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs))
    }

    const message: Message = {
      id: `message-${input.runId}-assistant`,
      sessionId: input.sessionId,
      role: 'assistant',
      content: text,
      contentType: 'markdown',
      runId: input.runId,
      createdAt: new Date().toISOString()
    }
    emit({ type: 'message.completed', message })
  }
}
```

- [ ] **Step 8: 实现 pi core adapter 和 event mapping**

Create `map-pi-event.ts`. It must map pi event names from `@earendil-works/pi-agent-core` README:

- `message_update` with `assistantMessageEvent.type === 'text_delta'` -> `message.delta`
- `tool_execution_start` -> `step.created` with `type: 'tool_call'`, `status: 'running'`
- `tool_execution_end` -> `step.updated` with `type: 'tool_result'`, `status: 'succeeded'` or `failed`
- `turn_start` -> `step.created` with `type: 'model_call'`, `status: 'running'`
- `turn_end` -> `step.updated` for the model call

Create `pi-core-adapter.ts`:

```ts
import { Agent } from '@earendil-works/pi-agent-core'
import { getModel } from '@earendil-works/pi-ai'
import type { AgentAdapter } from './adapters'
import { mapPiEventToHesperEvents } from './map-pi-event'

export class PiCoreAgentAdapter implements AgentAdapter {
  async run(input, emit) {
    const [provider, modelName] = input.modelId.includes('/')
      ? input.modelId.split('/', 2)
      : ['openai', input.modelId]

    const agent = new Agent({
      initialState: {
        systemPrompt: 'You are hesper, a desktop coding assistant. Be concise, stable, and explicit about tool actions.',
        model: getModel(provider, modelName),
        tools: [],
        messages: []
      },
      toolExecution: 'parallel'
    })

    const unsubscribe = agent.subscribe(async (piEvent) => {
      for (const event of mapPiEventToHesperEvents(input.runId, piEvent)) {
        await emit(event)
      }
    })

    input.signal.addEventListener('abort', () => agent.abort(), { once: true })
    try {
      await agent.prompt(input.prompt)
    } finally {
      unsubscribe()
    }
  }
}
```

- [ ] **Step 9: 实现 AgentRuntime**

Create `runtime.ts`. Required behavior:

- `enqueue(input)` creates `AgentRun` and persists it.
- If no running run exists for the session, status becomes `running` and execution starts.
- If a run is already running, status remains `queued`.
- `subscribe(listener)` receives every `AgentRuntimeEvent`.
- `waitForIdle(sessionId)` resolves after current and queued runs finish.
- `run.retrying` is emitted and persisted for retryable errors.
- After max retries, `run.failed` is emitted and persisted.
- On success, `run.succeeded` is emitted and persisted.
- `message.completed` is persisted as assistant message.

Use this public API exactly:

```ts
export type EnqueueRunInput = {
  sessionId: string
  prompt: string
  modelId: string
  workspacePath?: string
  parentRunId?: string
}

export type AgentRuntimeOptions = {
  persistence: import('@hesper/persistence').Persistence
  adapter: import('./adapters').AgentAdapter
  retryPolicy?: import('./retry-policy').RetryPolicy
}

export class AgentRuntime {
  constructor(options: AgentRuntimeOptions)
  subscribe(listener: (event: import('@hesper/shared').AgentRuntimeEvent) => void | Promise<void>): () => void
  enqueue(input: EnqueueRunInput): Promise<import('@hesper/shared').AgentRun>
  waitForIdle(sessionId: string): Promise<void>
}
```

- [ ] **Step 10: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/agent-runtime test
pnpm --filter @hesper/agent-runtime typecheck
```

Expected: both pass.

- [ ] **Step 11: 提交 agent runtime**

Run:

```bash
git add hesper-desktop/packages/agent-runtime
git commit -m "feat: add pi core agent runtime adapter" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 7: 创建 UI package 的主题、布局和会话组件

**Files:**
- Create: `hesper-desktop/packages/ui/package.json`
- Create: `hesper-desktop/packages/ui/tsconfig.json`
- Create: `hesper-desktop/packages/ui/vitest.config.ts`
- Create: `hesper-desktop/packages/ui/src/theme.ts`
- Create: `hesper-desktop/packages/ui/src/layout/AppShell.tsx`
- Create: `hesper-desktop/packages/ui/src/layout/ActivityRail.tsx`
- Create: `hesper-desktop/packages/ui/src/layout/EntityListPane.tsx`
- Create: `hesper-desktop/packages/ui/src/layout/TitleBar.tsx`
- Create: `hesper-desktop/packages/ui/src/conversation/ConversationView.tsx`
- Create: `hesper-desktop/packages/ui/src/conversation/MessageBubble.tsx`
- Create: `hesper-desktop/packages/ui/src/conversation/RunSteps.tsx`
- Create: `hesper-desktop/packages/ui/src/conversation/OutputBlock.tsx`
- Create: `hesper-desktop/packages/ui/src/conversation/FullscreenOutput.tsx`
- Create: `hesper-desktop/packages/ui/src/conversation/Composer.tsx`
- Create: `hesper-desktop/packages/ui/src/conversation/RightNavigation.tsx`
- Create: `hesper-desktop/packages/ui/src/index.ts`
- Create: `hesper-desktop/packages/ui/src/__tests__/components.test.tsx`

- [ ] **Step 1: 写 UI 组件失败测试**

Create `components.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { Composer } from '../conversation/Composer'
import { OutputBlock } from '../conversation/OutputBlock'
import { RunSteps } from '../conversation/RunSteps'

const now = '2026-06-10T03:00:00.000Z'

describe('ui components', () => {
  it('renders high-density desktop shell rails and panes', () => {
    render(<AppShell sessions={[]} activeSection="sessions" title="构建 hesper MVP" />)
    expect(screen.getByText('hesper')).toBeInTheDocument()
    expect(screen.getByText('所有会话')).toBeInTheDocument()
  })

  it('disables send button when composer is empty and enables it with text', async () => {
    const user = userEvent.setup()
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" outputMode="markdown" onSend={() => undefined} />)
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    await user.type(screen.getByPlaceholderText(/输入消息/), 'hello')
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('renders output blocks with expand control', () => {
    render(<OutputBlock content="hello" contentType="markdown" />)
    expect(screen.getByRole('button', { name: '全屏查看输出' })).toBeInTheDocument()
  })

  it('renders run step states', () => {
    render(
      <RunSteps
        steps={[
          { id: 'step-1', runId: 'run-1', type: 'thought', status: 'succeeded', title: 'Thinking', createdAt: now }
        ]}
      />
    )
    expect(screen.getByText('Thinking')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/ui test
```

Expected: FAIL because UI package files do not exist.

- [ ] **Step 3: 实现 package 配置**

Create UI package config with dependencies:

```json
{
  "name": "@hesper/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "@hesper/shared": "workspace:*",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  }
}
```

Set `vitest.config.ts` to `environment: 'jsdom'` and `setupFiles` that imports `@testing-library/jest-dom/vitest`.

- [ ] **Step 4: 实现 theme tokens**

Create `theme.ts`:

```ts
export type ThemeTokens = {
  color: {
    background: string
    surface: string
    surfaceMuted: string
    text: string
    textMuted: string
    border: string
    accent: string
    success: string
    danger: string
    warning: string
  }
  radius: { sm: string; md: string; lg: string; xl: string }
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string }
}

export const lightTheme: ThemeTokens = {
  color: {
    background: '#f2efe8',
    surface: '#fffefb',
    surfaceMuted: '#f7f4ee',
    text: '#22211f',
    textMuted: '#6f6a62',
    border: '#ded7cc',
    accent: '#725cff',
    success: '#199b63',
    danger: '#d44f4b',
    warning: '#ac741b'
  },
  radius: { sm: '8px', md: '12px', lg: '16px', xl: '20px' },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' }
}

export const darkTheme: ThemeTokens = {
  color: {
    background: '#15161a',
    surface: '#202229',
    surfaceMuted: '#1b1d23',
    text: '#eef0f4',
    textMuted: '#a8adba',
    border: '#343843',
    accent: '#9b8cff',
    success: '#43c48c',
    danger: '#ff7b73',
    warning: '#d8a043'
  },
  radius: lightTheme.radius,
  spacing: lightTheme.spacing
}
```

- [ ] **Step 5: 实现组件**

Implement components with these required accessibility labels:

- `Composer` send button: `aria-label="发送"` and `disabled` when trimmed input is empty.
- `OutputBlock` expand button: `aria-label="全屏查看输出"`.
- `AppShell` must render title `hesper`, section label `所有会话`, left rail, list pane and detail area.
- `RunSteps` must render step titles and status icons using text labels: `成功`, `失败`, `思考`, `重试`.

Required `Composer` public props:

```ts
export type ComposerProps = {
  workspacePath?: string
  modelId: string
  outputMode: 'markdown' | 'html'
  onSend: (content: string) => void
}
```

Required `OutputBlock` behavior:

- markdown: render content as pre-wrapped text for MVP1.
- html: render sandboxed iframe using `srcDoc`.
- fixed-height class name: `hesper-output-block`.
- fullscreen state managed internally.

- [ ] **Step 6: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/ui test
pnpm --filter @hesper/ui typecheck
```

Expected: both pass.

- [ ] **Step 7: 提交 UI package**

Run:

```bash
git add hesper-desktop/packages/ui
git commit -m "feat: add high density desktop ui components" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 8: 创建 Electron desktop app、IPC 和 service container

**Files:**
- Create: `hesper-desktop/apps/desktop/package.json`
- Create: `hesper-desktop/apps/desktop/tsconfig.json`
- Create: `hesper-desktop/apps/desktop/vitest.config.ts`
- Create: `hesper-desktop/apps/desktop/electron/main.ts`
- Create: `hesper-desktop/apps/desktop/electron/preload.ts`
- Create: `hesper-desktop/apps/desktop/electron/ipc-handlers.ts`
- Create: `hesper-desktop/apps/desktop/electron/service-container.ts`
- Create: `hesper-desktop/apps/desktop/electron/ipc-contract.ts`
- Create: `hesper-desktop/apps/desktop/tests/ipc-handlers.test.ts`

- [ ] **Step 1: 写 IPC handler 失败测试**

Create `ipc-handlers.test.ts`:

```ts
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { createServiceContainer } from '../electron/service-container'

describe('desktop service container', () => {
  it('creates a session through app-core services', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const session = await container.sessionService.createSession({ title: 'Desktop test' })

    expect(session.title).toBe('Desktop test')
    expect(await container.sessionService.listSessions()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
```

Expected: FAIL because desktop package files do not exist.

- [ ] **Step 3: 写 desktop package 配置**

Create `apps/desktop/package.json`:

```json
{
  "name": "@hesper/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/electron/main.js",
  "scripts": {
    "build": "vite build renderer && tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run",
    "dev": "concurrently -k \"vite --host 127.0.0.1 renderer\" \"tsc -w -p tsconfig.json\" \"wait-on http://127.0.0.1:5173 dist/electron/main.js && electron .\"",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@hesper/agent-runtime": "workspace:*",
    "@hesper/app-core": "workspace:*",
    "@hesper/persistence": "workspace:*",
    "@hesper/shared": "workspace:*",
    "@hesper/tools": "workspace:*",
    "@hesper/ui": "workspace:*",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  }
}
```

Create `tsconfig.json` including both `electron/**/*.ts` and `renderer/src/**/*`.

- [ ] **Step 4: 实现 service container**

Create `service-container.ts`:

```ts
import { AgentRuntime, MockAgentAdapter, PiCoreAgentAdapter } from '@hesper/agent-runtime'
import { SessionService, SettingsService, createDefaultRoleService, createDefaultSkillService, ToolCatalogService } from '@hesper/app-core'
import type { Persistence } from '@hesper/persistence'
import { createBuiltinToolDefinitions } from '@hesper/tools'

export type ServiceContainerOptions = {
  persistence: Persistence
  agentMode: 'mock' | 'pi-core'
}

export function createServiceContainer(options: ServiceContainerOptions) {
  const sessionService = new SessionService(options.persistence)
  const settingsService = new SettingsService()
  const roleService = createDefaultRoleService()
  const skillService = createDefaultSkillService()
  const toolCatalogService = new ToolCatalogService(createBuiltinToolDefinitions())
  const adapter = options.agentMode === 'pi-core' ? new PiCoreAgentAdapter() : new MockAgentAdapter({ delayMs: 0 })
  const agentRuntime = new AgentRuntime({ persistence: options.persistence, adapter })

  return { sessionService, settingsService, roleService, skillService, toolCatalogService, agentRuntime }
}
```

- [ ] **Step 5: 实现 IPC contract 和 handlers**

Create `ipc-contract.ts` with channel names:

```ts
export const ipcChannels = {
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsUpdateTitle: 'sessions:updateTitle',
  sessionsArchive: 'sessions:archive',
  sessionsDelete: 'sessions:delete',
  sessionsSetWorkspace: 'sessions:setWorkspace',
  sessionsSetModel: 'sessions:setModel',
  sessionsSetOutputMode: 'sessions:setOutputMode',
  dialogSelectDirectory: 'dialog:selectDirectory',
  agentEnqueue: 'agent:enqueue',
  agentEventsSubscribe: 'agent:events:subscribe',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update'
} as const
```

Create `ipc-handlers.ts` registering `ipcMain.handle` for each request channel. `agentEventsSubscribe` should forward runtime events through `webContents.send('agent:event', event)`.

- [ ] **Step 6: 实现 main 和 preload**

Create `main.ts`:

- create `BrowserWindow` with `frame: false`;
- use preload script;
- load Vite dev URL when `VITE_DEV_SERVER_URL` exists, otherwise load built `renderer/index.html`;
- initialize file persistence under `app.getPath('userData')/hesper.sqlite`;
- use `HESPER_AGENT_MODE=pi-core` to select real adapter, default mock for local dev.

Create `preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels } from './ipc-contract'

contextBridge.exposeInMainWorld('hesper', {
  sessions: {
    list: () => ipcRenderer.invoke(ipcChannels.sessionsList),
    create: (input: unknown) => ipcRenderer.invoke(ipcChannels.sessionsCreate, input),
    updateTitle: (input: unknown) => ipcRenderer.invoke(ipcChannels.sessionsUpdateTitle, input),
    archive: (id: string) => ipcRenderer.invoke(ipcChannels.sessionsArchive, id),
    delete: (id: string) => ipcRenderer.invoke(ipcChannels.sessionsDelete, id)
  },
  agent: {
    enqueue: (input: unknown) => ipcRenderer.invoke(ipcChannels.agentEnqueue, input),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_: unknown, event: unknown) => listener(event)
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.off('agent:event', handler)
    }
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke(ipcChannels.dialogSelectDirectory)
  }
})
```

- [ ] **Step 7: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
pnpm --filter @hesper/desktop typecheck
```

Expected: both pass.

- [ ] **Step 8: 提交 desktop shell**

Run:

```bash
git add hesper-desktop/apps/desktop
git commit -m "feat: add electron desktop shell and ipc" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 9: 实现 renderer app store 和主界面集成

**Files:**
- Create: `hesper-desktop/apps/desktop/renderer/index.html`
- Create: `hesper-desktop/apps/desktop/renderer/src/main.tsx`
- Create: `hesper-desktop/apps/desktop/renderer/src/App.tsx`
- Create: `hesper-desktop/apps/desktop/renderer/src/app-store.tsx`
- Create: `hesper-desktop/apps/desktop/renderer/src/ipc-client.ts`
- Create: `hesper-desktop/apps/desktop/renderer/src/styles.css`
- Create: `hesper-desktop/apps/desktop/renderer/tests/app-shell.test.tsx`

- [ ] **Step 1: 写 app shell 集成失败测试**

Create `app-shell.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'session-1', title: 'New chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }))
    },
    agent: { enqueue: vi.fn(), onEvent: vi.fn(() => () => undefined) },
    dialog: { selectDirectory: vi.fn() }
  }
}))

describe('renderer App', () => {
  it('renders the high-density shell and empty conversation state', async () => {
    render(<App />)
    expect(await screen.findByText('hesper')).toBeInTheDocument()
    expect(screen.getByText('所有会话')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
```

Expected: FAIL because renderer files do not exist.

- [ ] **Step 3: 实现 ipc-client**

Create `ipc-client.ts` with a typed wrapper around `window.hesper`. Include a fallback mock for component tests:

```ts
export const hesperApi = globalThis.window?.hesper ?? {
  sessions: {
    list: async () => [],
    create: async () => ({ id: 'session-test', title: 'New chat', status: 'active', outputMode: 'markdown', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  },
  agent: { enqueue: async () => undefined, onEvent: () => () => undefined },
  dialog: { selectDirectory: async () => undefined }
}
```

Add `global.d.ts` if TypeScript needs `window.hesper` typing.

- [ ] **Step 4: 实现 app-store**

Create `app-store.tsx` with React context/reducer state:

```ts
export type AppState = {
  sessions: import('@hesper/shared').Session[]
  activeSessionId?: string
  messagesBySession: Record<string, import('@hesper/shared').Message[]>
  stepsByRun: Record<string, import('@hesper/shared').RunStep[]>
  streamingByRun: Record<string, string>
  activeSection: 'sessions' | 'skills' | 'roles' | 'tools' | 'settings'
}
```

Reducer actions must cover: `sessions.loaded`, `session.created`, `session.selected`, `agent.event`, and `section.selected`.

- [ ] **Step 5: 实现 App 和入口**

Create `index.html`, `main.tsx`, and `App.tsx`:

- `main.tsx` renders `<App />` into `#root`.
- `App.tsx` loads sessions on mount.
- When no session exists, it shows a button to create a new session.
- When a session exists, it passes data to `@hesper/ui` `AppShell` and `ConversationView`.

- [ ] **Step 6: 实现高密度全局 CSS**

Create `styles.css` with:

- `body` background from light theme;
- no default margin;
- `.hesper-output-block` max height and overflow;
- titlebar drag region classes;
- dark mode token override via `[data-theme='dark']`.

- [ ] **Step 7: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
pnpm --filter @hesper/desktop typecheck
```

Expected: both pass.

- [ ] **Step 8: 提交 renderer integration**

Run:

```bash
git add hesper-desktop/apps/desktop/renderer hesper-desktop/apps/desktop/package.json hesper-desktop/apps/desktop/tsconfig.json hesper-desktop/apps/desktop/vitest.config.ts
git commit -m "feat: integrate renderer app shell" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 10: 实现会话交互、队列显示、输出全屏和快捷键

**Files:**
- Modify: `hesper-desktop/packages/ui/src/conversation/ConversationView.tsx`
- Modify: `hesper-desktop/packages/ui/src/conversation/Composer.tsx`
- Modify: `hesper-desktop/packages/ui/src/conversation/OutputBlock.tsx`
- Modify: `hesper-desktop/packages/ui/src/conversation/RightNavigation.tsx`
- Modify: `hesper-desktop/apps/desktop/renderer/src/App.tsx`
- Create: `hesper-desktop/apps/desktop/renderer/src/shortcuts.ts`
- Create: `hesper-desktop/apps/desktop/renderer/tests/conversation-view.test.tsx`
- Create: `hesper-desktop/apps/desktop/renderer/tests/shortcuts.test.tsx`

- [ ] **Step 1: 写 conversation 交互测试**

Create `conversation-view.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConversationView } from '@hesper/ui'

const session = { id: 'session-1', title: 'Test', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' } as const

describe('ConversationView', () => {
  it('sends composer content and clears input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ConversationView session={session} messages={[]} steps={[]} streamingText="" modelId="mock/hesper-fast" onSend={onSend} />)

    await user.type(screen.getByPlaceholderText(/输入消息/), 'hello')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(onSend).toHaveBeenCalledWith('hello')
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveValue('')
  })

  it('opens right navigation and fullscreen output', async () => {
    const user = userEvent.setup()
    render(
      <ConversationView
        session={session}
        messages={[{ id: 'm1', sessionId: 'session-1', role: 'assistant', content: 'final answer', contentType: 'markdown', createdAt: '2026-06-10T03:00:00.000Z' }]}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    await user.click(screen.getByRole('button', { name: '打开导航' }))
    expect(screen.getByText('会话导航')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByRole('dialog', { name: '输出全屏查看' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 写快捷键测试**

Create `shortcuts.test.tsx`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createShortcutHandler } from '../src/shortcuts'

describe('shortcuts', () => {
  it('maps ctrl enter to send', () => {
    const send = vi.fn()
    const handler = createShortcutHandler({ send, closePanels: vi.fn(), quickSwitch: vi.fn(), jumpMessage: vi.fn() })
    handler(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('maps escape to close panels', () => {
    const closePanels = vi.fn()
    const handler = createShortcutHandler({ send: vi.fn(), closePanels, quickSwitch: vi.fn(), jumpMessage: vi.fn() })
    handler(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(closePanels).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
```

Expected: FAIL because interactions and shortcuts are not implemented.

- [ ] **Step 4: 实现 ConversationView props 和行为**

`ConversationView` must accept:

```ts
export type ConversationViewProps = {
  session: import('@hesper/shared').Session
  messages: import('@hesper/shared').Message[]
  steps: import('@hesper/shared').RunStep[]
  streamingText: string
  modelId: string
  onSend: (content: string) => void
}
```

Required behavior:

- render title, right navigation button, session document button and output mode chip;
- render user messages on the right;
- render assistant messages with `OutputBlock`;
- render `RunSteps` under the latest user message;
- render streaming text in a temporary output block;
- send input through `Composer`;
- clear composer after send;
- right navigation opens a panel with clickable message/step anchors.

- [ ] **Step 5: 实现 OutputBlock fullscreen**

`OutputBlock` must:

- keep fixed-height scroll container;
- show expand button on hover/focus;
- open a dialog with `role="dialog"` and `aria-label="输出全屏查看"`;
- close on `Esc` or close button;
- render `iframe sandbox="" srcDoc={content}` for html content;
- render markdown as pre-wrapped text for MVP1.

- [ ] **Step 6: 实现快捷键模块**

Create `shortcuts.ts`:

```ts
export type ShortcutActions = {
  send: () => void
  closePanels: () => void
  quickSwitch: () => void
  jumpMessage: (direction: 'previous' | 'next', assistantOnly: boolean) => void
}

export function createShortcutHandler(actions: ShortcutActions) {
  return (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      actions.send()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      actions.closePanels()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      actions.quickSwitch()
      return
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      actions.jumpMessage(event.key === 'ArrowUp' ? 'previous' : 'next', event.shiftKey)
    }
  }
}
```

- [ ] **Step 7: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/ui test
pnpm --filter @hesper/desktop test
pnpm --filter @hesper/desktop typecheck
```

Expected: all pass.

- [ ] **Step 8: 提交会话交互**

Run:

```bash
git add hesper-desktop/packages/ui hesper-desktop/apps/desktop/renderer
git commit -m "feat: add conversation interactions" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 11: 连接 renderer 到 IPC，实现主路径闭环

**Files:**
- Modify: `hesper-desktop/apps/desktop/renderer/src/app-store.tsx`
- Modify: `hesper-desktop/apps/desktop/renderer/src/App.tsx`
- Modify: `hesper-desktop/apps/desktop/renderer/src/ipc-client.ts`
- Modify: `hesper-desktop/apps/desktop/electron/ipc-handlers.ts`
- Create: `hesper-desktop/apps/desktop/renderer/tests/agent-events.test.tsx`

- [ ] **Step 1: 写 agent events 集成测试**

Create `agent-events.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { appReducer, initialAppState } from '../src/app-store'

describe('agent event reducer', () => {
  it('accumulates streaming deltas and final messages', () => {
    const state1 = appReducer(initialAppState, { type: 'agent.event', event: { type: 'message.delta', runId: 'run-1', delta: 'H' } })
    const state2 = appReducer(state1, { type: 'agent.event', event: { type: 'message.delta', runId: 'run-1', delta: 'i' } })
    expect(state2.streamingByRun['run-1']).toBe('Hi')

    const state3 = appReducer(state2, {
      type: 'agent.event',
      event: {
        type: 'message.completed',
        message: { id: 'message-1', sessionId: 'session-1', role: 'assistant', content: 'Hi', contentType: 'markdown', runId: 'run-1', createdAt: '2026-06-10T03:00:00.000Z' }
      }
    })

    expect(state3.messagesBySession['session-1']).toHaveLength(1)
    expect(state3.streamingByRun['run-1']).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
```

Expected: FAIL until reducer handles agent events.

- [ ] **Step 3: 实现 reducer 事件处理**

In `app-store.tsx`, handle:

- `step.created` appends step by run id;
- `step.updated` replaces matching step;
- `message.delta` appends to `streamingByRun[runId]`;
- `message.completed` appends to `messagesBySession[sessionId]` and clears streaming for run;
- `run.failed` creates warning UI state;
- `run.retrying` creates retry status UI state.

- [ ] **Step 4: 实现发送消息主路径**

In `App.tsx`, `onSend(content)` must:

1. create optimistic user message in local state;
2. call `hesperApi.agent.enqueue({ sessionId, prompt: content, modelId, workspacePath })`;
3. rely on runtime events for assistant output;
4. show queued/running status in header chips.

- [ ] **Step 5: 实现 IPC agent enqueue**

In `ipc-handlers.ts`, `agent:enqueue` must call `container.agentRuntime.enqueue`. It must validate input minimally:

```ts
if (!input || typeof input.sessionId !== 'string' || typeof input.prompt !== 'string') {
  throw new Error('Invalid agent enqueue input')
}
```

- [ ] **Step 6: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
pnpm --filter @hesper/desktop typecheck
```

Expected: both pass.

- [ ] **Step 7: 提交主路径闭环**

Run:

```bash
git add hesper-desktop/apps/desktop
git commit -m "feat: connect renderer to agent runtime" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 12: 实现会话工作目录、模型和输出模式设置

**Files:**
- Modify: `hesper-desktop/apps/desktop/electron/ipc-handlers.ts`
- Modify: `hesper-desktop/apps/desktop/electron/preload.ts`
- Modify: `hesper-desktop/apps/desktop/renderer/src/ipc-client.ts`
- Modify: `hesper-desktop/apps/desktop/renderer/src/App.tsx`
- Modify: `hesper-desktop/packages/ui/src/conversation/Composer.tsx`
- Create: `hesper-desktop/apps/desktop/renderer/tests/session-settings.test.tsx`

- [ ] **Step 1: 写 session settings 测试**

Create `session-settings.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from '@hesper/ui'

describe('session controls in composer', () => {
  it('shows workspace, model and output mode controls', async () => {
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" outputMode="markdown" onSend={vi.fn()} />)
    expect(screen.getByText('C:/dev/hesper')).toBeInTheDocument()
    expect(screen.getByText('mock/hesper-fast')).toBeInTheDocument()
    expect(screen.getByText('markdown')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败或缺口**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
```

Expected: FAIL if controls are missing.

- [ ] **Step 3: 实现 IPC 设置接口**

Add handlers:

- `sessions:setWorkspace`
- `sessions:setModel`
- `sessions:setOutputMode`
- `dialog:selectDirectory`

`dialog:selectDirectory` uses Electron `dialog.showOpenDialog({ properties: ['openDirectory'] })` and returns the first selected path or `undefined`.

- [ ] **Step 4: 实现 renderer 设置交互**

In `App.tsx`:

- clicking workspace control opens directory dialog and persists selection;
- model control shows a simple native select with `mock/hesper-fast`, `openai/gpt-4o`, `anthropic/claude-sonnet-4-20250514`;
- output mode control toggles `markdown` / `html`;
- session list updates after each setting change.

- [ ] **Step 5: 运行测试和类型检查**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test
pnpm --filter @hesper/desktop typecheck
```

Expected: both pass.

- [ ] **Step 6: 提交会话设置**

Run:

```bash
git add hesper-desktop/apps/desktop hesper-desktop/packages/ui
git commit -m "feat: add session workspace model and output settings" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 13: 添加 Electron E2E 主路径测试

**Files:**
- Create: `hesper-desktop/apps/desktop/playwright.config.ts`
- Create: `hesper-desktop/apps/desktop/tests/desktop.e2e.spec.ts`
- Modify: `hesper-desktop/apps/desktop/package.json`

- [ ] **Step 1: 写 E2E 测试**

Create `desktop.e2e.spec.ts`:

```ts
import { _electron as electron, expect, test } from '@playwright/test'
import path from 'node:path'

test('creates a session and receives a mock agent response', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, HESPER_AGENT_MODE: 'mock' }
  })

  const page = await app.firstWindow()
  await expect(page.getByText('hesper')).toBeVisible()

  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByPlaceholder(/输入消息/).fill('hello from e2e')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText(/Mock response for: hello from e2e/)).toBeVisible({ timeout: 10000 })

  await app.close()
})
```

- [ ] **Step 2: 写 Playwright 配置**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1
})
```

- [ ] **Step 3: 运行 E2E 确认失败**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop e2e
```

Expected: FAIL until Electron build/dev entry is complete.

- [ ] **Step 4: 修正 Electron 启动路径**

Ensure desktop package `main` points to compiled `dist/electron/main.js`, renderer build outputs to `dist/renderer`, and `main.ts` loads the correct file in production mode.

- [ ] **Step 5: 运行 E2E 通过**

Run:

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop build
pnpm --filter @hesper/desktop e2e
```

Expected: build passes and E2E test passes.

- [ ] **Step 6: 提交 E2E**

Run:

```bash
git add hesper-desktop/apps/desktop
git commit -m "test: add desktop e2e smoke test" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

---

### Task 14: 最终验收、文档和稳定性检查

**Files:**
- Modify: `hesper-desktop/README.md`
- Create: `hesper-desktop/docs/architecture/runtime-events.md`
- Create: `hesper-desktop/docs/decisions/0001-modular-pi-core-runtime.md`

- [ ] **Step 1: 写架构文档**

Create `docs/architecture/runtime-events.md`:

```md
# Runtime Events

hesper renderer subscribes to `AgentRuntimeEvent` instead of waiting for long-running function calls.

Event rules:

- `message.delta` is temporary streaming state.
- `message.completed` is the only event that creates final assistant history.
- `step.created` and `step.updated` drive the visible run step timeline.
- `run.retrying` is visible in the UI and persisted.
- `run.failed` preserves the failed run and enables retry by creating a new run.
```

Create `docs/decisions/0001-modular-pi-core-runtime.md`:

```md
# 0001 Modular pi core runtime

hesper uses `@earendil-works/pi-agent-core` as the Agent runtime foundation.

Electron, app-core and UI do not call pi core directly. They communicate through `@hesper/agent-runtime`, which maps pi events into hesper runtime events and handles queueing, persistence and retry policy.

This keeps MVP1 small while preserving extension points for skills, roles, tools and subagents.
```

- [ ] **Step 2: 更新 README**

Update `hesper-desktop/README.md` with:

````md
## Development

```bash
pnpm install
pnpm check
pnpm dev
pnpm --filter @hesper/desktop e2e
```

## Agent runtime

By default local development uses the deterministic mock adapter. To use pi core:

```bash
HESPER_AGENT_MODE=pi-core pnpm dev
```

The runtime adapter uses `@earendil-works/pi-agent-core` and maps pi stream/tool events into hesper `AgentRuntimeEvent` records.
````

- [ ] **Step 3: 运行完整检查**

Run:

```bash
cd hesper-desktop
pnpm check
pnpm --filter @hesper/desktop build
pnpm --filter @hesper/desktop e2e
```

Expected: all commands pass.

- [ ] **Step 4: 检查 Git 状态**

Run:

```bash
git status --short
```

Expected: only the known untracked `nul` file may remain unless主人已批准删除它. No modified tracked files should remain after committing.

- [ ] **Step 5: 提交验收文档**

Run:

```bash
git add hesper-desktop/README.md hesper-desktop/docs
git commit -m "docs: document runtime architecture" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

Expected: commit succeeds.

## 3. 自审检查

### 规格覆盖

- 桌面壳：Task 8, Task 13。
- 三栏高密度 UI：Task 7, Task 9, Task 10。
- 会话系统：Task 3, Task 4, Task 8, Task 12。
- 单会话 Agent 闭环：Task 6, Task 8, Task 11, Task 13。
- pi core 底层：Task 6 明确使用 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`。
- 队列和中间插话：Task 6, Task 11。
- 重试机制：Task 6。
- 输出块内部滚动和全屏：Task 7, Task 10。
- markdown/html：Task 7, Task 12。
- skills/roles/tools/subagent 扩展口：Task 4, Task 5, Task 6。
- 测试策略：每个任务有单元/集成测试，Task 13 覆盖 Electron E2E。

### 占位扫描

本计划没有保留未定义的实现点。真实 pi core 调用通过 `PiCoreAgentAdapter` 接入，E2E 使用 deterministic mock adapter 保证无 API key 也能稳定测试。

### 类型一致性

- `Session`, `Message`, `AgentRun`, `RunStep`, `AgentRuntimeEvent` 都从 `@hesper/shared` 导出。
- `Persistence` 从 `@hesper/persistence` 导出。
- `SessionService`, `SettingsService`, registry services 从 `@hesper/app-core` 导出。
- `AgentRuntime`, `MockAgentAdapter`, `PiCoreAgentAdapter` 从 `@hesper/agent-runtime` 导出。
- UI components 从 `@hesper/ui` 导出。
