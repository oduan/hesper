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

    await persistence.runs.save({
      id: 'run-1',
      sessionId: session.id,
      status: 'running',
      modelId: 'mock/model',
      retryCount: 0,
      maxRetries: 5
    })
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
})
