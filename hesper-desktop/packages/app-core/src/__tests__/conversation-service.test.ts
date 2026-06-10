import { describe, expect, it } from 'vitest'
import { createInMemoryPersistence } from '@hesper/persistence'
import { createConversationService } from '../conversation-service'
import { createSessionService } from '../session-service'

const now = '2026-06-10T05:00:00.000Z'

describe('createConversationService', () => {
  it('writes messages, lists runs/steps and stores runtime events', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)
    const conversation = createConversationService(persistence)

    const session = await sessions.createSession({ title: 'Chat', now })
    const run = await persistence.runs.save({
      id: 'run-1',
      sessionId: session.id,
      status: 'running',
      modelId: 'mock/model',
      retryCount: 0,
      maxRetries: 5
    })
    const userMessage = await conversation.createUserMessage({
      sessionId: session.id,
      content: 'Hello',
      now
    })
    const assistantMessage = await conversation.createAssistantMessage({
      sessionId: session.id,
      runId: 'run-1',
      content: 'Hi',
      contentType: 'markdown',
      now
    })

    expect((await conversation.listMessages(session.id)).map((message) => message.id)).toEqual([
      userMessage.id,
      assistantMessage.id
    ])

    await persistence.steps.save({
      id: 'step-1',
      runId: 'run-1',
      type: 'thought',
      status: 'running',
      title: 'Thinking',
      createdAt: now
    })
    await persistence.events.append({ type: 'run.started', runId: 'run-1' })

    expect((await conversation.listRuns(session.id)).map((run) => run.id)).toEqual(['run-1'])
    expect((await conversation.listSteps('run-1')).map((step) => step.id)).toEqual(['step-1'])
    expect((await conversation.appendRuntimeEvent({ type: 'run.succeeded', runId: 'run-1' })).type).toBe('run.succeeded')
  })

  it('uses the provided user message id when persisting optimistic-correlated messages', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)
    const conversation = createConversationService(persistence)
    const session = await sessions.createSession({ title: 'Chat', now })

    const message = await conversation.createUserMessage({
      id: 'message-client-1',
      sessionId: session.id,
      content: 'Hello',
      now
    })

    expect(message.id).toBe('message-client-1')
    expect(await conversation.listMessages(session.id)).toEqual([
      expect.objectContaining({ id: 'message-client-1', content: 'Hello' })
    ])
  })

  it('rejects messages for missing sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const conversation = createConversationService(persistence)

    await expect(conversation.createUserMessage({ sessionId: 'missing', content: 'Hello' })).rejects.toThrow('Session not found: missing')
  })

  it('rejects runtime events for missing runs', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)
    const conversation = createConversationService(persistence)
    const session = await sessions.createSession({ title: 'Chat', now })

    await expect(conversation.appendRuntimeEvent({ type: 'run.created', run: { id: 'missing-run', sessionId: session.id, status: 'queued' as const, modelId: 'mock/model', retryCount: 0, maxRetries: 5 } })).rejects.toThrow('Run not found: missing-run')
  })

  it('accepts run.created when run already exists', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)
    const conversation = createConversationService(persistence)
    const session = await sessions.createSession({ title: 'Chat', now })
    const run = { id: 'run-ok', sessionId: session.id, status: 'queued' as const, modelId: 'mock/model', retryCount: 0, maxRetries: 5 }
    await persistence.runs.save(run)

    await expect(conversation.appendRuntimeEvent({ type: 'run.created', run })).resolves.toMatchObject({ type: 'run.created' })
  })
})
