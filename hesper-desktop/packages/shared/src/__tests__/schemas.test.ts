import { describe, expect, it } from 'vitest'
import { agentRuntimeEventSchema, agentRunSchema, runStepSchema, sessionSchema } from '../schemas'

describe('shared schemas', () => {
  it('validates an agent run', () => {
    const parsed = agentRunSchema.parse({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'running',
      modelId: 'model-1',
      retryCount: 0,
      maxRetries: 3
    })

    expect(parsed.status).toBe('running')
  })

  it('validates a run step', () => {
    const parsed = runStepSchema.parse({
      id: 'step-1',
      runId: 'run-1',
      type: 'tool_call',
      status: 'pending',
      title: 'Call tool',
      createdAt: '2026-06-10T03:00:00.000Z'
    })

    expect(parsed.type).toBe('tool_call')
  })

  it('parses run.failed events', () => {
    const parsed = agentRuntimeEventSchema.parse({
      type: 'run.failed',
      runId: 'run-1',
      error: { code: 'tool_error', message: 'boom', retryable: false }
    })

    expect(parsed.type).toBe('run.failed')
  })

  it('parses run.created events', () => {
    const parsed = agentRuntimeEventSchema.parse({
      type: 'run.created',
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        status: 'queued',
        modelId: 'model-1',
        retryCount: 0,
        maxRetries: 3
      }
    })

    expect(parsed.type).toBe('run.created')
  })

  it('normalizes explicit undefined optional fields', () => {
    const parsed = sessionSchema.parse({
      id: 'session-1',
      title: 'Build hesper',
      status: 'active',
      workspacePath: undefined,
      defaultModelId: undefined,
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:00.000Z',
      updatedAt: '2026-06-10T03:00:00.000Z'
    })

    expect('workspacePath' in parsed).toBe(false)
    expect('defaultModelId' in parsed).toBe(false)
  })
})
