# Worker Agent Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Worker Agent tools so the main Agent can spawn, inspect, wait for, cancel, and visually inspect truly parallel Worker Agent child runs.

**Architecture:** Add a dedicated `WorkerAgentService` in `@hesper/agent-runtime`, exposed through injected `workerAgentTools` handlers in `@hesper/tools`. Child runs are independent adapter executions with their own persisted run, steps, messages, invocation state, bounded waits, diagnosis snapshots, and a Worker Agent full-screen viewer opened from the parent `agent.spawn-worker-agent` tool step.

**Tech Stack:** TypeScript 6, pnpm workspace, Vitest, React 19, Electron IPC, sql.js persistence, `@earendil-works/pi-agent-core` via existing `AgentAdapter`.

---

## File Structure

### Shared model and schemas

- Modify: `packages/shared/src/domain.ts`
  - Add Worker invocation metadata fields used by UI and diagnosis.
- Modify: `packages/shared/src/events.ts`
  - Add `worker.invocation.created` and `worker.invocation.updated` runtime events.
- Modify: `packages/shared/src/schemas.ts`
  - Keep Zod schemas aligned with domain/event types.
- Modify: `packages/shared/src/__tests__/schemas.test.ts`
  - Cover invocation metadata and worker invocation runtime events.

### Persistence

- Modify: `packages/persistence/src/schema.ts`
  - Add migration columns for Worker invocation metadata.
- Modify: `packages/persistence/src/repositories.ts`
  - Round-trip new invocation fields.
  - Add `messages.listByRun(runId)`.
  - Keep `messages.listBySession(sessionId)` root-run-only so Worker output does not pollute the main chat history.
  - Persist and parse worker invocation events.
- Modify: `packages/persistence/src/__tests__/repositories.test.ts`
  - Cover metadata round-trip, root message filtering, child message lookup, and worker event persistence.

### Tools and pi bridge

- Modify: `packages/tools/src/tool-runner.ts`
  - Add optional `toolCallId` and `parentStepId` to `ToolExecutionContext`.
- Modify: `packages/tools/src/builtin-tools.ts`
  - Add five Worker Agent tool definitions.
- Modify: `packages/tools/src/builtin-executor.ts`
  - Replace legacy `workerAgentNotImplemented` path with injected `workerAgentTools` handlers.
- Modify: `packages/tools/src/__tests__/builtin-tools.test.ts`
  - Update tool count and schema assertions.
- Modify: `packages/tools/src/__tests__/builtin-executor.test.ts`
  - Cover handler delegation and missing handler errors.
- Modify: `packages/agent-runtime/src/pi-tools.ts`
  - Pass `toolCallId` and deterministic `parentStepId` into tool execution context.
- Modify: `packages/agent-runtime/src/__tests__/pi-tools.test.ts`
  - Cover context linkage.

### Worker runtime service

- Create: `packages/agent-runtime/src/worker-agent-diagnosis.ts`
  - Pure diagnosis helper for active/quiet/possibly-stalled snapshots.
- Create: `packages/agent-runtime/src/worker-agent-service.ts`
  - Spawn/list/get/wait/cancel service with parallel active registry.
- Modify: `packages/agent-runtime/src/index.ts`
  - Export Worker Agent service APIs.
- Create: `packages/agent-runtime/src/__tests__/worker-agent-service.test.ts`
  - Cover parallel execution, bounded wait, cancel, scope checks, role/tool/depth/count limits, and result lookup.

### App core and Electron wiring

- Modify: `packages/app-core/src/registry-services.ts`
  - Add Worker tools to main Agent defaults; keep Worker role defaults without Worker management tools.
- Modify: `packages/app-core/src/prompt-assembly-service.ts`
  - Update Worker rules for finite wait, `wait:false` parallel pattern, and no recursive Worker spawning.
- Modify: `packages/app-core/src/conversation-service.ts`
  - Add `listMessagesByRun(runId)`.
- Modify tests:
  - `packages/app-core/src/__tests__/registry-services.test.ts`
  - `packages/app-core/src/__tests__/prompt-assembly-service.test.ts`
  - `packages/app-core/src/__tests__/conversation-service.test.ts`
- Modify: `apps/desktop/electron/ipc-contract.ts`
  - Add IPC schemas/types/channels for Worker viewer history loading.
- Modify: `apps/desktop/electron/ipc-handlers.ts`
  - Subscribe to both main runtime and Worker service events.
  - Add Worker invocation/messages lookup handlers.
- Modify: `apps/desktop/electron/preload.ts`
  - Expose Worker viewer read APIs.
- Modify: `apps/desktop/electron/service-container.ts`
  - Create `WorkerAgentService` and inject handlers into `createBuiltinToolExecutor`.
- Modify: `apps/desktop/tests/ipc-handlers.test.ts`
  - Cover handler injection, prompt defaults, worker event forwarding, and child message isolation.

### Renderer and UI

- Modify: `apps/desktop/renderer/src/app-store.tsx`
  - Track Worker invocations and child messages separately from main session messages.
- Modify: `apps/desktop/renderer/src/App.tsx`
  - Load Worker invocation history for visible runs and pass Worker viewer state to conversation UI.
- Modify: `apps/desktop/renderer/src/ipc-client.ts`
  - Add fallback Worker viewer APIs.
- Create: `packages/ui/src/conversation/WorkerAgentRunViewer.tsx`
  - Full-screen Worker Agent child run viewer.
- Modify: `packages/ui/src/conversation/RunSteps.tsx`
  - Render Worker viewer for parent spawn step when invocation metadata exists.
- Modify: `packages/ui/src/conversation/ConversationView.tsx`
  - Pass Worker viewer data down to `RunSteps`.
- Modify: `packages/ui/src/index.ts`
  - Export `WorkerAgentRunViewer` if useful for tests or app wiring.
- Modify: `packages/ui/src/__tests__/components.test.tsx`
  - Cover Worker viewer rendering and child message isolation.

---

## Task 1: Shared Worker invocation metadata and runtime events

**Files:**
- Modify: `packages/shared/src/domain.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/schemas.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Append these tests to `packages/shared/src/__tests__/schemas.test.ts` inside `describe('shared schemas', ...)`:

```ts
  it('validates Worker Agent invocation UI and diagnosis metadata', () => {
    const parsed = workerAgentInvocationSchema.parse({
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      parentStepId: 'step-run-parent-tool-tool-1',
      parentToolCallId: 'tool-1',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      modelRef: { providerId: 'provider-deepseek', modelId: 'deepseek-chat' },
      expectedOutput: 'Findings with evidence.',
      contextSummary: 'The parent run is validating a refactor.',
      status: 'running',
      lastEventAt: now,
      createdAt: now
    })

    expect(parsed.parentStepId).toBe('step-run-parent-tool-tool-1')
    expect(parsed.parentToolCallId).toBe('tool-1')
    expect(parsed.contextSummary).toBe('The parent run is validating a refactor.')
    expect(parsed.lastEventAt).toBe(now)
  })

  it('parses Worker Agent invocation runtime events', () => {
    const invocation = workerAgentInvocationSchema.parse({
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      parentStepId: 'step-run-parent-tool-tool-1',
      parentToolCallId: 'tool-1',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      status: 'running',
      createdAt: now,
      lastEventAt: now
    })

    expect(agentRuntimeEventSchema.parse({
      type: 'worker.invocation.created',
      invocation
    })).toMatchObject({ type: 'worker.invocation.created', invocation: { id: 'worker-agent-1' } })

    expect(agentRuntimeEventSchema.parse({
      type: 'worker.invocation.updated',
      invocation: { ...invocation, status: 'succeeded', completedAt: now }
    })).toMatchObject({ type: 'worker.invocation.updated', invocation: { status: 'succeeded' } })
  })
```

- [ ] **Step 2: Run shared schema tests and verify they fail**

Run:

```bash
pnpm --filter @hesper/shared test -- src/__tests__/schemas.test.ts
```

Expected: FAIL because `parentStepId`, `parentToolCallId`, `contextSummary`, `lastEventAt`, and worker invocation events are not yet accepted by the schemas/types.

- [ ] **Step 3: Extend shared domain types**

In `packages/shared/src/domain.ts`, replace the `WorkerAgentInvocation` type with this shape while preserving existing fields:

```ts
export type WorkerAgentInvocation = {
  id: string
  parentRunId: string
  childRunId?: string
  parentStepId?: string
  parentToolCallId?: string
  task: string
  roleId: string
  allowedToolIds: string[]
  modelRef?: ModelRef
  expectedOutput?: string
  contextSummary?: string
  status: WorkerAgentInvocationStatus
  lastEventAt?: string
  createdAt: string
  completedAt?: string
  error?: RunError
}
```

In `packages/shared/src/events.ts`, extend the union:

```ts
import type { AgentRun, Message, RunError, RunStep, WorkerAgentInvocation } from './domain'

