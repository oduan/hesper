import { createId, nowIso, type Session, type SessionCategory } from '@hesper/shared'
import type { Persistence } from '@hesper/persistence'
import { normalizeSessionTitle } from './session-service'

export type CreateSessionCategoryInput = {
  name: string
  now?: string
}

export type UpdateSessionCategoryInput = {
  id: string
  name: string
}

export type DeleteSessionCategoryResult = {
  category: SessionCategory
  deletedSessionIds: string[]
}

export type SessionCategoryService = {
  listCategories(): Promise<SessionCategory[]>
  createCategory(input: CreateSessionCategoryInput): Promise<SessionCategory>
  updateCategory(input: UpdateSessionCategoryInput): Promise<SessionCategory>
  deleteCategory(id: string): Promise<DeleteSessionCategoryResult>
}

function normalizeCategoryName(name: string): string {
  return normalizeSessionTitle(name, '新分类')
}

function missingCategoryError(id: string): Error {
  return new Error(`Session category not found: ${id}`)
}

export function createSessionCategoryService(persistence: Persistence): SessionCategoryService {
  return {
    listCategories() {
      return persistence.sessionCategories.list()
    },
    async createCategory(input) {
      const timestamp = input.now ?? nowIso()
      const category: SessionCategory = {
        id: createId('session-category'),
        name: normalizeCategoryName(input.name),
        createdAt: timestamp,
        updatedAt: timestamp
      }
      await persistence.sessionCategories.save(category)
      return category
    },
    async updateCategory(input) {
      const category = await persistence.sessionCategories.get(input.id)
      if (!category) throw missingCategoryError(input.id)
      const updated: SessionCategory = { ...category, name: normalizeCategoryName(input.name), updatedAt: nowIso() }
      await persistence.sessionCategories.save(updated)
      return updated
    },
    async deleteCategory(id) {
      return persistence.transaction(async () => {
        const category = await persistence.sessionCategories.get(id)
        if (!category) throw missingCategoryError(id)
        const visibleSessions = await persistence.sessions.listVisible()
        const deletedSessions: Session[] = visibleSessions
          .filter((candidate) => candidate.status !== 'deleted' && candidate.categoryId === id)
          .map((session) => ({ ...session, status: 'deleted', updatedAt: nowIso() }))
        for (const session of deletedSessions) {
          await persistence.sessions.save(session)
        }
        await persistence.sessionCategories.delete(id)
        return { category, deletedSessionIds: deletedSessions.map((session) => session.id) }
      })
    }
  }
}
