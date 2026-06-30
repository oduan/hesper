import type { AgentRuntimeEvent, MessageAttachment, Session } from '@hesper/shared'
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentPromptInput, AttachmentReader } from '../adapters'
import { MockAgentAdapter } from '../mock-adapter'
import { defaultRetryPolicy } from '../retry-policy'
import { AgentRuntime } from '../runtime'
import { buildSessionCompaction } from '../session-compaction'

const session: Session = {
  id: 'session-1',
  title: 'Runtime queue test',
  status: 'active',
  outputMode: 'markdown',
  createdAt: '2026-06-10T05:00:00.000Z',
  updatedAt: '2026-06-10T05:00:00.000Z'
}

class FailsOnceRecordingAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []
  private attempts = 0

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.attempts += 1
    if (this.attempts === 1) {
      throw { code: 'network_error', message: 'temporary network failure', retryable: true }
    }
    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: `done:${input.prompt}`,
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-10T06:00:00.000Z'
      }
    })
  }
}

class AlwaysFailsRetryableAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput): Promise<void> {
    this.inputs.push(input)
    throw { code: 'stream_interrupted', message: 'stream disconnected', retryable: true }
  }
}

class AlwaysFails502UpstreamAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput): Promise<void> {
    this.inputs.push(input)
    throw new Error('502 Upstream service temporarily unavailable')
  }
}

class FailsAfterContextAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    await emit({
      type: 'step.created',
      step: {
        id: `step-${input.runId}`,
        runId: input.runId,
        type: 'tool_call',
        status: 'succeeded',
        title: 'Read File',
        detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', output: 'failed run context' }),
        createdAt: '2026-06-25T03:30:00.000Z',
        completedAt: '2026-06-25T03:30:01.000Z'
      }
    })
    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: 'partial failed answer',
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-25T03:30:02.000Z'
      }
    })
    throw { code: 'tool_error', message: 'terminal tool failure', retryable: false }
  }
}

class RecordingAdapter implements AgentAdapter {
  readonly starts: string[] = []
  readonly finishes: string[] = []
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.starts.push(input.runId)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: `done:${input.prompt}`,
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-10T06:00:00.000Z'
      }
    })
    this.finishes.push(input.runId)
  }
}

class ControllableAdapter implements AgentAdapter {
  private releaseRun!: () => void
  private releaseRunning!: () => void
  readonly inputs: AgentPromptInput[] = []
  readonly running = new Promise<void>((resolve) => {
    this.releaseRunning = resolve
  })
  readonly canFinish = new Promise<void>((resolve) => {
    this.releaseRun = resolve
  })

  finish(): void {
    this.releaseRun()
  }

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.releaseRunning()
    await this.canFinish
    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: `done:${input.prompt}`,
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-10T06:00:00.000Z'
      }
    })
  }
}

class AbortableAdapter implements AgentAdapter {
  private releaseRunning!: () => void
  readonly inputs: AgentPromptInput[] = []
  readonly running = new Promise<void>((resolve) => {
    this.releaseRunning = resolve
  })
  aborted = false

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    await emit({ type: 'message.delta', runId: input.runId, delta: 'partial' })
    this.releaseRunning()
    await new Promise<void>((resolve) => {
      input.signal.addEventListener('abort', () => {
        this.aborted = true
        resolve()
      }, { once: true })
    })
    throw new Error('aborted')
  }
}

class DelayedWorkerInvocationAdapter implements AgentAdapter {
  private releaseStarted!: () => void
  private releaseFinish!: () => void
  readonly started = new Promise<void>((resolve) => {
    this.releaseStarted = resolve
  })
  readonly canFinish = new Promise<void>((resolve) => {
    this.releaseFinish = resolve
  })

  finish(): void {
    this.releaseFinish()
  }

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.releaseStarted()
    await this.canFinish
    await emit({
      type: 'worker.invocation.created',
      invocation: {
        id: 'worker-agent-1',
        parentRunId: input.runId,
        childRunId: 'child-run-1',
        task: 'Review the staged diff.',
        roleId: 'reviewer',
        allowedToolIds: ['filesystem.read-file'],
        status: 'running',
        createdAt: '2026-06-10T06:00:00.000Z',
        lastEventAt: '2026-06-10T06:00:00.000Z'
      }
    })
  }
}

class OverflowThenSuccessAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    if (this.inputs.length === 1) {
      throw new Error('Prompt is too long for this model. Bearer super-secret-overflow-token')
    }

    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}-${this.inputs.length}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: `done:${input.prompt}`,
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-27T10:30:00.000Z'
      }
    })
  }
}

class AlwaysOverflowAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput): Promise<void> {
    this.inputs.push(input)
    throw new Error('maximum context length exceeded for token Bearer super-secret-overflow-token')
  }
}

class AlwaysProviderCodeOverflowAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput): Promise<void> {
    this.inputs.push(input)
    throw { code: 'context_overflow', message: 'context length exceeded for Bearer super-secret-overflow-token', retryable: true }
  }
}

class AlwaysRetryableMessageOverflowAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []

  async run(input: AgentPromptInput): Promise<void> {
    this.inputs.push(input)
    throw { code: 'network_error', message: 'context length exceeded for Bearer super-secret-overflow-token', retryable: true }
  }
}

class OverflowThenAbortableAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []
  private releaseSecondAttempt!: () => void
  readonly secondAttemptStarted = new Promise<void>((resolve) => {
    this.releaseSecondAttempt = resolve
  })
  aborted = false

  async run(input: AgentPromptInput): Promise<void> {
    this.inputs.push(input)
    if (this.inputs.length === 1) {
      throw new Error('input is too long for this model')
    }

    this.releaseSecondAttempt()
    await new Promise<void>((resolve) => {
      input.signal.addEventListener('abort', () => {
        this.aborted = true
        resolve()
      }, { once: true })
    })
    throw new Error('aborted')
  }
}

async function saveModel(persistence: Awaited<ReturnType<typeof createInMemoryPersistence>>, id: string, contextWindow: number): Promise<void> {
  await persistence.models.save({
    id,
    providerId: 'test-provider',
    modelName: id,
    displayName: id,
    capabilities: ['streaming', 'toolCalls'],
    contextWindow,
    enabled: true,
    createdAt: '2026-06-27T09:00:00.000Z',
    updatedAt: '2026-06-27T09:00:00.000Z'
  })
}

function textAttachment(bytes: number): MessageAttachment {
  return {
    id: `attachment-${bytes}`,
    kind: 'text',
    name: 'large-notes.md',
    mimeType: 'text/markdown',
    bytes,
    relativePath: 'attachments/large-notes.md'
  }
}

function textAttachmentReader(content: string): AttachmentReader {
  return {
    async readImageAttachment(): Promise<Buffer> {
      return Buffer.from([])
    },
    async readTextAttachment(): Promise<string> {
      return content
    }
  }
}

