import { createId, nowIso, type Session, type SessionCategory } from '@hesper/shared'
import type { Persistence } from '@hesper/persistence'
import { normalizeSessionTitle } from './session-service'

export type CreateSessionCategoryInput = {
  name: string
  defaultModelId?: string
  workspacePath?: string
  soul?: string
  soulOverrideEnabled?: boolean
  agents?: string
  agentsOverrideEnabled?: boolean
  now?: string
}

export type UpdateSessionCategoryInput = {
  id: string
  name?: string
  defaultModelId?: string
  workspacePath?: string
  soul?: string
  soulOverrideEnabled?: boolean
  agents?: string
  agentsOverrideEnabled?: boolean
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
        ...(input.defaultModelId !== undefined ? { defaultModelId: input.defaultModelId } : {}),
        ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {}),
        ...(input.soul !== undefined ? { soul: input.soul } : {}),
        soulOverrideEnabled: input.soulOverrideEnabled ?? false,
        agents: input.agents ?? '',
        agentsOverrideEnabled: input.agentsOverrideEnabled ?? false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      await persistence.sessionCategories.save(category)
      return category
    },
    async updateCategory(input) {
      const category = await persistence.sessionCategories.get(input.id)
      if (!category) throw missingCategoryError(input.id)
      const updated: SessionCategory = {
        ...category,
        ...(input.name !== undefined ? { name: normalizeCategoryName(input.name) } : {}),
        ...(input.defaultModelId !== undefined ? { defaultModelId: input.defaultModelId } : {}),
        ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {}),
        ...(input.soul !== undefined ? { soul: input.soul } : {}),
        ...(input.soulOverrideEnabled !== undefined ? { soulOverrideEnabled: input.soulOverrideEnabled } : {}),
        ...(input.agents !== undefined ? { agents: input.agents } : {}),
        ...(input.agentsOverrideEnabled !== undefined ? { agentsOverrideEnabled: input.agentsOverrideEnabled } : {}),
        updatedAt: nowIso()
      }
      await persistence.sessionCategories.save(updated)
      return updated
    },
    async deleteCategory(id) {
      return persistence.transaction(async () => {
        const category = await persistence.sessionCategories.get(id)
        if (!category) throw missingCategoryError(id)
        const deletedSessions: Session[] = (await persistence.sessions.listVisible())
          .filter((candidate) => candidate.categoryId === id)
        for (const session of deletedSessions) {
          await persistence.sessions.deleteGraph(session.id)
        }
        await persistence.sessionCategories.delete(id)
        return { category, deletedSessionIds: deletedSessions.map((session) => session.id) }
      })
    }
  }
}
