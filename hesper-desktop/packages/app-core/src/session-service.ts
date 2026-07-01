import { createId, nowIso, type OutputMode, type Session, type SessionStatus } from '@hesper/shared'
import type { Persistence } from '@hesper/persistence'

export type CreateSessionInput = {
  title?: string
  now?: string
  categoryId?: string
  workspacePath?: string
  defaultModelId?: string
  outputMode?: OutputMode
  soul?: string
}

export function normalizeSessionTitle(title: string | undefined, fallback: string): string {
  const normalized = title?.trim()
  return normalized ? normalized : fallback
}

function normalizeCategoryId(categoryId: string | undefined): string | undefined {
  const normalized = categoryId?.trim()
  return normalized ? normalized : undefined
}

export type SessionService = {
  createSession(input: CreateSessionInput): Promise<Session>
  getSession(id: string): Promise<Session>
  listSessions(): Promise<Session[]>
  updateTitle(id: string, title: string): Promise<Session>
  markUnreadCompleted(id: string, completedAt?: string): Promise<Session>
  markViewed(id: string): Promise<Session>
  setCategory(id: string, categoryId?: string): Promise<Session>
  setCategoryForSessions(ids: string[], categoryId?: string): Promise<Session[]>
  setWorkspacePath(id: string, workspacePath?: string): Promise<Session>
  setDefaultModel(id: string, defaultModelId?: string): Promise<Session>
  setOutputMode(id: string, outputMode: OutputMode): Promise<Session>
  archiveSession(id: string): Promise<Session>
  restoreSession(id: string): Promise<Session>
  setMarked(id: string, isMarked: boolean): Promise<Session>
  setMarkedForSessions(ids: string[], isMarked: boolean): Promise<Session[]>
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

async function assertCategoryExists(persistence: Persistence, categoryId?: string): Promise<void> {
  if (!categoryId) return
  const category = await persistence.sessionCategories.get(categoryId)
  if (!category) throw new Error(`Session category not found: ${categoryId}`)
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

async function saveSession(persistence: Persistence, session: Session, status: SessionStatus = session.status): Promise<Session> {
  const updated: Session = {
    ...session,
    status,
    updatedAt: nowIso()
  }
  await persistence.sessions.save(updated)
  return updated
}

export function createSessionService(persistence: Persistence): SessionService {
  return {
    async createSession(input) {
      const normalizedCategoryId = normalizeCategoryId(input.categoryId)
      await assertCategoryExists(persistence, normalizedCategoryId)
      const timestamp = input.now ?? nowIso()
      const session: Session = {
        id: createId('session'),
        title: normalizeSessionTitle(input.title, 'New chat'),
        status: 'active',
        outputMode: input.outputMode ?? 'markdown',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(normalizedCategoryId !== undefined ? { categoryId: normalizedCategoryId } : {}),
        ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {}),
        ...(input.defaultModelId !== undefined ? { defaultModelId: input.defaultModelId } : {}),
        ...(input.soul !== undefined ? { soul: input.soul } : {})
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
      const updated: Session = { ...session, title: normalizeSessionTitle(title, 'Untitled chat') }
      await persistence.sessions.save(updated)
      return updated
    },
    async markUnreadCompleted(id, completedAt) {
      const session = await loadSession(persistence, id)
      const timestamp = completedAt ?? nowIso()
      if (session.unreadCompletedAt && session.unreadCompletedAt >= timestamp) {
        return session
      }
      const updated: Session = { ...session, unreadCompletedAt: timestamp }
      await persistence.sessions.save(updated)
      return updated
    },
    async markViewed(id) {
      const session = await loadSession(persistence, id)
      if (!session.unreadCompletedAt) return session
      const { unreadCompletedAt: _unreadCompletedAt, ...updated } = session
      await persistence.sessions.save(updated)
      return updated
    },
    async setCategory(id, categoryId) {
      const normalizedCategoryId = normalizeCategoryId(categoryId)
      await assertCategoryExists(persistence, normalizedCategoryId)
      const session = await loadSession(persistence, id)
      const candidate = { ...session, categoryId: normalizedCategoryId }
      const updated = stripUndefined(candidate) as Session
      await persistence.sessions.save(updated)
      return updated
    },
    async setCategoryForSessions(ids, categoryId) {
      return persistence.transaction(async () => {
        const normalizedCategoryId = normalizeCategoryId(categoryId)
        await assertCategoryExists(persistence, normalizedCategoryId)
        const loadedSessions: Session[] = []
        for (const id of ids) {
          loadedSessions.push(await loadSession(persistence, id))
        }
        const updated = loadedSessions.map((session) => {
          const candidate = { ...session, categoryId: normalizedCategoryId }
          return stripUndefined(candidate) as Session
        })
        for (const session of updated) {
          await persistence.sessions.save(session)
        }
        return updated
      })
    },
    async setWorkspacePath(id, workspacePath) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, {
        ...session,
        ...(workspacePath !== undefined ? { workspacePath } : {})
      })
    },
    async setDefaultModel(id, defaultModelId) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, {
        ...session,
        ...(defaultModelId !== undefined ? { defaultModelId } : {})
      })
    },
    async setOutputMode(id, outputMode) {
      const session = await loadSession(persistence, id)
      return saveSession(persistence, { ...session, outputMode } satisfies Session)
    },
    async archiveSession(id) {
      const session = await loadSession(persistence, id)
      const updated: Session = { ...session, status: 'archived' }
      await persistence.sessions.save(updated)
      return updated
    },
    async restoreSession(id) {
      const session = await loadSession(persistence, id)
      const updated: Session = { ...session, status: 'active' }
      await persistence.sessions.save(updated)
      return updated
    },
    async setMarked(id, isMarked) {
      const session = await loadSession(persistence, id)
      const candidate = { ...session, isMarked: isMarked ? true : undefined }
      const updated = stripUndefined(candidate) as Session
      await persistence.sessions.save(updated)
      return updated
    },
    async setMarkedForSessions(ids, isMarked) {
      return persistence.transaction(async () => {
        const loadedSessions: Session[] = []
        for (const id of ids) {
          loadedSessions.push(await loadSession(persistence, id))
        }
        const updated = loadedSessions.map((session) => stripUndefined({
          ...session,
          isMarked: isMarked ? true : undefined
        }) as Session)
        for (const session of updated) {
          await persistence.sessions.save(session)
        }
        return updated
      })
    },
    async deleteSession(id) {
      const session = await loadSession(persistence, id)
      const deleted: Session = { ...session, status: 'deleted', updatedAt: nowIso() }
      await persistence.sessions.deleteGraph(id)
      return deleted
    }
  }
}