export type AgentRuntimeEvent =
  | { type: 'run.created'; run: AgentRun }
  | { type: 'run.started'; runId: string; startedAt?: string }
  | { type: 'step.created'; step: RunStep }
  | { type: 'step.updated'; step: RunStep }
  | { type: 'message.delta'; runId: string; delta: string }
  | { type: 'message.completed'; message: Message }
  | { type: 'run.retrying'; runId: string; retryCount: number; nextRetryAt: string }
  | { type: 'run.failed'; runId: string; error: RunError; endedAt?: string }
  | { type: 'run.succeeded'; runId: string; endedAt?: string }
  | { type: 'run.cancelled'; runId: string; endedAt?: string }
  | { type: 'worker.invocation.created'; invocation: WorkerAgentInvocation }
  | { type: 'worker.invocation.updated'; invocation: WorkerAgentInvocation }
```

- [ ] **Step 4: Extend shared Zod schemas**

In `packages/shared/src/schemas.ts`, add optional fields to `workerAgentInvocationBaseSchema`:

```ts
  parentStepId: z.string().min(1).optional(),
  parentToolCallId: z.string().min(1).optional(),
  contextSummary: z.string().optional(),
  lastEventAt: z.string().datetime().optional(),
```

Add event schemas before `agentRuntimeEventSchema`:

```ts
const workerInvocationCreatedEventSchema = z.object({
  type: z.literal('worker.invocation.created'),
  invocation: workerAgentInvocationSchema
})

const workerInvocationUpdatedEventSchema = z.object({
  type: z.literal('worker.invocation.updated'),
  invocation: workerAgentInvocationSchema
})
```

Add both schemas to the `z.union([...])` list after `runCancelledEventSchema`.

- [ ] **Step 5: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @hesper/shared test -- src/__tests__/schemas.test.ts
pnpm --filter @hesper/shared typecheck
```

Expected: PASS for both commands.

- [ ] **Step 6: Commit shared model changes**

```bash
git add packages/shared/src/domain.ts packages/shared/src/events.ts packages/shared/src/schemas.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "feat: model worker agent invocation events"
```

---

## Task 2: Persistence support for Worker metadata and child messages

**Files:**
- Modify: `packages/persistence/src/schema.ts`
- Modify: `packages/persistence/src/repositories.ts`
- Test: `packages/persistence/src/__tests__/repositories.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Append focused coverage to `packages/persistence/src/__tests__/repositories.test.ts`:

```ts
  it('round-trips Worker Agent invocation metadata and child messages without polluting root messages', async () => {
    const db = await createInMemoryPersistence()
    const now = '2026-06-20T05:30:00.000Z'

    await db.sessions.save({
      id: 'session-worker-ui',
      title: 'Worker UI',
      status: 'active',
      outputMode: 'markdown',
      createdAt: now,
      updatedAt: now
    })

    await db.runs.save({
      id: 'run-parent',
      sessionId: 'session-worker-ui',
      status: 'running',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 0
    })

    await db.workerAgentInvocations.save({
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      parentStepId: 'step-run-parent-tool-tool-1',
      parentToolCallId: 'tool-1',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      expectedOutput: 'PASS or NEEDS_CHANGES.',
      contextSummary: 'Parent run is preparing a release.',
      status: 'running',
      lastEventAt: now,
      createdAt: now
    })

    await db.runs.save({
      id: 'run-child',
      sessionId: 'session-worker-ui',
      parentRunId: 'run-parent',
      workerAgentInvocationId: 'worker-agent-1',
      depth: 1,
      status: 'succeeded',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 0,
      startedAt: now,
      endedAt: now
    })

    await db.messages.save({
      id: 'message-root',
      sessionId: 'session-worker-ui',
      role: 'assistant',
      content: 'Main answer',
      contentType: 'markdown',
      runId: 'run-parent',
      createdAt: now
    })
    await db.messages.save({
      id: 'message-child',
      sessionId: 'session-worker-ui',
      role: 'assistant',
      content: 'Worker result',
      contentType: 'markdown',
      runId: 'run-child',
      createdAt: now
    })

    await expect(db.workerAgentInvocations.get('worker-agent-1')).resolves.toMatchObject({
      parentStepId: 'step-run-parent-tool-tool-1',
      parentToolCallId: 'tool-1',
      contextSummary: 'Parent run is preparing a release.',
      lastEventAt: now
    })
    await expect(db.messages.listBySession('session-worker-ui')).resolves.toEqual([
      expect.objectContaining({ id: 'message-root' })
    ])
    await expect(db.messages.listByRun('run-child')).resolves.toEqual([
      expect.objectContaining({ id: 'message-child', content: 'Worker result' })
    ])
  })

  it('persists Worker Agent invocation runtime events under the child run when available', async () => {
    const db = await createInMemoryPersistence()
    const now = '2026-06-20T05:31:00.000Z'
    const invocation = {
      id: 'worker-agent-1',
      parentRunId: 'run-parent',
      childRunId: 'run-child',
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      status: 'running' as const,
      createdAt: now,
      lastEventAt: now
    }

    await db.events.append({ type: 'worker.invocation.created', invocation })

    await expect(db.events.listByRun('run-child')).resolves.toEqual([
      expect.objectContaining({ type: 'worker.invocation.created' })
    ])
  })
```

- [ ] **Step 2: Run persistence tests and verify they fail**

Run:

```bash
pnpm --filter @hesper/persistence test -- src/__tests__/repositories.test.ts
```

Expected: FAIL because the repository does not yet store new invocation columns, `messages.listByRun` does not exist, and worker invocation events are not handled by `extractRunId`.

- [ ] **Step 3: Add schema migration columns**

In `packages/persistence/src/schema.ts`, extend `migrationColumns`:

```ts
  worker_agent_invocations: [
    'parent_step_id TEXT',
    'parent_tool_call_id TEXT',
    'context_summary TEXT',
    'last_event_at TEXT'
  ],
```

Also add the same columns to the `CREATE TABLE IF NOT EXISTS worker_agent_invocations` statement.

- [ ] **Step 4: Update repository interfaces and row mapping**

In `packages/persistence/src/repositories.ts`, change `MessageRepository`:

```ts
export type MessageRepository = {
  save(message: Message): Promise<void>
  listBySession(sessionId: string): Promise<Message[]>
  listByRun(runId: string): Promise<Message[]>
}
```

In `toWorkerAgentInvocation`, include:

```ts
    parentStepId: row.parent_step_id ?? undefined,
    parentToolCallId: row.parent_tool_call_id ?? undefined,
    contextSummary: row.context_summary ?? undefined,
    lastEventAt: row.last_event_at ?? undefined,
```

- [ ] **Step 5: Update message queries and invocation save**

Replace `messages.listBySession` with a root-run-only query:

```ts
      async listBySession(sessionId) {
        return fetchAll(
          `SELECT messages.* FROM messages
           LEFT JOIN agent_runs ON messages.run_id = agent_runs.id
           WHERE messages.session_id = ?
             AND (messages.run_id IS NULL OR agent_runs.parent_run_id IS NULL)
           ORDER BY messages.sort_seq ASC, messages.id ASC`,
          [sessionId]
        ).map(toMessage)
      },
      async listByRun(runId) {
        return fetchAll('SELECT * FROM messages WHERE run_id = ? ORDER BY sort_seq ASC, id ASC', [runId]).map(toMessage)
      }
```

Update `workerAgentInvocations.save` column/value arrays to include:

```ts
'parent_step_id', 'parent_tool_call_id', 'context_summary', 'last_event_at'
```

with values:

```ts
invocation.parentStepId,
invocation.parentToolCallId,
invocation.contextSummary,
invocation.lastEventAt,
```

- [ ] **Step 6: Persist worker invocation events**

In `extractRunId`, add:

```ts
    case 'worker.invocation.created':
    case 'worker.invocation.updated':
      return event.invocation.childRunId ?? event.invocation.parentRunId