function makeVerboseRunSummary(runId: string, lines: string[]): string {
  return [
    `<hesper_run_context run_id="${runId}" version="2">`,
    'purpose: previous_run_continuity_not_new_user_request',
    'latest_user_request:',
    `Decision: keep coverage for ${runId}.`,
    ...lines,
    'latest_assistant_result:',
    `Validation: summarized ${runId} before runtime overflow handling.`,
    'tool_activity:',
    JSON.stringify({
      category: 'error',
      status: 'failed',
      title: `Run failing test ${runId}`,
      errorExcerpt: 'AssertionError: expected history to shrink',
      files: [`packages/agent-runtime/src/${runId}.ts`]
    }),
    '</hesper_run_context>'
  ].join('\n')
}

async function seedHistoricalRun(persistence: Awaited<ReturnType<typeof createInMemoryPersistence>>, sessionId: string, runId: string, startedAt: string, prompt: string, summary: string): Promise<void> {
  await persistence.runs.save({
    id: runId,
    sessionId,
    status: 'succeeded',
    modelId: 'mock/hesper-fast',
    retryCount: 0,
    maxRetries: 3,
    startedAt,
    endedAt: startedAt
  })
  await persistence.messages.save({
    id: `message-user-${runId}`,
    sessionId,
    role: 'user',
    content: prompt,
    contentType: 'plain',
    runId,
    createdAt: startedAt
  })
  await persistence.messages.save({
    id: `message-assistant-${runId}`,
    sessionId,
    role: 'assistant',
    content: `done:${prompt}`,
    contentType: 'markdown',
    runId,
    createdAt: startedAt
  })
  await persistence.contextItems.save({
    id: `context-item-${runId}-run-summary-v2`,
    sessionId,
    runId,
    kind: 'run_summary',
    version: 2,
    content: summary,
    tokenEstimate: Math.ceil(summary.length / 4),
    sourceHash: `hash-${runId}`,
    createdAt: startedAt
  })
}

async function seedOverflowHistory(persistence: Awaited<ReturnType<typeof createInMemoryPersistence>>, sessionId: string): Promise<void> {
  await seedHistoricalRun(
    persistence,
    sessionId,
    'run-overflow-1',
    '2026-06-27T09:10:00.000Z',
    'earlier request 1',
    makeVerboseRunSummary('run-overflow-1', ['Keep packages/agent-runtime/src/runtime.ts stable.', 'x'.repeat(800)])
  )
  await seedHistoricalRun(
    persistence,
    sessionId,
    'run-overflow-2',
    '2026-06-27T09:20:00.000Z',
    'earlier request 2',
    makeVerboseRunSummary('run-overflow-2', ['Keep packages/agent-runtime/src/context-overflow.ts focused.', 'y'.repeat(800)])
  )
  await seedHistoricalRun(
    persistence,
    sessionId,
    'run-overflow-3',
    '2026-06-27T09:30:00.000Z',
    'recent request',
    makeVerboseRunSummary('run-overflow-3', ['Validate runtime overflow recovery.', 'z'.repeat(120)])
  )
}

function makeNoMeaningfulRunSummary(runId: string): string {
  return [
    `<hesper_run_context run_id="${runId}" version="2">`,
    'purpose: previous_run_continuity_not_new_user_request',
    'tool_activity:',
    JSON.stringify({ category: 'file_read', status: 'succeeded', title: 'List files' }),
    '</hesper_run_context>'
  ].join('\n')
}

type RuntimeInternals = {
  enqueueChains: Map<string, Promise<void>>
  sessionStates: Map<string, unknown>
  terminatedRuns: Map<string, unknown>
}

function getRuntimeInternals(runtime: AgentRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals
}

const compressionPendingTitle = '正在进行压缩'
const compressionSucceededTitle = '压缩完成，继续执行'

type StepRuntimeEvent = Extract<AgentRuntimeEvent, { type: 'step.created' | 'step.updated' }>

function compressionStepEvents(events: AgentRuntimeEvent[]): StepRuntimeEvent[] {
  return events.filter((event): event is StepRuntimeEvent => {
    if (event.type !== 'step.created' && event.type !== 'step.updated') return false
    return event.step.title === compressionPendingTitle || event.step.title === compressionSucceededTitle
  })
}

