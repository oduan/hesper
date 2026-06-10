import { describe, expect, it } from 'vitest'
import { createFilePersistence, createInMemoryPersistence, exportDatabaseBytes } from '../database'

const now = '2026-06-10T03:00:00.000Z'

describe('persistence repositories', () => {
  it('creates and lists sessions without deleted sessions', async () => {
    const db = await createInMemoryPersistence()
    await db.sessions.save({ id: 'session-1', title: 'Build hesper', status: 'active', outputMode: 'markdown', createdAt: now, updatedAt: now })
    await db.sessions.save({ id: 'session-2', title: 'Deleted session', status: 'deleted', outputMode: 'html', createdAt: now, updatedAt: now })
    expect(await db.sessions.listVisible()).toHaveLength(1)
  })

  it('persists runtime events across all event shapes', async () => {
    const db = await createInMemoryPersistence()
    await db.runs.save({ id: 'run-1', sessionId: 'session-1', status: 'queued', modelId: 'mock', retryCount: 0, maxRetries: 5 })
    await db.steps.save({ id: 'step-1', runId: 'run-1', type: 'thought', status: 'succeeded', title: 'Thinking', createdAt: now })
    await db.messages.save({ id: 'message-1', sessionId: 'session-1', role: 'assistant', content: 'ok', contentType: 'plain', runId: 'run-1', createdAt: now })
    await db.events.append({ type: 'step.created', step: { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'running', title: 'Call', createdAt: now } })
    await db.events.append({ type: 'step.updated', step: { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'succeeded', title: 'Call', createdAt: now } })
    await db.events.append({ type: 'message.completed', message: { id: 'message-2', sessionId: 'session-1', role: 'assistant', content: 'done', contentType: 'plain', runId: 'run-1', createdAt: now } })
    await db.events.append({ type: 'run.failed', runId: 'run-1', error: { code: 'unknown', message: 'boom', retryable: false } })
    expect(await db.events.listByRun('run-1')).toHaveLength(4)
  })

  it('exports and reopens file persistence', async () => {
    const db = await createInMemoryPersistence()
    await db.sessions.save({ id: 'session-1', title: 'Build hesper', status: 'active', outputMode: 'markdown', createdAt: now, updatedAt: now })
    const bytes = exportDatabaseBytes(db)
    expect(bytes).toBeInstanceOf(Uint8Array)
    const reopened = await createFilePersistence('ignored')
    await reopened.sessions.save({ id: 'session-1', title: 'Build hesper', status: 'active', outputMode: 'markdown', createdAt: now, updatedAt: now })
    expect(await reopened.sessions.get('session-1')).toBeTruthy()
  })

  it('keeps insertion order stable after updates', async () => {
    const db = await createInMemoryPersistence()
    await db.runs.save({ id: 'run-1', sessionId: 'session-1', status: 'queued', modelId: 'm1', retryCount: 0, maxRetries: 5 })
    await db.runs.save({ id: 'run-2', sessionId: 'session-1', status: 'queued', modelId: 'm2', retryCount: 0, maxRetries: 5 })
    await db.runs.save({ id: 'run-1', sessionId: 'session-1', status: 'running', modelId: 'm1', retryCount: 0, maxRetries: 5 })
    expect((await db.runs.listBySession('session-1')).map((run) => run.id)).toEqual(['run-1', 'run-2'])
  })
})