```

- [ ] **Step 7: Run persistence tests**

Run:

```bash
pnpm --filter @hesper/persistence test -- src/__tests__/repositories.test.ts
pnpm --filter @hesper/persistence typecheck
```

Expected: PASS for both commands.

- [ ] **Step 8: Commit persistence changes**

```bash
git add packages/persistence/src/schema.ts packages/persistence/src/repositories.ts packages/persistence/src/__tests__/repositories.test.ts
git commit -m "feat: persist worker agent metadata"
```

---

## Task 3: Worker Agent tool definitions, executor delegation, and parent step linkage

**Files:**
- Modify: `packages/tools/src/tool-runner.ts`
- Modify: `packages/tools/src/builtin-tools.ts`
- Modify: `packages/tools/src/builtin-executor.ts`
- Modify: `packages/tools/src/__tests__/builtin-tools.test.ts`
- Modify: `packages/tools/src/__tests__/builtin-executor.test.ts`
- Modify: `packages/agent-runtime/src/pi-tools.ts`
- Modify: `packages/agent-runtime/src/__tests__/pi-tools.test.ts`

- [ ] **Step 1: Write failing builtin tool definition tests**

Update `packages/tools/src/__tests__/builtin-tools.test.ts`:

```ts
  it('contains the builtin tool set including Worker Agent management tools', () => {
    const tools = createBuiltinToolDefinitions()
    expect(tools).toHaveLength(23)
    expect(tools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
      'agent.spawn-worker-agent',
      'agent.list-worker-agents',
      'agent.get-worker-agent',
      'agent.wait-worker-agent',
      'agent.cancel-worker-agent'
    ]))
    expect(tools.every((tool) => typeof tool.icon === 'string' && tool.icon.length > 0)).toBe(true)
  })

  it('defines Worker Agent tool schemas', () => {
    const tools = createBuiltinToolDefinitions()

    expect(tools.find((tool) => tool.id === 'agent.spawn-worker-agent')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['task', 'roleId', 'allowedToolIds'],
        properties: expect.objectContaining({
          task: expect.objectContaining({ type: 'string' }),
          roleId: expect.objectContaining({ type: 'string' }),
          allowedToolIds: expect.objectContaining({ type: 'array' }),
          wait: expect.objectContaining({ type: 'boolean' }),
          timeoutMs: expect.objectContaining({ type: 'number' }),
          cancelOnTimeout: expect.objectContaining({ type: 'boolean' })
        })
      }
    })

    expect(tools.find((tool) => tool.id === 'agent.wait-worker-agent')).toMatchObject({
      inputSchema: { type: 'object', required: ['invocationId'] }
    })
    expect(tools.find((tool) => tool.id === 'agent.cancel-worker-agent')).toMatchObject({
      inputSchema: { type: 'object', required: ['invocationId'] }
    })
  })
```

Remove old assertions that `agent.spawn-worker-agent` is absent.

- [ ] **Step 2: Write failing executor delegation tests**

In `packages/tools/src/__tests__/builtin-executor.test.ts`, replace the old not-implemented test with:

```ts
  it('delegates Worker Agent tools to injected handlers with execution context', async () => {
    const spawn = vi.fn(async () => ({ invocationId: 'worker-agent-1', childRunId: 'run-child', status: 'running' }))
    const executor = createBuiltinToolExecutor({
      workerAgentTools: {
        spawn,
        list: vi.fn(),
        get: vi.fn(),
        wait: vi.fn(),
        cancel: vi.fn()
      }
    })
    const context = {
      runId: 'run-parent',
      sessionId: 'session-1',
      allowedToolIds: ['agent.spawn-worker-agent'],
      toolCallId: 'tool-1',
      parentStepId: 'step-run-parent-tool-tool-1'
    }

    const result = await executor.execute(tool('agent.spawn-worker-agent'), {
      task: 'review',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      wait: false
    }, context)

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ task: 'review', wait: false }), context)
    expect(result).toMatchObject({
      content: expect.stringContaining('worker-agent-1'),
      details: { toolId: 'agent.spawn-worker-agent', workerAgent: expect.objectContaining({ invocationId: 'worker-agent-1' }) }
    })
  })

  it('returns a controlled error when Worker Agent handlers are unavailable', async () => {
    const executor = createBuiltinToolExecutor()

    const result = await executor.execute(tool('agent.get-worker-agent'), { invocationId: 'worker-agent-1' }, {
      runId: 'run-parent',
      sessionId: 'session-1',
      allowedToolIds: ['agent.get-worker-agent']
    })

    expect(result).toEqual({
      content: 'Worker Agent tools are not available in this runtime.',
      details: { code: 'not_available', toolId: 'agent.get-worker-agent' },
      isError: true
    })
  })
```

- [ ] **Step 3: Run tool tests and verify they fail**

Run:

```bash
pnpm --filter @hesper/tools test -- src/__tests__/builtin-tools.test.ts src/__tests__/builtin-executor.test.ts
```

Expected: FAIL because Worker tools and handler delegation are not implemented.

- [ ] **Step 4: Add ToolExecutionContext linkage fields**

In `packages/tools/src/tool-runner.ts`, extend `ToolExecutionContext`:

```ts
  toolCallId?: string
  parentStepId?: string
```

- [ ] **Step 5: Add Worker Agent tool definitions**

In `packages/tools/src/builtin-tools.ts`, insert the five definitions in the `agent` category after role tools. Use these IDs and required fields:

```ts
    {
      id: 'agent.spawn-worker-agent',
      name: 'Spawn Worker Agent',
      description: 'Create a constrained Worker Agent child run with a role, task, and limited tool set. By default waits only for a bounded timeout and returns a diagnosis if still running.',
      category: 'agent',
      icon: '🧑‍💻',
      inputSchema: {
        type: 'object',
        required: ['task', 'roleId', 'allowedToolIds'],
        properties: {
          task: { type: 'string', description: 'Specific task for the Worker Agent.' },
          roleId: { type: 'string', description: 'Assignable Worker Agent role id.' },
          allowedToolIds: { type: 'array', items: { type: 'string' }, description: 'Requested tool ids. Effective tools are intersected with parent, role, and global limits.' },
          expectedOutput: { type: 'string', description: 'Expected result format.' },
          contextSummary: { type: 'string', description: 'Relevant context from the parent run.' },
          wait: { type: 'boolean', description: 'When true, wait for a bounded timeout. Defaults to true.' },
          timeoutMs: { type: 'number', description: 'Maximum wait duration in milliseconds. Defaults to 60000 and is capped at 300000.' },
          cancelOnTimeout: { type: 'boolean', description: 'Cancel the Worker Agent if the bounded wait times out. Defaults to false.' }
        }
      }
    },
    {
      id: 'agent.list-worker-agents',
      name: 'List Worker Agents',
      description: 'List Worker Agent invocations for the current parent run or another run in the same session.',
      category: 'agent',
      icon: '📋',
      inputSchema: {
        type: 'object',
        properties: {
          parentRunId: { type: 'string', description: 'Parent run id. Defaults to the current run.' },
          status: { type: 'string', description: 'Optional status filter: queued, running, succeeded, failed, or cancelled.' }
        }
      }
    },
    {
      id: 'agent.get-worker-agent',
      name: 'Get Worker Agent',
      description: 'Get a Worker Agent invocation status, diagnosis, and result if available.',
      category: 'agent',
      icon: '🔎',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: { type: 'string', description: 'Worker Agent invocation id.' }
        }
      }
    },
    {
      id: 'agent.wait-worker-agent',
      name: 'Wait Worker Agent',
      description: 'Wait for a Worker Agent to finish for a bounded timeout and return a diagnosis if it is still running.',
      category: 'agent',
      icon: '⏱️',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: { type: 'string', description: 'Worker Agent invocation id.' },
          timeoutMs: { type: 'number', description: 'Maximum wait duration in milliseconds. Defaults to 60000 and is capped at 300000.' },
          cancelOnTimeout: { type: 'boolean', description: 'Cancel if timeout elapses. Defaults to false.' }
        }
      }
    },
    {
      id: 'agent.cancel-worker-agent',
      name: 'Cancel Worker Agent',
      description: 'Cancel a running Worker Agent in the same session.',
      category: 'agent',
      icon: '🛑',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: { type: 'string', description: 'Worker Agent invocation id.' },
          reason: { type: 'string', description: 'Optional cancellation reason.' }
        }
      }
    },
