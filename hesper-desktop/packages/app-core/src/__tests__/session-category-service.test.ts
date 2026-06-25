import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { createSessionCategoryService } from '../session-category-service'
import { createSessionService } from '../session-service'

const now = '2026-06-26T00:00:00.000Z'

describe('session category service', () => {
  it('creates, renames, and deletes categories with their sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const categories = createSessionCategoryService(persistence)
    const sessions = createSessionService(persistence)

    const category = await categories.createCategory({ name: ' 产品图 ', now })
    expect(category).toMatchObject({ name: '产品图' })

    const renamed = await categories.updateCategory({ id: category.id, name: '头像' })
    expect(renamed.name).toBe('头像')

    const kept = await sessions.createSession({ title: '未分类', now })
    const deleted = await sessions.createSession({ title: '分类内', categoryId: category.id, now })

    const result = await categories.deleteCategory(category.id)
    expect(result).toEqual({ category: renamed, deletedSessionIds: [deleted.id] })
    await expect(persistence.sessions.get(deleted.id)).resolves.toMatchObject({ status: 'deleted' })
    await expect(persistence.sessions.get(kept.id)).resolves.toMatchObject({ status: 'active' })
    await expect(persistence.sessionCategories.get(category.id)).resolves.toBeUndefined()
  })
})
