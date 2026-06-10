import type { AgentRuntimeEvent, Session } from '@hesper/shared'
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
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

class RecordingAdapter implements AgentAdapter {
  readonly starts: string[] = []
  readonly finishes: string[] = []

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
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

describe('AgentRuntime queue', () => {
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