```

- [ ] **Step 6: Implement executor handler delegation**

In `packages/tools/src/builtin-executor.ts`, add:

```ts
type WorkerAgentToolHandlers = {
  spawn(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  list(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  get(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  wait(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  cancel(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
}
```

Add `workerAgentTools?: WorkerAgentToolHandlers` to `BuiltinToolExecutorOptions`.

Add helper:

```ts
function workerAgentToolsUnavailable(tool: ToolDefinition): ToolExecutionResult {
  return {
    content: 'Worker Agent tools are not available in this runtime.',
    details: { code: 'not_available', toolId: tool.id },
    isError: true
  }
}

async function runWorkerAgentTool(
  tool: ToolDefinition,
  args: unknown,
  context: ToolExecutionContext,
  handlers: WorkerAgentToolHandlers | undefined,
  method: keyof WorkerAgentToolHandlers
): Promise<ToolExecutionResult> {
  if (!handlers) return workerAgentToolsUnavailable(tool)
  const input = argsObject(args)
  const result = await handlers[method](input, context)
  const details = { toolId: tool.id, workerAgent: result }
  return { content: jsonContent(result), details }
}
```

Replace the legacy switch branch with:

```ts
        case 'agent.spawn-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'spawn')
        case 'agent.list-worker-agents':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'list')
        case 'agent.get-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'get')
        case 'agent.wait-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'wait')
        case 'agent.cancel-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'cancel')
```

- [ ] **Step 7: Add failing pi-tools context linkage test**

In `packages/agent-runtime/src/__tests__/pi-tools.test.ts`, add:

```ts
  it('passes toolCallId and parentStepId to Hesper tool execution context', async () => {
    const runner = {
      run: vi.fn(async () => ({ content: 'ok' }))
    }
    const [tool] = createPiAgentTools({
      tools: [{ id: 'agent.spawn-worker-agent', name: 'Spawn Worker Agent', description: 'Spawn', category: 'agent', inputSchema: { type: 'object', properties: {} } }],
      runner,
      context: { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: ['agent.spawn-worker-agent'] }
    })

    await tool!.execute('tool-1', { purpose: 'delegate work' }, new AbortController().signal)

    expect(runner.run).toHaveBeenCalledWith(expect.any(Object), {}, expect.objectContaining({
      toolCallId: 'tool-1',
      parentStepId: 'step-run-parent-tool-tool-1'
    }))
  })
```

Run it and verify it fails:

```bash
pnpm --filter @hesper/agent-runtime test -- src/__tests__/pi-tools.test.ts
```

- [ ] **Step 8: Implement pi-tools context linkage**

In `packages/agent-runtime/src/pi-tools.ts`, add:

```ts
function parentStepIdForToolCall(runId: string, toolCallId: string): string {
  return `step-${runId}-tool-${toolCallId}`
}
```

In `execute(toolCallId, params, signal)`, pass:

```ts
        toolCallId,
        parentStepId: parentStepIdForToolCall(input.context.runId, toolCallId),
```

inside the context object sent to `input.runner.run`.

- [ ] **Step 9: Run tools and pi-tools tests**

Run:

```bash
pnpm --filter @hesper/tools test -- src/__tests__/builtin-tools.test.ts src/__tests__/builtin-executor.test.ts
pnpm --filter @hesper/agent-runtime test -- src/__tests__/pi-tools.test.ts
pnpm --filter @hesper/tools typecheck
pnpm --filter @hesper/agent-runtime typecheck
```

Expected: PASS for all commands.

- [ ] **Step 10: Commit tool and linkage changes**

```bash
git add packages/tools/src/tool-runner.ts packages/tools/src/builtin-tools.ts packages/tools/src/builtin-executor.ts packages/tools/src/__tests__/builtin-tools.test.ts packages/tools/src/__tests__/builtin-executor.test.ts packages/agent-runtime/src/pi-tools.ts packages/agent-runtime/src/__tests__/pi-tools.test.ts
git commit -m "feat: expose worker agent tools"
```

---

## Task 4: WorkerAgentService with parallel child runs, bounded wait, diagnosis, and cancellation

**Files:**
- Create: `packages/agent-runtime/src/worker-agent-diagnosis.ts`
- Create: `packages/agent-runtime/src/worker-agent-service.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/src/__tests__/worker-agent-service.test.ts`

- [ ] **Step 1: Write failing diagnosis helper tests**

Create `packages/agent-runtime/src/__tests__/worker-agent-service.test.ts` with this first block:

```ts
import { createInMemoryPersistence } from '@hesper/persistence'
import type { AgentRuntimeEvent, Role, RunStep, Session, ToolDefinition } from '@hesper/shared'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentPromptInput } from '../adapters'
import { diagnoseWorkerAgent } from '../worker-agent-diagnosis'
import { createWorkerAgentService } from '../worker-agent-service'

const now = '2026-06-20T05:40:00.000Z'

it('classifies Worker Agent progress by idle time', () => {
  const activeStep: RunStep = {
    id: 'step-child-tool-1',
    runId: 'run-child',
    type: 'tool_call',
    status: 'running',
    title: '调用 filesystem.search',
    createdAt: '2026-06-20T05:39:00.000Z'
  }

  expect(diagnoseWorkerAgent({ startedAt: '2026-06-20T05:38:00.000Z', lastEventAt: '2026-06-20T05:39:50.000Z', now, activeStep })).toMatchObject({
    progressState: 'active',
    recommendation: 'continue_waiting'
  })
  expect(diagnoseWorkerAgent({ startedAt: '2026-06-20T05:38:00.000Z', lastEventAt: '2026-06-20T05:38:45.000Z', now, activeStep })).toMatchObject({
    progressState: 'quiet',
    recommendation: 'inspect'
  })
  expect(diagnoseWorkerAgent({ startedAt: '2026-06-20T05:35:00.000Z', lastEventAt: '2026-06-20T05:36:00.000Z', now, activeStep })).toMatchObject({
    progressState: 'possibly_stalled',
    recommendation: 'cancel_and_retry'
  })
})
```

Run:

```bash
pnpm --filter @hesper/agent-runtime test -- src/__tests__/worker-agent-service.test.ts
```

Expected: FAIL because the helper and service files do not exist.

- [ ] **Step 2: Implement diagnosis helper**

Create `packages/agent-runtime/src/worker-agent-diagnosis.ts`:

```ts
import type { RunStep, RunStepStatus, RunStepType } from '@hesper/shared'

export type WorkerAgentDiagnosis = {
  progressState: 'active' | 'quiet' | 'possibly_stalled'
  lastEventAt?: string
  runningForMs: number
  idleForMs?: number
  activeStep?: {
    id: string
    type: RunStepType
    title: string
    status: RunStepStatus
    runningForMs?: number
  }
  recommendation: 'continue_waiting' | 'inspect' | 'cancel_and_retry'
}

type DiagnoseInput = {
  startedAt?: string
  lastEventAt?: string
  now?: string
  activeStep?: RunStep
}

function parseMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function diagnoseWorkerAgent(input: DiagnoseInput): WorkerAgentDiagnosis {
  const nowMs = parseMs(input.now, Date.now())
  const startedMs = parseMs(input.startedAt, nowMs)
  const lastEventMs = parseMs(input.lastEventAt, startedMs)
  const runningForMs = Math.max(0, nowMs - startedMs)
  const idleForMs = Math.max(0, nowMs - lastEventMs)
  const progressState = idleForMs < 30_000 ? 'active' : idleForMs < 120_000 ? 'quiet' : 'possibly_stalled'
  const recommendation = progressState === 'active' ? 'continue_waiting' : progressState === 'quiet' ? 'inspect' : 'cancel_and_retry'
  const activeStep = input.activeStep

  return {
    progressState,
    ...(input.lastEventAt ? { lastEventAt: input.lastEventAt } : {}),
    runningForMs,
    idleForMs,
    ...(activeStep ? {
      activeStep: {
        id: activeStep.id,
        type: activeStep.type,
        title: activeStep.title,
        status: activeStep.status,
        runningForMs: Math.max(0, nowMs - parseMs(activeStep.createdAt, nowMs))
      }
    } : {}),
    recommendation
  }
}
```

- [ ] **Step 3: Add service behavior tests**

Continue `worker-agent-service.test.ts` with fake fixtures:

```ts
const session: Session = {
  id: 'session-1',
  title: 'Worker service',
  status: 'active',
  workspacePath: 'C:/workspace',
  outputMode: 'markdown',
  enabledToolIds: ['agent.spawn-worker-agent', 'agent.get-worker-agent', 'agent.wait-worker-agent', 'agent.cancel-worker-agent', 'filesystem.read-file'],
  allowedWorkerAgentRoleIds: ['reviewer'],
  maxWorkerAgentDepth: 1,
  maxWorkerAgentsPerRun: 10,
  createdAt: now,
  updatedAt: now
}

const reviewerRole: Role = {
  id: 'reviewer',
  name: 'Reviewer',
  allowedSkillIds: [],
  defaultToolIds: ['filesystem.read-file'],
  canBeMainAgent: false,
  canBeWorkerAgent: true,
  canBeAssignedToWorkerAgent: true
}

const tools: ToolDefinition[] = [
  { id: 'filesystem.read-file', name: 'Read File', description: 'Read', category: 'filesystem', inputSchema: { type: 'object', properties: {} } },
  { id: 'agent.spawn-worker-agent', name: 'Spawn Worker Agent', description: 'Spawn', category: 'agent', inputSchema: { type: 'object', properties: {} } }
]

class BlockingAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []
  readonly startedRunIds: string[] = []
  private releases = new Map<string, () => void>()

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.startedRunIds.push(input.runId)
    await emit({ type: 'message.delta', runId: input.runId, delta: `started:${input.prompt}` })
    await new Promise<void>((resolve, reject) => {
      this.releases.set(input.runId, resolve)
      input.signal.addEventListener('abort', () => reject(new Error('aborted by test')), { once: true })
    })
    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: `done:${input.prompt}`,
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-20T05:41:00.000Z'
      }
    })
  }

  finish(runId: string): void {
    this.releases.get(runId)?.()
  }
}

