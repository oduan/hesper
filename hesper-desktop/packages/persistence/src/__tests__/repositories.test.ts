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
