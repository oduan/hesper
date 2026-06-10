import { createId, nowIso, type AgentRuntimeEvent, type Message, type MessageContentType, type RunStep } from '@hesper/shared'
import type { Persistence } from '@hesper/persistence'

export type CreateUserMessageInput = {
  sessionId: string
  content: string
  now?: string
}

export type CreateAssistantMessageInput = {
  sessionId: string
  runId: string
  content: string
  contentType: MessageContentType
  now?: string
}

export type ConversationService = {
  createUserMessage(input: CreateUserMessageInput): Promise<Message>
  createAssistantMessage(input: CreateAssistantMessageInput): Promise<Message>
  listMessages(sessionId: string): Promise<Message[]>
  listRuns(sessionId: string): Promise<Awaited<ReturnType<Persistence['runs']['listBySession']>>>
  listSteps(runId: string): Promise<RunStep[]>
  appendRuntimeEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent>
}

function createNotFoundError(entity: string, id: string): Error {
  return new Error(`${entity} not found: ${id}`)
}

async function ensureSessionExists(persistence: Persistence, sessionId: string): Promise<void> {
  const session = await persistence.sessions.get(sessionId)
  if (!session || session.status === 'deleted') throw createNotFoundError('Session', sessionId)
}

async function ensureRunExists(persistence: Persistence, runId: string): Promise<void> {
  const run = await persistence.runs.get(runId)
  if (!run) throw createNotFoundError('Run', runId)
}

export function createConversationService(persistence: Persistence): ConversationService {
  return {
    async createUserMessage(input) {
      await ensureSessionExists(persistence, input.sessionId)
      const message: Message = {
        id: createId('message'),
        sessionId: input.sessionId,
        role: 'user',
        content: input.content,
        contentType: 'plain',
        createdAt: input.now ?? nowIso()
      }
      await persistence.messages.save(message)
      return message
    },
    async createAssistantMessage(input) {
      await ensureSessionExists(persistence, input.sessionId)
      await ensureRunExists(persistence, input.runId)
      const message: Message = {
        id: createId('message'),
        sessionId: input.sessionId,
        role: 'assistant',
        content: input.content,
        contentType: input.contentType,
        runId: input.runId,
        createdAt: input.now ?? nowIso()
      }
      await persistence.messages.save(message)
      return message
    },
    async listMessages(sessionId) {
      return persistence.messages.listBySession(sessionId)
    },
    async listRuns(sessionId) {
      return persistence.runs.listBySession(sessionId)
    },
    async listSteps(runId) {
      return persistence.steps.listByRun(runId)
    },
    async appendRuntimeEvent(event) {
      if (event.type === 'run.created') {
        await ensureSessionExists(persistence, event.run.sessionId)
      }
      if (event.type === 'run.started' || event.type === 'run.retrying' || event.type === 'run.failed' || event.type === 'run.succeeded' || event.type === 'message.delta') {
        await ensureRunExists(persistence, event.runId)
      }
      if (event.type === 'step.created' || event.type === 'step.updated') {
        await ensureRunExists(persistence, event.step.runId)
      }
      if (event.type === 'message.completed') {
        await ensureSessionExists(persistence, event.message.sessionId)
        if (!event.message.runId) throw createNotFoundError('Run', 'unknown')
        await ensureRunExists(persistence, event.message.runId)
      }
      await persistence.events.append(event)
      return event
    }
  }
}
