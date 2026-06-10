import type { AgentRuntimeEvent, Message } from '@hesper/shared'
import type { AgentAdapter, AgentPromptInput } from './adapters'

export type MockAgentAdapterOptions = {
  delayMs?: number
  failTimes?: number
  responsePrefix?: string
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MockAgentAdapter implements AgentAdapter {
  private readonly attemptsByRunId = new Map<string, number>()

  constructor(private readonly options: MockAgentAdapterOptions = {}) {}

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    const attempts = (this.attemptsByRunId.get(input.runId) ?? 0) + 1
    this.attemptsByRunId.set(input.runId, attempts)

    if (this.options.failTimes && attempts <= this.options.failTimes) {
      throw new Error('stream interrupted')
    }

    const createdAt = new Date().toISOString()
    await emit({
      type: 'step.created',
      step: {
        id: `step-${input.runId}-thought`,
        runId: input.runId,
        type: 'thought',
        status: 'succeeded',
        title: 'Mock thinking',
        summary: 'Generated deterministic mock response',
        createdAt,
        completedAt: createdAt
      }
    })

    const text = `${this.options.responsePrefix ?? 'Mock response for:'} ${input.prompt}`
    for (const char of text) {
      if (input.signal.aborted) {
        throw new Error('aborted')
      }
      await emit({ type: 'message.delta', runId: input.runId, delta: char })
      await sleep(this.options.delayMs ?? 0)
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

    await emit({ type: 'message.completed', message })
  }
}