async function createHarness(adapter = new BlockingAdapter()) {
  const persistence = await createInMemoryPersistence()
  await persistence.sessions.save(session)
  await persistence.runs.save({ id: 'run-parent', sessionId: session.id, status: 'running', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 0, workspacePath: session.workspacePath, depth: 0 })
  const events: AgentRuntimeEvent[] = []
  const service = createWorkerAgentService({
    persistence,
    adapter,
    promptAssembly: {
      assembleWorkerAgentPrompt: (input) => ({
        systemPrompt: `worker-system:${input.role.id}:${input.task}`,
        toolManifest: 'tools',
        skillManifest: 'skills',
        roleManifest: 'roles',
        workerAgentRules: 'rules'
      })
    },
    roles: { getRole: (id) => id === 'reviewer' ? reviewerRole : undefined, listRoles: () => [reviewerRole] },
    skills: { listSkills: () => [] },
    tools: { list: () => tools, get: (id) => tools.find((tool) => tool.id === id) },
    filterEnabledToolIds: async (ids) => ids.filter((id) => id === 'filesystem.read-file'),
    emit: (event) => { events.push(event) },
    now: () => now
  })
  return { persistence, adapter, service, events }
}
```

Add tests:

```ts
it('spawns wait:false Worker Agents as parallel child runs', async () => {
  const { service, adapter, persistence, events } = await createHarness()

  const first = await service.spawn({ task: 'review A', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds!, workspacePath: 'C:/workspace', toolCallId: 'tool-a', parentStepId: 'step-run-parent-tool-tool-a' })
  const second = await service.spawn({ task: 'review B', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds!, workspacePath: 'C:/workspace', toolCallId: 'tool-b', parentStepId: 'step-run-parent-tool-tool-b' })

  await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(2))
  expect(first.status).toBe('running')
  expect(second.status).toBe('running')
  expect(first.childRunId).not.toBe(second.childRunId)
  expect(await persistence.workerAgentInvocations.listByParentRun('run-parent')).toHaveLength(2)
  expect(events.map((event) => event.type)).toContain('worker.invocation.created')
})

it('returns a bounded wait diagnosis without cancelling by default', async () => {
  const { service, adapter } = await createHarness()
  const spawned = await service.spawn({ task: 'slow review', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds!, workspacePath: 'C:/workspace' })
  await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))

  const waited = await service.wait({ invocationId: spawned.invocationId, timeoutMs: 1 }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds! })

  expect(waited).toMatchObject({ invocationId: spawned.invocationId, status: 'running', timedOut: true, diagnosis: expect.objectContaining({ recommendation: expect.any(String) }) })
})

it('stores Worker result and keeps child output readable by invocation', async () => {
  const { service, adapter } = await createHarness()
  const spawned = await service.spawn({ task: 'finish review', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds!, workspacePath: 'C:/workspace' })
  await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))
  adapter.finish(spawned.childRunId)

  const waited = await service.wait({ invocationId: spawned.invocationId, timeoutMs: 1000 }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds! })

  expect(waited).toMatchObject({ status: 'succeeded', result: { content: 'done:finish review' } })
})

it('cancels a running Worker Agent in the same session', async () => {
  const { service, adapter } = await createHarness()
  const spawned = await service.spawn({ task: 'cancel review', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds!, workspacePath: 'C:/workspace' })
  await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))

  await expect(service.cancel({ invocationId: spawned.invocationId, reason: 'test cancel' }, { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: session.enabledToolIds! })).resolves.toMatchObject({ status: 'cancelled' })
})
```

Run and verify failure:

```bash
pnpm --filter @hesper/agent-runtime test -- src/__tests__/worker-agent-service.test.ts
```

Expected: FAIL because `createWorkerAgentService` does not exist.

- [ ] **Step 4: Implement Worker Agent service public types and constructor**

Create `packages/agent-runtime/src/worker-agent-service.ts` with these exported types and constants:

```ts
import type { Persistence } from '@hesper/persistence'
import { createId, nowIso, type AgentRun, type AgentRuntimeEvent, type Message, type Role, type RunError, type RunStep, type Session, type Skill, type ToolDefinition, type WorkerAgentInvocation } from '@hesper/shared'
import type { ToolExecutionContext } from '@hesper/tools'
import type { AgentAdapter } from './adapters'
import { normalizeUnknownError } from './adapters'
import { diagnoseWorkerAgent, type WorkerAgentDiagnosis } from './worker-agent-diagnosis'

const DEFAULT_WAIT_TIMEOUT_MS = 60_000
const MAX_WAIT_TIMEOUT_MS = 300_000
const WORKER_AGENT_TOOL_IDS = new Set([
  'agent.spawn-worker-agent',
  'agent.list-worker-agents',
  'agent.get-worker-agent',
  'agent.wait-worker-agent',
  'agent.cancel-worker-agent'
])

export type SpawnWorkerAgentInput = {
  task: string
  roleId: string
  allowedToolIds: string[]
  expectedOutput?: string
  contextSummary?: string
  wait?: boolean
  timeoutMs?: number
  cancelOnTimeout?: boolean
}

export type ListWorkerAgentsInput = { parentRunId?: string; status?: WorkerAgentInvocation['status'] }
export type GetWorkerAgentInput = { invocationId: string }
export type WaitWorkerAgentInput = { invocationId: string; timeoutMs?: number; cancelOnTimeout?: boolean }
export type CancelWorkerAgentInput = { invocationId: string; reason?: string }

export type WorkerAgentResult = { messageId: string; content: string }
export type WorkerAgentToolResult = WorkerAgentInvocation & {
  timedOut?: boolean
  diagnosis?: WorkerAgentDiagnosis
  result?: WorkerAgentResult
}

type PromptAssemblyLike = {
  assembleWorkerAgentPrompt(input: {
    session: Pick<Session, 'id' | 'workspacePath' | 'outputMode' | 'enabledSkillIds'>
    role: Role
    skills: Skill[]
    tools: ToolDefinition[]
    task: string
    expectedOutput?: string
    allowedToolIds: string[]
    depth: number
    maxDepth: number
    maxWorkerAgentsPerRun: number
  }): { systemPrompt: string }
}

type RegistryLike<T> = { list(): T[] }
type RoleRegistryLike = RegistryLike<Role> & { getRole(id: string): Role | undefined }
type ToolRegistryLike = RegistryLike<ToolDefinition> & { get(id: string): ToolDefinition | undefined }

type ActiveWorker = {
  invocationId: string
  childRunId: string
  controller: AbortController
  promise: Promise<void>
  startedAt: string
  lastEventAt: string
}

export type WorkerAgentServiceOptions = {
  persistence: Persistence
  adapter: AgentAdapter
  promptAssembly: PromptAssemblyLike
  roles: RoleRegistryLike
  skills: RegistryLike<Skill>
  tools: ToolRegistryLike
  filterEnabledToolIds: (toolIds: string[]) => Promise<string[]>
  emit?: (event: AgentRuntimeEvent) => void | Promise<void>
  now?: () => string
}
```

Then implement `createWorkerAgentService(options)` returning `{ subscribe, spawn, list, get, wait, cancel }`.

- [ ] **Step 5: Implement validation helpers**

Inside `worker-agent-service.ts`, add helpers with these exact behaviors:

```ts
function boundedTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MS
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WAIT_TIMEOUT_MS
  return Math.min(Math.floor(value), MAX_WAIT_TIMEOUT_MS)
}

function ensureString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Worker Agent argument must be a non-empty string: ${key}`)
  return value
}

function ensureStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Worker Agent argument must be an array of non-empty strings: ${key}`)
  }
  return value
}

