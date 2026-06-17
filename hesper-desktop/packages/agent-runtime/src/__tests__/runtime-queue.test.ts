import type { AgentRuntimeEvent, Session } from '@hesper/shared'
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentPromptInput } from '../adapters'
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

type RuntimeInternals = {
  enqueueChains: Map<string, Promise<void>>
  sessionStates: Map<string, unknown>
  terminatedRuns: Map<string, unknown>
}

function getRuntimeInternals(runtime: AgentRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals
}

describe('AgentRuntime queue', () => {
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
      expect(storedRun?.status).toBe('succeeded')
      expect(runtimeEvents.map((event) => event.type)).toContain('run.succeeded')
      expect(runtimeEvents.map((event) => event.type)).not.toContain('run.failed')
      expect(consoleError).toHaveBeenCalledWith('AgentRuntime listener failed', listenerError)
    } finally {
      consoleError.mockRestore()
    }
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
    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error?.message).toBe('message write failed')
    expect(runtimeEvents.map((event) => event.type)).toContain('run.failed')
    expect(runtimeEvents.map((event) => event.type)).not.toContain('run.succeeded')
    expect(await persistence.messages.listBySession('session-compensated-run')).toEqual([])
    expect(getRuntimeInternals(runtime).terminatedRuns.size).toBe(0)
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
})
