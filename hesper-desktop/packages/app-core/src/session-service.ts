import { createId, nowIso, type OutputMode, type Session, type SessionStatus } from '@hesper/shared'
import type { Persistence } from '@hesper/persistence'

export type CreateSessionInput = {
  title?: string
  now?: string
  workspacePath?: string
  defaultModelId?: string
  outputMode?: OutputMode
}

export type SessionService = {
  createSession(input: CreateSessionInput): Promise<Session>
  getSession(id: string): Promise<Session>
  listSessions(): Promise<Session[]>
  updateTitle(id: string, title: string): Promise<Session>
  setWorkspacePath(id: string, workspacePath?: string): Promise<Session>
  setDefaultModel(id: string, defaultModelId?: string): Promise<Session>
  setOutputMode(id: string, outputMode: OutputMode): Promise<Session>
  archiveSession(id: string): Promise<Session>
  deleteSession(id: string): Promise<Session>
}

function createMissingSessionError(id: string): Error {
  return new Error(`Session not found: ${id}`)
}

async function loadSession(persistence: Persistence, id: string): Promise<Session> {
  const session = await persistence.sessions.get(id)
  if (!session || session.status === 'deleted') throw createMissingSessionError(id)
  return session
}

async function saveSession(persistence: Persistence, session: Session, status: SessionStatus = session.status): Promise<Session> {
  const updated = {
    id: session.id,
    title: session.title,
    status,
    outputMode: session.outputMode,
    createdAt: session.createdAt,
    updatedAt: nowIso(),
    ...(session.workspacePath !== undefined ? { workspacePath: session.workspacePath } : {}),
    ...(session.defaultModelId !== undefined ? { defaultModelId: session.defaultModelId } : {})
  } satisfies Session
  await persistence.sessions.save(updated)
  return updated
}

export function createSessionService(persistence: Persistence): SessionService {
  return {
    async createSession(input) {
      const timestamp = input.now ?? nowIso()
      const session: Session = {
        id: createId('session'),
        title: input.title ?? 'New chat',
        status: 'active',
        outputMode: input.outputMode ?? 'markdown',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {}),
        ...(input.defaultModelId !== undefined ? { defaultModelId: input.defaultModelId } : {})
      }
      await persistence.sessions.save(session)
      return session
    },
    async getSession(id) {
      return loadSession(persistence, id)
    },
    async listSessions() {
      return persistence.sessions.listVisible()
    },
    async updateTitle(id, title) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, { ...session, title } satisfies Session)
    },
    async setWorkspacePath(id, workspacePath) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, {
        id: session.id,
        title: session.title,
        status: session.status,
        outputMode: session.outputMode,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(workspacePath !== undefined ? { workspacePath } : {}),
        ...(session.defaultModelId !== undefined ? { defaultModelId: session.defaultModelId } : {})
      } satisfies Session)
    },
    async setDefaultModel(id, defaultModelId) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, {
        id: session.id,
        title: session.title,
        status: session.status,
        outputMode: session.outputMode,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(session.workspacePath !== undefined ? { workspacePath: session.workspacePath } : {}),
        ...(defaultModelId !== undefined ? { defaultModelId } : {})
      } satisfies Session)
    },
    async setOutputMode(id, outputMode) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, { ...session, outputMode } satisfies Session)
    },
    async archiveSession(id) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, session, 'archived')
    },
    async deleteSession(id) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, session, 'deleted')
    }
  }
}