function parseSpawnInput(input: Record<string, unknown>): SpawnWorkerAgentInput {
  return {
    task: ensureString(input.task, 'task'),
    roleId: ensureString(input.roleId, 'roleId'),
    allowedToolIds: ensureStringArray(input.allowedToolIds, 'allowedToolIds'),
    ...(typeof input.expectedOutput === 'string' ? { expectedOutput: input.expectedOutput } : {}),
    ...(typeof input.contextSummary === 'string' ? { contextSummary: input.contextSummary } : {}),
    ...(typeof input.wait === 'boolean' ? { wait: input.wait } : {}),
    ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
    ...(typeof input.cancelOnTimeout === 'boolean' ? { cancelOnTimeout: input.cancelOnTimeout } : {})
  }
}
```

Use the parse helpers in public methods so executor handlers can pass raw `Record<string, unknown>`.

- [ ] **Step 6: Implement spawn algorithm**

Implement `spawn` with this order:

1. Load parent run from `persistence.runs.get(context.runId)`.
2. Load session from `persistence.sessions.get(context.sessionId)`.
3. Require parent run session to match context session.
4. Count existing invocations from `workerAgentInvocations.listByParentRun(parentRun.id)` and enforce `session.maxWorkerAgentsPerRun ?? 10`.
5. Load role and require worker assignability.
6. Resolve effective tool ids as requested ∩ context.allowedToolIds ∩ role.defaultToolIds ∩ global filter ∩ excluding Worker Agent tool ids.
7. Create invocation and child run with `createId('worker-agent')` and `createId('run')`.
8. Save invocation then child run.
9. Emit `worker.invocation.created` and `run.created`.
10. Start child run Promise without awaiting.
11. If `wait !== false`, call `wait` with bounded timeout; otherwise return running result.

Use this child run shape:

```ts
const childRun: AgentRun = {
  id: childRunId,
  sessionId: session.id,
  parentRunId: parentRun.id,
  workerAgentInvocationId: invocation.id,
  depth,
  status: 'running',
  modelId: role.defaultModelId ?? parentRun.modelId,
  retryCount: 0,
  maxRetries: 0,
  workspacePath: parentRun.workspacePath ?? session.workspacePath,
  startedAt
}
```

- [ ] **Step 7: Implement child run execution**

Child execution should mirror the essential `AgentRuntime` behavior without queueing or retries:

```ts
async function executeChildRun(invocation: WorkerAgentInvocation, childRun: AgentRun, input: SpawnWorkerAgentInput, effectiveAllowedToolIds: string[]): Promise<void> {
  const controller = new AbortController()
  activeWorkers.set(invocation.id, { invocationId: invocation.id, childRunId: childRun.id, controller, promise, startedAt: childRun.startedAt!, lastEventAt: childRun.startedAt! })
  await emitAndPersist({ type: 'run.started', runId: childRun.id, startedAt: childRun.startedAt })
  try {
    await options.adapter.run({
      runId: childRun.id,
      sessionId: childRun.sessionId,
      prompt: input.task,
      modelId: childRun.modelId,
      systemPrompt: prompt.systemPrompt,
      enabledToolIds: effectiveAllowedToolIds,
      workspacePath: childRun.workspacePath,
      historyMessages: [],
      signal: controller.signal
    }, handleChildEvent)
    const finalRun = { ...childRun, status: 'succeeded' as const, endedAt: currentNow() }
    await options.persistence.runs.save(finalRun)
    await updateInvocation({ ...invocation, status: 'succeeded', completedAt: finalRun.endedAt, lastEventAt: finalRun.endedAt })
    await emitAndPersist({ type: 'run.succeeded', runId: childRun.id, endedAt: finalRun.endedAt })
  } catch (error) {
    const normalized = normalizeUnknownError(error)
    const status = controller.signal.aborted ? 'cancelled' as const : 'failed' as const
    const endedAt = currentNow()
    const failedRun = { ...childRun, status, endedAt, ...(status === 'failed' ? { error: normalized } : {}) }
    await options.persistence.runs.save(failedRun)
    await updateInvocation({ ...invocation, status, completedAt: endedAt, lastEventAt: endedAt, ...(status === 'failed' ? { error: normalized } : {}) })
    await emitAndPersist(status === 'cancelled' ? { type: 'run.cancelled', runId: childRun.id, endedAt } : { type: 'run.failed', runId: childRun.id, error: normalized, endedAt })
  } finally {
    activeWorkers.delete(invocation.id)
  }
}
```

When implementing, define `promise` before placing the object in `activeWorkers` by creating the active record immediately before launching the async function. Keep the code type-safe instead of copying the snippet blindly if TypeScript requires reordering.

- [ ] **Step 8: Implement child event handling**

`handleChildEvent(event)` must:

- persist `step.created` and `step.updated` to `persistence.steps.save`
- persist `message.completed` to `persistence.messages.save`
- append every event to `persistence.events.append`
- update invocation `lastEventAt`
- emit events to service subscribers and injected `emit`

Use the same listener failure tolerance as `AgentRuntime`: catch listener errors and `console.error('WorkerAgentService listener failed', error)`.

- [ ] **Step 9: Implement list/get/wait/cancel result shaping**

`get` should load invocation, verify same session through parent run, read child run/messages/steps, attach diagnosis if running, and attach latest assistant child message as:

```ts
result: { messageId: message.id, content: message.content }
```

`wait` should use `Promise.race([active.promise, timeout])`, return `timedOut: true` on timeout, and cancel only when `cancelOnTimeout === true`.

`cancel` should call the active controller abort when present, then persist invocation/run as cancelled if the Worker is already orphaned or inactive.

- [ ] **Step 10: Export service APIs**

In `packages/agent-runtime/src/index.ts`, export:

```ts
export * from './worker-agent-diagnosis'
export * from './worker-agent-service'
```

- [ ] **Step 11: Run Worker service tests**

Run:

```bash
pnpm --filter @hesper/agent-runtime test -- src/__tests__/worker-agent-service.test.ts
pnpm --filter @hesper/agent-runtime typecheck
```

Expected: PASS for both commands.

- [ ] **Step 12: Commit Worker service**

```bash
git add packages/agent-runtime/src/worker-agent-diagnosis.ts packages/agent-runtime/src/worker-agent-service.ts packages/agent-runtime/src/index.ts packages/agent-runtime/src/__tests__/worker-agent-service.test.ts
git commit -m "feat: add worker agent service"
```

---

## Task 5: App-core prompt/defaults and Electron service wiring

**Files:**
- Modify: `packages/app-core/src/registry-services.ts`
- Modify: `packages/app-core/src/prompt-assembly-service.ts`
- Modify: `packages/app-core/src/conversation-service.ts`
- Modify app-core tests listed in File Structure
- Modify: `apps/desktop/electron/ipc-contract.ts`
- Modify: `apps/desktop/electron/ipc-handlers.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/service-container.ts`
- Modify: `apps/desktop/tests/ipc-handlers.test.ts`

- [ ] **Step 1: Write failing app-core tests for defaults and prompt rules**

Update `packages/app-core/src/__tests__/registry-services.test.ts` to expect main role defaults contain Worker tools and Worker role defaults do not:

```ts
    expect(roles.find((role) => role.id === 'main-agent')?.defaultToolIds).toEqual(expect.arrayContaining([
      'agent.spawn-worker-agent',
      'agent.list-worker-agents',
      'agent.get-worker-agent',
      'agent.wait-worker-agent',
      'agent.cancel-worker-agent'
    ]))
    expect(roles.find((role) => role.id === 'worker-agent')?.defaultToolIds).not.toEqual(expect.arrayContaining([
      'agent.spawn-worker-agent',
      'agent.wait-worker-agent'
    ]))
```

Update `packages/app-core/src/__tests__/prompt-assembly-service.test.ts` main prompt expectations:

```ts
    expect(output.workerAgentRules).toContain('All Worker Agent waits are bounded')
    expect(output.workerAgentRules).toContain('Use wait:false when spawning multiple independent Worker Agents')
    expect(output.workerAgentRules).toContain('A wait timeout means the Worker Agent is still running, not failed')
```

- [ ] **Step 2: Write failing conversation service test**

In `packages/app-core/src/__tests__/conversation-service.test.ts`, add:

```ts
  it('lists messages by run for Worker Agent viewer history', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createConversationService(persistence)
    const now = '2026-06-20T06:00:00.000Z'
    await persistence.sessions.save({ id: 'session-1', title: 'Worker history', status: 'active', outputMode: 'markdown', createdAt: now, updatedAt: now })
    await persistence.runs.save({ id: 'run-child', sessionId: 'session-1', parentRunId: 'run-parent', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 0 })
    await persistence.messages.save({ id: 'message-child', sessionId: 'session-1', role: 'assistant', content: 'Worker result', contentType: 'markdown', runId: 'run-child', createdAt: now })

    await expect(service.listMessagesByRun('run-child')).resolves.toEqual([
      expect.objectContaining({ id: 'message-child', content: 'Worker result' })
    ])
  })
```

Run:

```bash
pnpm --filter @hesper/app-core test -- src/__tests__/registry-services.test.ts src/__tests__/prompt-assembly-service.test.ts src/__tests__/conversation-service.test.ts
```

Expected: FAIL because defaults/rules/listMessagesByRun are not updated.

- [ ] **Step 3: Update defaults and prompt rules**

In `packages/app-core/src/registry-services.ts`, add Worker tools to `main-agent.defaultToolIds` after role tools. Do not add them to `worker-agent.defaultToolIds`.

In `packages/app-core/src/prompt-assembly-service.ts`, add these lines to `renderMainWorkerAgentRules` when spawn is available:

```ts
    '- All Worker Agent waits are bounded; never expect agent.wait-worker-agent or spawn wait:true to wait forever.',
    '- Use wait:false when spawning multiple independent Worker Agents, then call wait/get for each invocation id.',
    '- A wait timeout means the Worker Agent is still running, not failed; inspect the diagnosis before cancelling.',
    '- Worker Agent management tools default to the current parent run and must not be used across sessions.'
```

Add this line to `renderWorkerAgentRules`:

```ts
    '- Do not call Worker Agent management tools from a Worker Agent in this version.'
```

- [ ] **Step 4: Add conversation service method**

In `packages/app-core/src/conversation-service.ts`, extend `ConversationService`:

```ts
  listMessagesByRun(runId: string): Promise<Message[]>
```

Implement:

```ts
    async listMessagesByRun(runId) {
      await ensureRunExists(persistence, runId)
      return persistence.messages.listByRun(runId)
    },
```

- [ ] **Step 5: Add Electron IPC contracts for Worker viewer history**

In `apps/desktop/electron/ipc-contract.ts`, import `workerAgentInvocationSchema` from `@hesper/shared`.

Add channels:

```ts
  workerInvocationsListByParentRun: 'workerInvocations:listByParentRun',
  conversationListMessagesByRun: 'conversation:listMessagesByRun',
