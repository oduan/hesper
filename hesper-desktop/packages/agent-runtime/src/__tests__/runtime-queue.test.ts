import type { AgentRuntimeEvent, MessageAttachment, Session } from '@hesper/shared'
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentPromptInput, AttachmentReader } from '../adapters'
import { MockAgentAdapter } from '../mock-adapter'
import { defaultRetryPolicy } from '../retry-policy'
import { AgentRuntime } from '../runtime'

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

type RuntimeInternals = {
  enqueueChains: Map<string, Promise<void>>
  sessionStates: Map<string, unknown>
  terminatedRuns: Map<string, unknown>
}

function getRuntimeInternals(runtime: AgentRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals
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
        id: `context-item-${run.id}-run-summary-v1`,
        kind: 'run_summary',
        runId: run.id
      })
    ])
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
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('filesystem.read-file')
    expect(secondHistory.map((message) => message.content).join('\n')).toContain('hello from readme')
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
        id: `context-item-${run.id}-run-summary-v1`,
        sessionId: 'session-context-item-success',
        runId: run.id,
        kind: 'run_summary',
        version: 1,
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
        id: `context-item-${run.id}-run-summary-v1`,
        sessionId: 'session-context-item-failed',
        runId: run.id,
        kind: 'run_summary'
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
