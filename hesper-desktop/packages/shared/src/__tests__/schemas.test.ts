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