describe('AgentRuntime queue', () => {
  it('defaults queued run workspace to the session workspace when enqueue omits it', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-workspace-default', workspacePath: 'C:/workspace' })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const run = await runtime.enqueue({ sessionId: 'session-workspace-default', prompt: 'use session workspace', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-workspace-default')

    expect((await persistence.runs.get(run.id))?.workspacePath).toBe('C:/workspace')
    expect(adapter.inputs[0]?.workspacePath).toBe('C:/workspace')
  })

  it('cleans enqueue chains and idle session state after queued runs drain', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-cleanup' })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({ sessionId: 'session-cleanup', prompt: 'first', modelId: 'mock/hesper-fast' })
    await runtime.enqueue({ sessionId: 'session-cleanup', prompt: 'second', modelId: 'mock/hesper-fast' })
    await runtime.enqueue({ sessionId: 'session-cleanup', prompt: 'third', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-cleanup')

    const internals = getRuntimeInternals(runtime)
    expect(internals.enqueueChains.has('session-cleanup')).toBe(false)
    expect(internals.sessionStates.has('session-cleanup')).toBe(false)
  })

  it('keeps adapter success when runtime listeners throw during event delivery', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-listener-failure' })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const listenerError = new Error('listener delivery failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    runtime.subscribe((event) => {
      if (event.type === 'message.completed') throw listenerError
    })

    try {
      const run = await runtime.enqueue({ sessionId: 'session-listener-failure', prompt: 'listener fails', modelId: 'mock/hesper-fast' })
      await runtime.waitForIdle('session-listener-failure')

      const storedRun = await persistence.runs.get(run.id)
      const runtimeEvents = await persistence.events.listByRun(run.id)
      const succeededEvent = runtimeEvents.find((event): event is Extract<AgentRuntimeEvent, { type: 'run.succeeded' }> => event.type === 'run.succeeded')
      expect(storedRun?.status).toBe('succeeded')
      expect(succeededEvent?.endedAt).toBe(storedRun?.endedAt)
      expect(runtimeEvents.map((event) => event.type)).toContain('run.succeeded')
      expect(runtimeEvents.map((event) => event.type)).not.toContain('run.failed')
      expect(consoleError).toHaveBeenCalledWith('AgentRuntime listener failed', listenerError)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('cancels an active run and aborts the adapter', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-cancel-active' })

    const adapter = new AbortableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-cancel-active', prompt: 'cancel me', modelId: 'mock/hesper-fast' })
    await adapter.running

    const cancelledRun = await runtime.cancelRun(run.id)
    await runtime.waitForIdle('session-cancel-active')

    expect(adapter.aborted).toBe(true)
    expect(cancelledRun).toMatchObject({ id: run.id, status: 'cancelled' })
    expect(await persistence.runs.get(run.id)).toMatchObject({ id: run.id, status: 'cancelled' })
    expect(events.map((event) => event.type)).toContain('run.cancelled')
    expect(events.map((event) => event.type)).not.toContain('run.succeeded')
    expect(events.map((event) => event.type)).not.toContain('run.failed')
    expect(await persistence.messages.listBySession('session-cancel-active')).toEqual([])
  })

  it('keeps a compensated active run failed and ignores later adapter events', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-compensated-run' })

    const adapter = new ControllableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const run = await runtime.enqueue({ sessionId: 'session-compensated-run', prompt: 'will be compensated', modelId: 'mock/hesper-fast' })
    await adapter.running

    await runtime.failRun(run.id, new Error('message write failed'))
    adapter.finish()
    await runtime.waitForIdle('session-compensated-run')

    const storedRun = await persistence.runs.get(run.id)
    const runtimeEvents = await persistence.events.listByRun(run.id)
    const failedEvent = runtimeEvents.find((event): event is Extract<AgentRuntimeEvent, { type: 'run.failed' }> => event.type === 'run.failed')
    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error?.message).toBe('message write failed')
    expect(failedEvent?.endedAt).toBe(storedRun?.endedAt)
    expect(runtimeEvents.map((event) => event.type)).toContain('run.failed')
    expect(runtimeEvents.map((event) => event.type)).not.toContain('run.succeeded')
    expect(await persistence.messages.listBySession('session-compensated-run')).toEqual([])
    expect(getRuntimeInternals(runtime).terminatedRuns.size).toBe(0)
  })

  it('persists context items when an active run is externally failed after useful context was recorded', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-compensated-context' })

    const adapter = new ControllableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const run = await runtime.enqueue({ sessionId: 'session-compensated-context', prompt: 'will fail with context', modelId: 'mock/hesper-fast' })
    await adapter.running
    await persistence.messages.save({
      id: 'message-compensated-context-user',
      sessionId: 'session-compensated-context',
      role: 'user',
      content: 'will fail with context',
      contentType: 'plain',
      runId: run.id,
      createdAt: '2026-06-25T04:00:00.000Z'
    })
    await persistence.steps.save({
      id: 'step-compensated-context',
      runId: run.id,
      type: 'tool_call',
      status: 'succeeded',
      title: 'Read File',
      detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', output: 'compensated context' }),
      createdAt: '2026-06-25T04:00:01.000Z'
    })

    await runtime.failRun(run.id, new Error('external failure'))
    adapter.finish()
    await runtime.waitForIdle('session-compensated-context')

    const items = await persistence.contextItems.listByRun(run.id)
    expect(items).toEqual([
      expect.objectContaining({
        id: `context-item-${run.id}-run-summary-v2`,
        kind: 'run_summary',
        runId: run.id,
        version: 2
      })
    ])
    expect(items[0]?.content).toContain('version="2"')
    expect(items[0]?.content).toContain('compensated context')
  })

  it('does not retry an active run after it is compensated during retry backoff', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-compensated-backoff' })

    const adapter = new FailsOnceRecordingAdapter()
    const runtime = new AgentRuntime({
      persistence,
      adapter,
      retryPolicy: {
        ...defaultRetryPolicy,
        maxRetries: 1,
        initialDelayMs: 50,
        backoffMultiplier: 1
      }
    })
    let resolveRetrying!: () => void
    const retrying = new Promise<void>((resolve) => {
      resolveRetrying = resolve
    })
    runtime.subscribe((event) => {
      if (event.type === 'run.retrying') resolveRetrying()
    })

    const run = await runtime.enqueue({ sessionId: 'session-compensated-backoff', prompt: 'retry then compensate', modelId: 'mock/hesper-fast' })
    await retrying
    await runtime.failRun(run.id, new Error('message write failed'))
    await runtime.waitForIdle('session-compensated-backoff')

    const storedRun = await persistence.runs.get(run.id)
    const runtimeEvents = await persistence.events.listByRun(run.id)
    expect(adapter.inputs).toHaveLength(1)
    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error?.message).toBe('message write failed')
    expect(runtimeEvents.map((event) => event.type)).toContain('run.failed')
    expect(runtimeEvents.map((event) => event.type)).not.toContain('run.succeeded')
    expect(await persistence.messages.listBySession('session-compensated-backoff')).toEqual([])
    expect(getRuntimeInternals(runtime).terminatedRuns.size).toBe(0)
  })

  it('ignores worker invocation events for terminated child runs', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-worker-event-filter' })

    const adapter = new DelayedWorkerInvocationAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({ sessionId: 'session-worker-event-filter', prompt: 'parent', modelId: 'mock/hesper-fast' })
    await adapter.started

    getRuntimeInternals(runtime).terminatedRuns.set('child-run-1', new Error('child terminated'))
    adapter.finish()
    await runtime.waitForIdle('session-worker-event-filter')

    expect(await persistence.events.listByRun('child-run-1')).toEqual([])
  })

  it('runs the first prompt immediately and queues the second prompt', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save(session)

    const adapter = new MockAgentAdapter({ delayMs: 5 })
    const runtime = new AgentRuntime({ persistence, adapter })

    const events: string[] = []
    runtime.subscribe((event) => {
      events.push(event.type)
    })

    const first = await runtime.enqueue({ sessionId: 'session-1', prompt: 'first', modelId: 'mock/hesper-fast' })
    const second = await runtime.enqueue({ sessionId: 'session-1', prompt: 'second', modelId: 'mock/hesper-fast' })

    expect(first.status).toBe('running')
    expect(second.status).toBe('queued')

    await runtime.waitForIdle('session-1')

    expect(events).toContain('run.succeeded')

    const runs = await persistence.runs.listBySession('session-1')
    expect(runs.map((run) => run.status)).toEqual(['succeeded', 'succeeded'])
  })

  it('serializes concurrent enqueue calls for the same session', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-concurrent' })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const [first, second] = await Promise.all([
      runtime.enqueue({ sessionId: 'session-concurrent', prompt: 'first', modelId: 'mock/hesper-fast' }),
      runtime.enqueue({ sessionId: 'session-concurrent', prompt: 'second', modelId: 'mock/hesper-fast' })
    ])

    expect([first.status, second.status].sort()).toEqual(['queued', 'running'])

    await runtime.waitForIdle('session-concurrent')

    const runs = await persistence.runs.listBySession('session-concurrent')
    expect(runs.map((run) => run.status)).toEqual(['succeeded', 'succeeded'])
    expect(adapter.starts).toHaveLength(2)
    expect(adapter.finishes).toEqual(adapter.starts)

    const messages = await persistence.messages.listBySession('session-concurrent')
    expect(messages.map((message) => message.content)).toEqual(['done:first', 'done:second'])
  })

  it('passes assembled system prompts to immediate and queued adapter runs', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-system-prompt' })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({ sessionId: 'session-system-prompt', prompt: 'first', modelId: 'mock/hesper-fast', systemPrompt: 'system:first', enabledToolIds: ['filesystem.read-file'] })
    await runtime.enqueue({ sessionId: 'session-system-prompt', prompt: 'second', modelId: 'mock/hesper-fast', systemPrompt: 'system:second', enabledToolIds: ['git.status'] })
    await runtime.waitForIdle('session-system-prompt')

    expect(adapter.inputs.map((input) => input.systemPrompt)).toEqual(['system:first', 'system:second'])
    expect(adapter.inputs.map((input) => input.enabledToolIds)).toEqual([['filesystem.read-file'], ['git.status']])
  })

  it('preserves attachments and attachmentReader for a queued second run', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-queued-attachments' })

    const adapter = new ControllableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const attachment: MessageAttachment = {
      id: 'attachment-text-queued',
      kind: 'text',
      name: 'notes.md',
      mimeType: 'text/markdown',
      bytes: 7,
      relativePath: 'attachments/notes.md'
    }
    const attachmentReader: AttachmentReader = {
      readImageAttachment: vi.fn(async () => Buffer.from('unused')),
      readTextAttachment: vi.fn(async () => '# Hello')
    }

    await runtime.enqueue({ sessionId: 'session-queued-attachments', prompt: 'first', modelId: 'mock/hesper-fast' })
    await adapter.running
    await runtime.enqueue({
      sessionId: 'session-queued-attachments',
      prompt: 'second',
      modelId: 'mock/hesper-fast',
      attachments: [attachment],
      attachmentReader
    })

    adapter.finish()
    await runtime.waitForIdle('session-queued-attachments')

    expect(adapter.inputs).toHaveLength(2)
    expect(adapter.inputs[1]?.attachments?.[0]?.name).toBe('notes.md')
    expect(adapter.inputs[1]?.attachmentReader).toBe(attachmentReader)
  })

  it('passes thinking levels to immediate and queued adapter runs', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-thinking-levels' })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({ sessionId: 'session-thinking-levels', prompt: 'first', modelId: 'mock/hesper-fast', thinkingLevel: 'low' })
    await runtime.enqueue({ sessionId: 'session-thinking-levels', prompt: 'second', modelId: 'mock/hesper-fast', thinkingLevel: 'xhigh' })
    await runtime.waitForIdle('session-thinking-levels')

    expect(adapter.inputs.map((input) => input.thinkingLevel)).toEqual(['low', 'xhigh'])
  })

  it('keeps the same assembled system prompt across retry attempts', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-system-prompt-retry' })

    const adapter = new FailsOnceRecordingAdapter()
    const runtime = new AgentRuntime({
      persistence,
      adapter,
      retryPolicy: {
        ...defaultRetryPolicy,
        maxRetries: 1,
        initialDelayMs: 1,
        backoffMultiplier: 1
      }
    })

    const run = await runtime.enqueue({ sessionId: 'session-system-prompt-retry', prompt: 'retry me', modelId: 'mock/hesper-fast', systemPrompt: 'system:retry', enabledToolIds: ['web.fetch-url'] })
    await runtime.waitForIdle('session-system-prompt-retry')

    expect(adapter.inputs.map((input) => [input.runId, input.systemPrompt, input.enabledToolIds])).toEqual([
      [run.id, 'system:retry', ['web.fetch-url']],
      [run.id, 'system:retry', ['web.fetch-url']]
    ])
  })

  it('passes previous conversation messages to adapter and excludes the current run message', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-history' })

    const adapter = new ControllableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const first = await runtime.enqueue({ sessionId: 'session-history', prompt: 'first question', modelId: 'mock/hesper-fast' })
    await persistence.messages.save({
      id: 'message-user-first',
      sessionId: 'session-history',
      role: 'user',
      content: 'first question',
      contentType: 'plain',
      runId: first.id,
      createdAt: '2026-06-10T05:00:00.000Z'
    })

    const second = await runtime.enqueue({ sessionId: 'session-history', prompt: 'second question', modelId: 'mock/hesper-fast' })
    await persistence.messages.save({
      id: 'message-user-second',
      sessionId: 'session-history',
      role: 'user',
      content: 'second question',
      contentType: 'plain',
      runId: second.id,
      createdAt: '2026-06-10T05:00:02.000Z'
    })

    adapter.finish()
    await runtime.waitForIdle('session-history')

    expect(adapter.inputs).toHaveLength(2)
    expect(adapter.inputs[1]!.prompt).toBe('second question')
    const secondHistory = adapter.inputs[1]!.historyMessages ?? []
    expect(secondHistory.map((message) => [message.role, message.content, message.runId]).slice(0, 2)).toEqual([
      ['user', 'first question', first.id],
      ['assistant', 'done:first question', first.id]
    ])
    expect(secondHistory.map((message) => message.id)).toContain(`context-summary-${first.id}`)
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('latest_assistant_result:')
    expect(secondHistory.map((message) => message.content).join('\n')).not.toContain('second question')
  })

  it('passes previous run tool context summaries to adapter history', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-tool-context' })

    const adapter = new ControllableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const first = await runtime.enqueue({ sessionId: 'session-tool-context', prompt: 'inspect file', modelId: 'mock/hesper-fast' })
    await persistence.messages.save({
      id: 'message-user-first-tool-context',
      sessionId: 'session-tool-context',
      role: 'user',
      content: 'inspect file',
      contentType: 'plain',
      runId: first.id,
      createdAt: '2026-06-25T03:00:00.000Z'
    })
    await persistence.steps.save({
      id: 'step-first-tool-context',
      runId: first.id,
      type: 'tool_call',
      status: 'succeeded',
      title: 'Read File',
      summary: 'read README',
      detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', input: { path: 'README.md' }, output: 'hello from readme' }),
      createdAt: '2026-06-25T03:00:01.000Z',
      completedAt: '2026-06-25T03:00:02.000Z'
    })

    const second = await runtime.enqueue({ sessionId: 'session-tool-context', prompt: 'continue', modelId: 'mock/hesper-fast' })
    await persistence.messages.save({
      id: 'message-user-second-tool-context',
      sessionId: 'session-tool-context',
      role: 'user',
      content: 'continue',
      contentType: 'plain',
      runId: second.id,
      createdAt: '2026-06-25T03:00:03.000Z'
    })

    adapter.finish()
    await runtime.waitForIdle('session-tool-context')

    expect(adapter.inputs).toHaveLength(2)
    const secondHistory = adapter.inputs[1]!.historyMessages ?? []
    expect(secondHistory.map((message) => message.id)).toContain(`context-summary-${first.id}`)
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('version="2"')
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('"category":"success"')
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('README.md')
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('hello from readme')
    expect(secondHistory.map((message) => message.content).join('\n')).not.toContain('filesystem.read-file')
    expect(secondHistory.map((message) => message.content).join('\n')).not.toContain('continue')
  })

  it('persists a run context item after a successful parent run', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-context-item-success' })

    const adapter = new ControllableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const run = await runtime.enqueue({ sessionId: 'session-context-item-success', prompt: 'inspect file', modelId: 'mock/hesper-fast' })
    await persistence.messages.save({
      id: 'message-user-context-item-success',
      sessionId: 'session-context-item-success',
      role: 'user',
      content: 'inspect file',
      contentType: 'plain',
      runId: run.id,
      createdAt: '2026-06-25T03:10:00.000Z'
    })
    await persistence.steps.save({
      id: 'step-context-item-success',
      runId: run.id,
      type: 'tool_call',
      status: 'succeeded',
      title: 'Read File',
      summary: 'read README',
      detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', input: { path: 'README.md' }, output: 'persist me' }),
      createdAt: '2026-06-25T03:10:01.000Z',
      completedAt: '2026-06-25T03:10:02.000Z'
    })

    adapter.finish()
    await runtime.waitForIdle('session-context-item-success')

    await expect(persistence.contextItems.listByRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: `context-item-${run.id}-run-summary-v2`,
        sessionId: 'session-context-item-success',
        runId: run.id,
        kind: 'run_summary',
        version: 2,
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    ])
    const [item] = await persistence.contextItems.listByRun(run.id)
    expect(item?.content).toContain('persist me')
    expect(item?.content).toContain('done:inspect file')
    expect(item?.tokenEstimate).toBe(Math.ceil((item?.content.length ?? 0) / 4))
  })

  it('persists a run context item after a failed parent run with useful context', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-context-item-failed' })

    const adapter = new FailsAfterContextAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const run = await runtime.enqueue({ sessionId: 'session-context-item-failed', prompt: 'fail with context', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-context-item-failed')

    await expect(persistence.runs.get(run.id)).resolves.toMatchObject({ status: 'failed' })
    const items = await persistence.contextItems.listByRun(run.id)
    expect(items).toEqual([
      expect.objectContaining({
        id: `context-item-${run.id}-run-summary-v2`,
        sessionId: 'session-context-item-failed',
        runId: run.id,
        kind: 'run_summary',
        version: 2
      })
    ])
    expect(items[0]?.content).toContain('failed run context')
    expect(items[0]?.content).toContain('partial failed answer')
  })

  it('uses persisted run context items for history without reloading steps for those runs', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-persisted-context-history' })
    await persistence.runs.save({ id: 'run-with-persisted-context', sessionId: 'session-persisted-context-history', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 3, startedAt: '2026-06-25T03:20:00.000Z', endedAt: '2026-06-25T03:20:02.000Z' })
    await persistence.messages.save({
      id: 'message-user-persisted-context',
      sessionId: 'session-persisted-context-history',
      role: 'user',
      content: 'old prompt',
      contentType: 'plain',
      runId: 'run-with-persisted-context',
      createdAt: '2026-06-25T03:20:00.000Z'
    })
    await persistence.steps.save({
      id: 'step-persisted-context-should-not-load',
      runId: 'run-with-persisted-context',
      type: 'tool_call',
      status: 'succeeded',
      title: 'Should Not Load',
      detail: JSON.stringify({ output: 'dynamic should not appear' }),
      createdAt: '2026-06-25T03:20:01.000Z'
    })
    await persistence.contextItems.save({
      id: 'context-item-run-with-persisted-context-run-summary-v1',
      sessionId: 'session-persisted-context-history',
      runId: 'run-with-persisted-context',
      kind: 'run_summary',
      version: 1,
      content: '<hesper_run_context run_id="run-with-persisted-context">\npersisted context wins\n</hesper_run_context>',
      tokenEstimate: 24,
      sourceHash: 'hash-persisted-context',
      createdAt: '2026-06-25T03:20:03.000Z'
    })

    const listByRun = vi.spyOn(persistence.steps, 'listByRun')
    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({ sessionId: 'session-persisted-context-history', prompt: 'new prompt', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-persisted-context-history')

    const history = adapter.inputs[0]?.historyMessages ?? []
    expect(history.map((message) => message.id)).toContain('context-summary-run-with-persisted-context')
    expect(history.map((message) => message.content).join('\n')).toContain('persisted context wins')
    expect(history.map((message) => message.content).join('\n')).not.toContain('dynamic should not appear')
    expect(listByRun).not.toHaveBeenCalledWith('run-with-persisted-context')
  })

  it('persists assistant messages when adapter emits message.completed', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-message-completed' })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const run = await runtime.enqueue({ sessionId: 'session-message-completed', prompt: 'persist me', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-message-completed')

    const messages = await persistence.messages.listBySession('session-message-completed')
    expect(messages).toEqual([
      expect.objectContaining({
        sessionId: 'session-message-completed',
        runId: run.id,
        role: 'assistant',
        content: 'done:persist me'
      })
    ])
  })

  it('does not generate a session compaction when the local context budget is still within limits', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-within-budget' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedOverflowHistory(persistence, 'session-overflow-within-budget')

    const saveSpy = vi.spyOn(persistence.contextItems, 'save')
    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-within-budget', prompt: 'continue without compaction', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-within-budget')

    const sessionSummarySaves = saveSpy.mock.calls
      .map(([item]) => item)
      .filter((item) => item.kind === 'session_summary')
    expect(sessionSummarySaves).toEqual([])
    expect(adapter.inputs).toHaveLength(1)
    expect((adapter.inputs[0]?.historyMessages ?? []).map((message) => message.content).join('\n')).not.toContain('<hesper_session_context')
    expect(compressionStepEvents(events)).toEqual([])
    await expect(persistence.steps.listByRun(run.id)).resolves.toEqual([])
  })

  it('creates a reusable session compaction before calling the adapter when the local budget is exceeded', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-local-budget' })
    await saveModel(persistence, 'mock/hesper-fast', 300)
    await seedOverflowHistory(persistence, 'session-overflow-local-budget')

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-local-budget', prompt: 'compact before run', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-local-budget')

    const sessionSummaries = (await persistence.contextItems.listBySession('session-overflow-local-budget')).filter((item) => item.kind === 'session_summary')
    expect(sessionSummaries).toHaveLength(1)
    expect(adapter.inputs).toHaveLength(1)

    const history = adapter.inputs[0]?.historyMessages ?? []
    const historyIds = history.map((message) => message.id)
    const historyContent = history.map((message) => message.content).join('\n')
    expect(historyContent).toContain('<hesper_session_context')
    expect(historyIds).not.toContain('context-summary-run-overflow-1')
    expect(historyIds).not.toContain('context-summary-run-overflow-2')

    const compressionEvents = compressionStepEvents(events)
    expect(compressionEvents).toHaveLength(2)
    expect(compressionEvents[0]).toMatchObject({
      type: 'step.created',
      step: expect.objectContaining({ runId: run.id, type: 'thought', status: 'running', title: compressionPendingTitle })
    })
    expect(compressionEvents[1]).toMatchObject({
      type: 'step.updated',
      step: expect.objectContaining({ runId: run.id, type: 'thought', status: 'succeeded', title: compressionSucceededTitle })
    })
    expect(compressionEvents[1]?.step.id).toBe(compressionEvents[0]?.step.id)

    await expect(persistence.steps.listByRun(run.id)).resolves.toEqual([
      expect.objectContaining({ id: compressionEvents[0]?.step.id, runId: run.id, type: 'thought', status: 'succeeded', title: compressionSucceededTitle })
    ])
  })

  it('uses the fallback context window for an unknown model before calling the adapter when the local budget is exceeded', async () => {
    const persistence = await createInMemoryPersistence()
    const sessionId = 'session-overflow-unknown-model-fallback'
    await persistence.sessions.save({ ...session, id: sessionId })
    await seedHistoricalRun(
      persistence,
      sessionId,
      'run-unknown-fallback-1',
      '2026-06-27T09:10:00.000Z',
      'older unknown-model request 1',
      makeVerboseRunSummary('run-unknown-fallback-1', ['Keep fallback context budget coverage for runtime.ts.', 'a'.repeat(260_000)])
    )
    await seedHistoricalRun(
      persistence,
      sessionId,
      'run-unknown-fallback-2',
      '2026-06-27T09:20:00.000Z',
      'older unknown-model request 2',
      makeVerboseRunSummary('run-unknown-fallback-2', ['Keep fallback context budget coverage for context-budget.ts.', 'b'.repeat(260_000)])
    )
    await seedHistoricalRun(
      persistence,
      sessionId,
      'run-unknown-fallback-recent',
      '2026-06-27T09:30:00.000Z',
      'recent unknown-model request',
      makeVerboseRunSummary('run-unknown-fallback-recent', ['Keep recent run complete.'])
    )

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId, prompt: 'compact unknown model fallback before run', modelId: 'unknown/provider-model' })
    await runtime.waitForIdle(sessionId)

    const sessionSummaries = (await persistence.contextItems.listBySession(sessionId)).filter((item) => item.kind === 'session_summary')
    expect(sessionSummaries).toHaveLength(1)
    expect(adapter.inputs).toHaveLength(1)
    expect((adapter.inputs[0]?.historyMessages ?? []).map((message) => message.content).join('\n')).toContain('<hesper_session_context')

    const compressionEvents = compressionStepEvents(events)
    expect(compressionEvents).toHaveLength(2)
    expect(compressionEvents[0]).toMatchObject({
      type: 'step.created',
      step: expect.objectContaining({ runId: run.id, type: 'thought', status: 'running', title: compressionPendingTitle })
    })
    expect(compressionEvents[1]).toMatchObject({
      type: 'step.updated',
      step: expect.objectContaining({ runId: run.id, type: 'thought', status: 'succeeded', title: compressionSucceededTitle })
    })
    expect(compressionEvents[1]?.step.id).toBe(compressionEvents[0]?.step.id)

    await expect(persistence.steps.listByRun(run.id)).resolves.toEqual([
      expect.objectContaining({ id: compressionEvents[0]?.step.id, runId: run.id, type: 'thought', status: 'succeeded', title: compressionSucceededTitle })
    ])
  })

  it('still upserts a completed compression step if the created event append fails after saving the step', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-step-created-event-fails' })
    await saveModel(persistence, 'mock/hesper-fast', 300)
    await seedOverflowHistory(persistence, 'session-overflow-step-created-event-fails')

    const originalAppend = persistence.events.append.bind(persistence.events)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(persistence.events, 'append').mockImplementation(async (event) => {
      if (event.type === 'step.created' && event.step.title === compressionPendingTitle) {
        throw new Error('simulated event append failure')
      }
      await originalAppend(event)
    })

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-step-created-event-fails', prompt: 'compact despite event failure', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-step-created-event-fails')

    expect(adapter.inputs).toHaveLength(1)
    const persistedSteps = await persistence.steps.listByRun(run.id)
    expect(persistedSteps).toHaveLength(1)
    expect(persistedSteps[0]).toMatchObject({ runId: run.id, type: 'thought', status: 'succeeded', title: compressionSucceededTitle })
    expect(consoleError).toHaveBeenCalledWith('AgentRuntime failed to emit step event', expect.any(Error))
  })

  it('reuses an existing session compaction for the same covered runs instead of saving it again', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-reuse' })
    await saveModel(persistence, 'mock/hesper-fast', 300)
    await seedOverflowHistory(persistence, 'session-overflow-reuse')

    const olderRunSummaries = await Promise.all([
      persistence.contextItems.listByRun('run-overflow-1'),
      persistence.contextItems.listByRun('run-overflow-2')
    ])
    const built = buildSessionCompaction({
      sessionId: 'session-overflow-reuse',
      createdAt: '2026-06-27T10:00:00.000Z',
      runSummaries: olderRunSummaries.flatMap((items) => items.filter((item) => item.kind === 'run_summary').map((item) => ({
        runId: item.runId,
        createdAt: item.createdAt,
        version: item.version,
        content: item.content
      })))
    })
    expect(built).toBeDefined()
    await persistence.contextItems.save(built!.item)

    const saveSpy = vi.spyOn(persistence.contextItems, 'save')
    saveSpy.mockClear()
    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({ sessionId: 'session-overflow-reuse', prompt: 'reuse compaction', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-reuse')

    const sessionSummarySaves = saveSpy.mock.calls
      .map(([item]) => item)
      .filter((item) => item.kind === 'session_summary')
    expect(sessionSummarySaves).toEqual([])
    expect((adapter.inputs[0]?.historyMessages ?? []).map((message) => message.content).join('\n')).toContain('<hesper_session_context')
  })

  it('retries context overflow with a shorter compacted history without using the normal retry policy', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-provider-retry' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedOverflowHistory(persistence, 'session-overflow-provider-retry')

    const adapter = new OverflowThenSuccessAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-provider-retry', prompt: 'recover from provider overflow', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-provider-retry')

    const storedRun = await persistence.runs.get(run.id)
    const firstHistory = adapter.inputs[0]?.historyMessages ?? []
    const secondHistory = adapter.inputs[1]?.historyMessages ?? []
    const firstLength = firstHistory.reduce((total, message) => total + message.content.length, 0)
    const secondLength = secondHistory.reduce((total, message) => total + message.content.length, 0)

    expect(adapter.inputs).toHaveLength(2)
    expect(firstHistory.map((message) => message.content).join('\n')).not.toContain('<hesper_session_context')
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('<hesper_session_context')
    expect(secondLength).toBeLessThan(firstLength)
    expect(storedRun).toMatchObject({ status: 'succeeded', retryCount: 0 })
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(0)

    const compressionEvents = compressionStepEvents(events)
    expect(compressionEvents).toHaveLength(2)
    expect(compressionEvents[0]).toMatchObject({
      type: 'step.created',
      step: expect.objectContaining({ runId: run.id, type: 'thought', status: 'running', title: compressionPendingTitle })
    })
    expect(compressionEvents[1]).toMatchObject({
      type: 'step.updated',
      step: expect.objectContaining({ runId: run.id, type: 'thought', status: 'succeeded', title: compressionSucceededTitle })
    })
    expect(compressionEvents[1]?.step.id).toBe(compressionEvents[0]?.step.id)
  })

  it('uses the least aggressive compaction tier after provider overflow when no local preflight ran', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-provider-no-model-budget' })
    await seedHistoricalRun(
      persistence,
      'session-overflow-provider-no-model-budget',
      'run-overflow-long-goal',
      '2026-06-27T09:10:00.000Z',
      'older long request',
      makeVerboseRunSummary('run-overflow-long-goal', [`Must preserve ${'a'.repeat(2600)} packages/agent-runtime/src/runtime.ts. Validated.`])
    )
    await seedHistoricalRun(
      persistence,
      'session-overflow-provider-no-model-budget',
      'run-overflow-second-older',
      '2026-06-27T09:20:00.000Z',
      'second older request',
      makeVerboseRunSummary('run-overflow-second-older', ['Decision: keep a second older run so session compaction covers multiple runs.'])
    )
    await seedHistoricalRun(
      persistence,
      'session-overflow-provider-no-model-budget',
      'run-overflow-recent-window',
      '2026-06-27T09:30:00.000Z',
      'recent request',
      makeVerboseRunSummary('run-overflow-recent-window', ['Keep recent run complete.'])
    )

    const adapter = new OverflowThenSuccessAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({ sessionId: 'session-overflow-provider-no-model-budget', prompt: 'provider overflow without model metadata', modelId: 'mock/missing-context-window' })
    await runtime.waitForIdle('session-overflow-provider-no-model-budget')

    const secondSummary = (adapter.inputs[1]?.historyMessages ?? []).find((message) => message.content.includes('<hesper_session_context'))
    expect(adapter.inputs).toHaveLength(2)
    expect(secondSummary?.content.length).toBeGreaterThan(2000)
    expect(secondSummary?.content.length).toBeLessThanOrEqual(4000)
  })

  it('ignores text attachment bytes for local budget when no attachment reader will inline them', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-attachment-no-reader' })
    await saveModel(persistence, 'mock/hesper-fast', 2_000)
    await seedHistoricalRun(
      persistence,
      'session-overflow-attachment-no-reader',
      'run-overflow-small-1',
      '2026-06-27T09:10:00.000Z',
      'small earlier request',
      makeVerboseRunSummary('run-overflow-small-1', ['Decision: keep small history.'])
    )
    await seedHistoricalRun(
      persistence,
      'session-overflow-attachment-no-reader',
      'run-overflow-small-2',
      '2026-06-27T09:20:00.000Z',
      'second small request',
      makeVerboseRunSummary('run-overflow-small-2', ['Decision: keep another small history item.'])
    )
    await seedHistoricalRun(
      persistence,
      'session-overflow-attachment-no-reader',
      'run-overflow-small-3',
      '2026-06-27T09:30:00.000Z',
      'small recent request',
      makeVerboseRunSummary('run-overflow-small-3', ['Keep recent run complete.'])
    )

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({
      sessionId: 'session-overflow-attachment-no-reader',
      prompt: 'attachment is not inline without reader',
      modelId: 'mock/hesper-fast',
      attachments: [textAttachment(20_000)]
    })
    await runtime.waitForIdle('session-overflow-attachment-no-reader')

    expect((await persistence.contextItems.listBySession('session-overflow-attachment-no-reader')).filter((item) => item.kind === 'session_summary')).toHaveLength(0)
    expect((adapter.inputs[0]?.historyMessages ?? []).map((message) => message.content).join('\n')).not.toContain('<hesper_session_context')
  })

  it('counts text attachment bytes for local budget when an attachment reader will inline them', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-attachment-reader' })
    await saveModel(persistence, 'mock/hesper-fast', 2_000)
    await seedHistoricalRun(
      persistence,
      'session-overflow-attachment-reader',
      'run-overflow-reader-small-1',
      '2026-06-27T09:10:00.000Z',
      'small earlier request',
      makeVerboseRunSummary('run-overflow-reader-small-1', ['Decision: keep small history.'])
    )
    await seedHistoricalRun(
      persistence,
      'session-overflow-attachment-reader',
      'run-overflow-reader-small-2',
      '2026-06-27T09:20:00.000Z',
      'second small request',
      makeVerboseRunSummary('run-overflow-reader-small-2', ['Decision: keep another small history item.'])
    )
    await seedHistoricalRun(
      persistence,
      'session-overflow-attachment-reader',
      'run-overflow-reader-small-3',
      '2026-06-27T09:30:00.000Z',
      'small recent request',
      makeVerboseRunSummary('run-overflow-reader-small-3', ['Keep recent run complete.'])
    )

    const adapter = new RecordingAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })

    await runtime.enqueue({
      sessionId: 'session-overflow-attachment-reader',
      prompt: 'attachment will be inlined by reader',
      modelId: 'mock/hesper-fast',
      attachments: [textAttachment(20_000)],
      attachmentReader: textAttachmentReader('重要内容'.repeat(1000))
    })
    await runtime.waitForIdle('session-overflow-attachment-reader')

    expect((await persistence.contextItems.listBySession('session-overflow-attachment-reader')).filter((item) => item.kind === 'session_summary')).toHaveLength(1)
    expect((adapter.inputs[0]?.historyMessages ?? []).map((message) => message.content).join('\n')).toContain('<hesper_session_context')
  })

  it('fails with a redacted diagnostic error after exhausting overflow retries', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-exhausted' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedOverflowHistory(persistence, 'session-overflow-exhausted')

    const adapter = new AlwaysOverflowAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-exhausted', prompt: 'keep overflowing', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-exhausted')

    const storedRun = await persistence.runs.get(run.id)
    expect(adapter.inputs).toHaveLength(3)
    expect(storedRun).toMatchObject({
      id: run.id,
      status: 'failed',
      retryCount: 0,
      error: expect.objectContaining({ retryable: false })
    })
    expect(storedRun?.error?.message).not.toContain('super-secret-overflow-token')
    expect(storedRun?.error?.message).toContain('[redacted-sensitive-value]')
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(0)
    expect(events.filter((event) => event.type === 'run.failed')).toHaveLength(1)
  })

  it('does not retry a provider overflow when no older runs are eligible for compaction', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-no-eligible-runs' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedHistoricalRun(
      persistence,
      'session-overflow-no-eligible-runs',
      'run-overflow-only-recent',
      '2026-06-27T09:30:00.000Z',
      'recent only request',
      makeVerboseRunSummary('run-overflow-only-recent', ['Keep the only historical run as a recent full-message window.'])
    )

    const adapter = new AlwaysOverflowAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-no-eligible-runs', prompt: 'cannot compact recent-only history', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-no-eligible-runs')

    const storedRun = await persistence.runs.get(run.id)
    expect(adapter.inputs).toHaveLength(1)
    expect(new Set(adapter.inputs.map((input) => (input.historyMessages ?? []).reduce((total, message) => total + message.content.length, 0))).size).toBe(1)
    expect(storedRun).toMatchObject({ status: 'failed', retryCount: 0 })
    expect((await persistence.contextItems.listBySession('session-overflow-no-eligible-runs')).filter((item) => item.kind === 'session_summary')).toHaveLength(0)
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(0)
    expect(compressionStepEvents(events)).toEqual([])
    await expect(persistence.steps.listByRun(run.id)).resolves.toEqual([])
  })

  it('does not retry a provider overflow when compaction has no meaningful source material', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-no-meaningful-content' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedHistoricalRun(
      persistence,
      'session-overflow-no-meaningful-content',
      'run-overflow-no-meaning-1',
      '2026-06-27T09:10:00.000Z',
      'older noisy request',
      makeNoMeaningfulRunSummary('run-overflow-no-meaning-1')
    )
    await seedHistoricalRun(
      persistence,
      'session-overflow-no-meaningful-content',
      'run-overflow-no-meaning-2',
      '2026-06-27T09:30:00.000Z',
      'recent request',
      makeVerboseRunSummary('run-overflow-no-meaning-2', ['Keep the recent run complete.'])
    )

    const adapter = new AlwaysOverflowAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-no-meaningful-content', prompt: 'cannot compact meaningless source', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-no-meaningful-content')

    const storedRun = await persistence.runs.get(run.id)
    expect(adapter.inputs).toHaveLength(1)
    expect(storedRun).toMatchObject({ status: 'failed', retryCount: 0 })
    expect((await persistence.contextItems.listBySession('session-overflow-no-meaningful-content')).filter((item) => item.kind === 'session_summary')).toHaveLength(0)
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(0)
    expect(compressionStepEvents(events)).toEqual([])
    await expect(persistence.steps.listByRun(run.id)).resolves.toEqual([])
  })

  it('normalizes provider context overflow codes to a supported stored error', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-provider-code' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedOverflowHistory(persistence, 'session-overflow-provider-code')

    const adapter = new AlwaysProviderCodeOverflowAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-provider-code', prompt: 'provider code overflow', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-provider-code')

    const storedRun = await persistence.runs.get(run.id)
    expect(adapter.inputs).toHaveLength(3)
    expect(storedRun).toMatchObject({
      id: run.id,
      status: 'failed',
      retryCount: 0,
      error: expect.objectContaining({ code: 'unknown', retryable: false })
    })
    expect(storedRun?.error?.message).toContain('[redacted-sensitive-value]')
    await expect(persistence.runs.listBySession('session-overflow-provider-code')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: run.id })]))
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(0)
  })

  it('does not mix message-detected context overflow with the normal retry policy', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-no-normal-retry' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedOverflowHistory(persistence, 'session-overflow-no-normal-retry')

    const adapter = new AlwaysRetryableMessageOverflowAdapter()
    const runtime = new AgentRuntime({
      persistence,
      adapter,
      retryPolicy: {
        ...defaultRetryPolicy,
        maxRetries: 1,
        initialDelayMs: 0,
        retryableErrors: ['network_error']
      }
    })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-no-normal-retry', prompt: 'context message must not use network retry', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-overflow-no-normal-retry')

    const storedRun = await persistence.runs.get(run.id)
    expect(adapter.inputs).toHaveLength(3)
    expect(storedRun).toMatchObject({ status: 'failed', retryCount: 0, error: expect.objectContaining({ retryable: false }) })
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(0)
  })

  it('still allows cancellation after an overflow-triggered retry starts', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-cancelled' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedOverflowHistory(persistence, 'session-overflow-cancelled')

    const adapter = new OverflowThenAbortableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-cancelled', prompt: 'cancel after overflow', modelId: 'mock/hesper-fast' })
    await adapter.secondAttemptStarted
    const cancelledRun = await runtime.cancelRun(run.id)
    await runtime.waitForIdle('session-overflow-cancelled')

    expect(adapter.inputs).toHaveLength(2)
    expect(adapter.aborted).toBe(true)
    expect(cancelledRun).toMatchObject({ id: run.id, status: 'cancelled' })
    expect(await persistence.runs.get(run.id)).toMatchObject({ id: run.id, status: 'cancelled' })
    expect(events.map((event) => event.type)).toContain('run.cancelled')
    expect(events.map((event) => event.type)).not.toContain('run.failed')
    expect(events.map((event) => event.type)).not.toContain('run.succeeded')
  })

  it('still allows termination after an overflow-triggered retry starts', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-overflow-terminated' })
    await saveModel(persistence, 'mock/hesper-fast', 10_000)
    await seedOverflowHistory(persistence, 'session-overflow-terminated')

    const adapter = new OverflowThenAbortableAdapter()
    const runtime = new AgentRuntime({ persistence, adapter })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-overflow-terminated', prompt: 'terminate after overflow', modelId: 'mock/hesper-fast' })
    await adapter.secondAttemptStarted
    const failedRun = await runtime.failRun(run.id, { code: 'tool_error', message: 'terminated by supervisor', retryable: false })
    const waitResult = await Promise.race([
      runtime.waitForIdle('session-overflow-terminated').then(() => 'idle' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 200))
    ])

    expect(waitResult).toBe('idle')
    expect(adapter.inputs).toHaveLength(2)
    expect(adapter.aborted).toBe(true)
    expect(failedRun).toMatchObject({ id: run.id, status: 'failed' })
    expect(await persistence.runs.get(run.id)).toMatchObject({ id: run.id, status: 'failed' })
    expect(events.map((event) => event.type)).toContain('run.failed')
    expect(events.map((event) => event.type)).not.toContain('run.cancelled')
    expect(events.map((event) => event.type)).not.toContain('run.succeeded')
  })

  it('retries retryable adapter failures and then succeeds', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-2' })

    const adapter = new MockAgentAdapter({ failTimes: 2 })
    const runtime = new AgentRuntime({
      persistence,
      adapter,
      retryPolicy: {
        ...defaultRetryPolicy,
        initialDelayMs: 1,
        backoffMultiplier: 1
      }
    })

    const events: string[] = []
    runtime.subscribe((event) => {
      events.push(event.type)
    })

    const run = await runtime.enqueue({ sessionId: 'session-2', prompt: 'recover please', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-2')

    const storedRun = await persistence.runs.get(run.id)
    expect(storedRun?.status).toBe('succeeded')
    expect(storedRun?.retryCount).toBe(2)
    expect(events.filter((event) => event === 'run.retrying')).toHaveLength(2)
  })

  it('marks 502 upstream errors failed after five retries are exhausted', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-502-upstream-retry-exhausted' })

    const adapter = new AlwaysFails502UpstreamAdapter()
    const runtime = new AgentRuntime({
      persistence,
      adapter,
      retryPolicy: {
        ...defaultRetryPolicy,
        maxRetries: 5,
        initialDelayMs: 1,
        backoffMultiplier: 1
      }
    })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-502-upstream-retry-exhausted', prompt: 'will exhaust upstream retries', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-502-upstream-retry-exhausted')

    const storedRun = await persistence.runs.get(run.id)
    expect(adapter.inputs).toHaveLength(6)
    expect(storedRun).toMatchObject({
      id: run.id,
      status: 'failed',
      retryCount: 5,
      maxRetries: 5,
      error: { code: 'network_error', message: '502 Upstream service temporarily unavailable', retryable: true }
    })
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(5)
    expect(events.filter((event) => event.type === 'run.failed')).toHaveLength(1)
    expect(events.map((event) => event.type)).not.toContain('run.succeeded')
  })

  it('marks a retryable stream interruption failed after retry budget is exhausted', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessions.save({ ...session, id: 'session-retry-exhausted' })

    const adapter = new AlwaysFailsRetryableAdapter()
    const runtime = new AgentRuntime({
      persistence,
      adapter,
      retryPolicy: {
        ...defaultRetryPolicy,
        maxRetries: 2,
        initialDelayMs: 1,
        backoffMultiplier: 1
      }
    })
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const run = await runtime.enqueue({ sessionId: 'session-retry-exhausted', prompt: 'will exhaust retries', modelId: 'mock/hesper-fast' })
    await runtime.waitForIdle('session-retry-exhausted')

    const storedRun = await persistence.runs.get(run.id)
    const runtimeEvents = await persistence.events.listByRun(run.id)
    expect(adapter.inputs).toHaveLength(3)
    expect(storedRun).toMatchObject({
      id: run.id,
      status: 'failed',
      retryCount: 2,
      maxRetries: 2,
      error: { code: 'stream_interrupted', message: 'stream disconnected', retryable: true }
    })
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(2)
    expect(events.filter((event) => event.type === 'run.failed')).toHaveLength(1)
    expect(runtimeEvents.map((event) => event.type)).toEqual([
      'run.created',
      'run.started',
      'run.retrying',
      'run.retrying',
      'run.failed'
    ])
    expect(runtimeEvents.map((event) => event.type)).not.toContain('run.succeeded')
    expect(await persistence.messages.listBySession('session-retry-exhausted')).toEqual([])
  })
})