```

Add schemas:

```ts
export const workerInvocationsResultSchema = z.array(workerAgentInvocationSchema)
export const conversationMessagesByRunResultSchema = z.array(messageSchema)
```

Add API methods:

```ts
  workerAgents: {
    listByParentRun(parentRunId: string): Promise<WorkerAgentInvocationDto[]>
  }
```

and under `conversation`:

```ts
    listMessagesByRun(runId: string): Promise<MessageDto[]>
```

Export `WorkerAgentInvocationDto` from `z.infer<typeof workerAgentInvocationSchema>`.

- [ ] **Step 6: Wire WorkerAgentService in service-container**

In `apps/desktop/electron/service-container.ts`:

1. Import `createWorkerAgentService`.
2. Declare `let workerAgentService: ReturnType<typeof createWorkerAgentService>` before creating `toolRunner`.
3. Pass `workerAgentTools` to `createBuiltinToolExecutor` with lazy closures:

```ts
      workerAgentTools: {
        spawn: (input, context) => workerAgentService.spawn(input, context),
        list: (input, context) => workerAgentService.list(input, context),
        get: (input, context) => workerAgentService.get(input, context),
        wait: (input, context) => workerAgentService.wait(input, context),
        cancel: (input, context) => workerAgentService.cancel(input, context)
      }
```

4. After `toolRunner` exists, create `workerAgentService` with `persistence`, `adapter`, registries, prompt assembly, and `filterEnabledToolIds`.
5. Return `workerAgentService` in the container.

Use lazy closures so `toolRunner` and `workerAgentService` can reference each other without a package cycle.

- [ ] **Step 7: Subscribe and expose IPC handlers**

In `apps/desktop/electron/ipc-handlers.ts`:

- Add a persistence subscription for `container.workerAgentService.subscribe` mirroring `agentRuntime.subscribe`.
- Send Worker service events to renderer subscribers in `subscribeSender`.
- Add handlers:

```ts
    [ipcChannels.workerInvocationsListByParentRun]: async (_event, payload) => {
      const parentRunId = runIdInputSchema.parse(payload)
      return workerInvocationsResultSchema.parse(await options.container.persistence.workerAgentInvocations.listByParentRun(parentRunId))
    },
    [ipcChannels.conversationListMessagesByRun]: async (_event, payload) => {
      const runId = runIdInputSchema.parse(payload)
      return conversationMessagesByRunResultSchema.parse(await options.container.conversationService.listMessagesByRun(runId))
    },
```

In `preload.ts`, expose the two new methods.

- [ ] **Step 8: Update IPC tests**

In `apps/desktop/tests/ipc-handlers.test.ts`:

- Update expected default enabled tools arrays to include five Worker tools.
- Add a test that `container.toolRunner.run(agent.spawn-worker-agent)` delegates to `workerAgentService.spawn` when allowed.
- Add a test that child messages saved under child runs are returned by `conversation:listMessagesByRun` but not by `conversation:listMessages`.

Use this assertion pattern:

```ts
expect(await handles.get(ipcChannels.conversationListMessages)?.({ sender: { id: 1 } }, session.id)).not.toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'message-child' })
]))
expect(await handles.get(ipcChannels.conversationListMessagesByRun)?.({ sender: { id: 1 } }, 'run-child')).toEqual([
  expect.objectContaining({ id: 'message-child' })
])
```

- [ ] **Step 9: Run app-core and desktop tests**

Run:

```bash
pnpm --filter @hesper/app-core test -- src/__tests__/registry-services.test.ts src/__tests__/prompt-assembly-service.test.ts src/__tests__/conversation-service.test.ts
pnpm --filter @hesper/desktop test -- tests/ipc-handlers.test.ts
pnpm --filter @hesper/app-core typecheck
pnpm --filter @hesper/desktop typecheck
```

Expected: PASS for all commands.

- [ ] **Step 10: Commit app wiring changes**

```bash
git add packages/app-core/src/registry-services.ts packages/app-core/src/prompt-assembly-service.ts packages/app-core/src/conversation-service.ts packages/app-core/src/__tests__/registry-services.test.ts packages/app-core/src/__tests__/prompt-assembly-service.test.ts packages/app-core/src/__tests__/conversation-service.test.ts apps/desktop/electron/ipc-contract.ts apps/desktop/electron/ipc-handlers.ts apps/desktop/electron/preload.ts apps/desktop/electron/service-container.ts apps/desktop/tests/ipc-handlers.test.ts
git commit -m "feat: wire worker agent runtime"
```

---

## Task 6: Renderer state isolation and Worker Agent full-screen viewer

**Files:**
- Modify: `apps/desktop/renderer/src/app-store.tsx`
- Modify: `apps/desktop/renderer/src/App.tsx`
- Modify: `apps/desktop/renderer/src/ipc-client.ts`
- Create: `packages/ui/src/conversation/WorkerAgentRunViewer.tsx`
- Modify: `packages/ui/src/conversation/RunSteps.tsx`
- Modify: `packages/ui/src/conversation/ConversationView.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/__tests__/components.test.tsx`

- [ ] **Step 1: Write failing UI test for Worker viewer**

In `packages/ui/src/__tests__/components.test.tsx`, add:

```tsx
  it('opens a Worker Agent run viewer from a spawn Worker tool step', async () => {
    const user = userEvent.setup()
    const parentStep: RunStep = {
      id: 'step-run-parent-tool-tool-1',
      runId: 'run-parent',
      type: 'tool_call',
      status: 'running',
      title: '调用 agent.spawn-worker-agent',
      summary: 'Delegate review work',
      detail: JSON.stringify({ kind: 'tool_call', input: { task: 'Review the staged diff.' } }),
      createdAt: now
    }
    const childStep: RunStep = {
      id: 'step-run-child-tool-read',
      runId: 'run-child',
      type: 'tool_call',
      status: 'running',
      title: '调用 filesystem.read-file',
      summary: 'Read changed file',
      createdAt: now
    }

    render(
      <RunSteps
        steps={[parentStep]}
        workerAgentView={{
          invocationsByParentStepId: {
            [parentStep.id]: {
              id: 'worker-agent-1',
              parentRunId: 'run-parent',
              childRunId: 'run-child',
              parentStepId: parentStep.id,
              task: 'Review the staged diff.',
              roleId: 'reviewer',
              allowedToolIds: ['filesystem.read-file'],
              expectedOutput: 'PASS or NEEDS_CHANGES.',
              contextSummary: 'Review current changes.',
              status: 'running',
              createdAt: now,
              lastEventAt: now
            }
          },
          runsById: { 'run-child': { id: 'run-child', sessionId: 'session-1', parentRunId: 'run-parent', workerAgentInvocationId: 'worker-agent-1', depth: 1, status: 'running', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 0, startedAt: now } },
          stepsByRun: { 'run-child': [childStep] },
          messagesByRun: {},
          streamingByRun: { 'run-child': 'Inspecting files…' }
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: /查看步骤详情/ }))

    expect(screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })).toBeInTheDocument()
    expect(screen.getByText('Review the staged diff.')).toBeInTheDocument()
    expect(screen.getByText('PASS or NEEDS_CHANGES.')).toBeInTheDocument()
    expect(screen.getByText('调用 filesystem.read-file')).toBeInTheDocument()
    expect(screen.getByText('Inspecting files…')).toBeInTheDocument()
  })
```

Run:

```bash
pnpm --filter @hesper/ui test -- src/__tests__/components.test.tsx
```

Expected: FAIL because `RunSteps` has no `workerAgentView` prop and the viewer component does not exist.

- [ ] **Step 2: Implement WorkerAgentRunViewer**

Create `packages/ui/src/conversation/WorkerAgentRunViewer.tsx`:

```tsx
import type { AgentRun, Message, RunStep, WorkerAgentInvocation } from '@hesper/shared'
import { darkTheme } from '../theme'
import { MarkdownOutput } from './MarkdownOutput'
import { MessageBubble } from './MessageBubble'
import { RunSteps } from './RunSteps'

export type WorkerAgentRunViewerProps = {
  invocation: WorkerAgentInvocation
  run?: AgentRun
  steps: RunStep[]
  messages: Message[]
  streamingText?: string
}

function taskContent(invocation: WorkerAgentInvocation): string {
  return [
    `任务：${invocation.task}`,
    invocation.contextSummary ? `\n上下文：${invocation.contextSummary}` : '',
    invocation.expectedOutput ? `\n期望输出：${invocation.expectedOutput}` : '',
    `\n角色：${invocation.roleId}`,
    `\n允许工具：${invocation.allowedToolIds.join(', ') || 'none'}`
  ].join('')
}

