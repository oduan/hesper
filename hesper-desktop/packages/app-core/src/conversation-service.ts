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

export function createConversationService(persistence: Persistence): ConversationService {
  return {
    async createUserMessage(input) {
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
      await persistence.events.append(event)
      return event
    }
  }
}