export function WorkerAgentRunViewer({ invocation, run, steps, messages, streamingText = '' }: WorkerAgentRunViewerProps) {
  const finalMessage = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
  const status = run?.status ?? invocation.status

  return (
    <section aria-label="Worker Agent 执行详情" style={shellStyle}>
      <div style={taskBubbleStyle}>
        <MessageBubble
          message={{
            id: `worker-task-${invocation.id}`,
            sessionId: run?.sessionId ?? 'worker-agent',
            role: 'user',
            content: taskContent(invocation),
            contentType: 'plain',
            createdAt: invocation.createdAt
          }}
        />
      </div>
      <RunSteps steps={steps} autoExpanded runStartedAt={run?.startedAt} runEndedAt={run?.endedAt ?? invocation.completedAt} />
      <section aria-label="Worker Agent 最终输出" style={outputStyle}>
        <h3 style={headingStyle}>最终输出</h3>
        {finalMessage ? (
          <MarkdownOutput content={finalMessage.content} />
        ) : streamingText.trim() ? (
          <MarkdownOutput content={streamingText} />
        ) : status === 'failed' ? (
          <p style={mutedStyle}>Worker Agent 运行失败。</p>
        ) : status === 'cancelled' ? (
          <p style={mutedStyle}>Worker Agent 已取消。</p>
        ) : (
          <p style={mutedStyle}>Worker Agent 正在执行…</p>
        )}
      </section>
    </section>
  )
}

const shellStyle = { display: 'grid', gap: darkTheme.spacing.lg } satisfies React.CSSProperties
const taskBubbleStyle = { maxWidth: 760, marginLeft: 'auto' } satisfies React.CSSProperties
const outputStyle = { borderTop: `1px solid ${darkTheme.color.border}`, paddingTop: darkTheme.spacing.md } satisfies React.CSSProperties
const headingStyle = { margin: 0, marginBottom: darkTheme.spacing.sm, fontSize: 13, color: darkTheme.color.textMuted } satisfies React.CSSProperties
const mutedStyle = { margin: 0, color: darkTheme.color.textMuted } satisfies React.CSSProperties
```

Add `import type { CSSProperties } from 'react'` if TypeScript requires explicit type namespace instead of `React.CSSProperties`.

- [ ] **Step 3: Extend RunSteps props and fullscreen rendering**

In `packages/ui/src/conversation/RunSteps.tsx`, add imports:

```ts
import type { AgentRun, Message, WorkerAgentInvocation } from '@hesper/shared'
import { WorkerAgentRunViewer } from './WorkerAgentRunViewer'
```

Extend `RunStepsProps`:

```ts
  workerAgentView?: {
    invocationsByParentStepId: Record<string, WorkerAgentInvocation>
    runsById: Record<string, AgentRun>
    stepsByRun: Record<string, RunStep[]>
    messagesByRun: Record<string, Message[]>
    streamingByRun: Record<string, string>
  }
```

Pass `workerAgentView` into `StepFullscreenDialog`. In the dialog, before `ToolStepDetails`, add:

```tsx
  const invocation = workerAgentView?.invocationsByParentStepId[step.id]
  const childRunId = invocation?.childRunId

  const body = invocation && childRunId ? (
    <WorkerAgentRunViewer
      invocation={invocation}
      run={workerAgentView?.runsById[childRunId]}
      steps={workerAgentView?.stepsByRun[childRunId] ?? []}
      messages={workerAgentView?.messagesByRun[childRunId] ?? []}
      streamingText={workerAgentView?.streamingByRun[childRunId] ?? ''}
    />
  ) : toolDetailPayload ? <ToolStepDetails step={step} /> : <MarkdownOutput content={markdown} />
```

Set dialog aria-label dynamically:

```tsx
aria-label={invocation ? 'Worker Agent 执行详情' : '步骤全屏查看'}
```

- [ ] **Step 4: Pass Worker view data through ConversationView**

In `packages/ui/src/conversation/ConversationView.tsx`, add a prop matching `RunStepsProps['workerAgentView']` and pass it to each `RunSteps` call.

- [ ] **Step 5: Export viewer**

In `packages/ui/src/index.ts`, add:

```ts
export * from './conversation/WorkerAgentRunViewer'
```

- [ ] **Step 6: Add renderer store Worker state**

In `apps/desktop/renderer/src/app-store.tsx`, add state fields:

```ts
  workerInvocationsById: Record<string, WorkerAgentInvocation>
  workerInvocationIdsByParentRun: Record<string, string[]>
  workerInvocationIdByParentStepId: Record<string, string>
  childMessagesByRun: Record<string, Message[]>
```

Initialize them in `initialAppState`.

In `agent.event` reducer:

- `worker.invocation.created/updated`: update maps.
- `run.created`: if `event.run.parentRunId` is present, do not link latest pending user message and do not update `latestRunIdBySession`; still store `runsById`, `runSessionIds`, and `stepsByRun`.
- `message.completed`: if message run is a child run (`runsById[runId]?.parentRunId`), store it in `childMessagesByRun[runId]`; otherwise keep existing main message behavior.

- [ ] **Step 7: Load Worker history in App.tsx**

In `apps/desktop/renderer/src/App.tsx`, after loading runs for a session:

1. For each root run, call `hesperApi.workerAgents.listByParentRun(run.id)`.
2. For each invocation with `childRunId`, call `conversation.listSteps(childRunId)` and `conversation.listMessagesByRun(childRunId)`.
3. Dispatch a new action such as `worker.history.loaded` containing invocations, child steps, and child messages.

Add the action handling in `app-store.tsx` with exact merge-by-id behavior.

- [ ] **Step 8: Add fallback IPC client methods**

In `apps/desktop/renderer/src/ipc-client.ts`, add fallback methods:

```ts
workerAgents: {
  listByParentRun: async (_parentRunId: string) => []
},
conversation: {
  ...,
  listMessagesByRun: async (runId: string) => messagesByRun[runId] ?? []
}
```

Use the existing fallback maps or add `messagesByRun` derived from messages with `runId`.

- [ ] **Step 9: Run UI and renderer tests/typecheck**

Run:

```bash
pnpm --filter @hesper/ui test -- src/__tests__/components.test.tsx
pnpm --filter @hesper/ui typecheck
pnpm --filter @hesper/desktop typecheck
```

Expected: PASS for all commands.

- [ ] **Step 10: Commit UI changes**

```bash
git add apps/desktop/renderer/src/app-store.tsx apps/desktop/renderer/src/App.tsx apps/desktop/renderer/src/ipc-client.ts packages/ui/src/conversation/WorkerAgentRunViewer.tsx packages/ui/src/conversation/RunSteps.tsx packages/ui/src/conversation/ConversationView.tsx packages/ui/src/index.ts packages/ui/src/__tests__/components.test.tsx
git commit -m "feat: show worker agent run viewer"
```

---

## Task 7: Full integration verification and documentation alignment

**Files:**
- Modify if needed: `docs/architecture/runtime-events.md`
- Modify if needed: `docs/architecture/mvp2-real-agent-runtime.md`
- Verify all packages.

- [ ] **Step 1: Update runtime event docs**

If code added `worker.invocation.created` and `worker.invocation.updated`, update `docs/architecture/runtime-events.md` current event surface to include:

```md
- `worker.invocation.created`
- `worker.invocation.updated`
```

Add one paragraph:

```md
Worker invocation events link a parent tool step to a Worker Agent child run. They are session-scoped through the parent run and allow the renderer to open a Worker Agent execution viewer before the parent tool call returns.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm check
```

Expected: PASS with typecheck and all Vitest suites passing.

- [ ] **Step 3: Run targeted desktop runtime checks**

Run:

```bash
pnpm --filter @hesper/desktop verify-dev-runtime
```

Expected: PASS and no Electron main/preload contract errors.

- [ ] **Step 4: Inspect git diff for accidental broad changes**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended Worker Agent runtime/tool/UI/docs files are changed since the previous task commits.

- [ ] **Step 5: Commit docs if changed**

If Task 7 changed docs, commit:

```bash
git add docs/architecture/runtime-events.md docs/architecture/mvp2-real-agent-runtime.md
git commit -m "docs: document worker agent runtime events"
```

If no docs changed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Spawn/list/get/wait/cancel tools are covered by Tasks 3, 4, and 5.
  - True parallel execution is covered by Task 4 service tests.
  - Bounded wait and diagnosis are covered by Task 4.
  - Session/parent-run isolation is covered by Task 4 and Task 5.
  - Tool/role/depth/count permission limits are covered by Task 4 and Task 5.
  - Worker full-screen UI is covered by Task 6.
  - Child output isolation is covered by Tasks 2, 5, and 6.
- Placeholder scan: no placeholder markers are present.
- Type consistency:
  - `parentStepId`, `parentToolCallId`, `contextSummary`, and `lastEventAt` are introduced in shared types, schemas, persistence, runtime, and UI.
  - `worker.invocation.created` / `worker.invocation.updated` are introduced in shared events and persistence event handling.
  - `listMessagesByRun` appears in persistence, app-core, IPC, preload, and renderer usage.
