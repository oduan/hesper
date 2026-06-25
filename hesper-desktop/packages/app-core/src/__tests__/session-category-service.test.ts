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
    const alreadyDeleted = await sessions.createSession({ title: '已删除', categoryId: category.id, now })
    await sessions.deleteSession(alreadyDeleted.id)

    const result = await categories.deleteCategory(category.id)
    expect(result).toEqual({ category: renamed, deletedSessionIds: [deleted.id] })
    expect(result.deletedSessionIds).not.toContain(alreadyDeleted.id)
    await expect(persistence.sessions.get(deleted.id)).resolves.toMatchObject({ status: 'deleted' })
    await expect(persistence.sessions.get(alreadyDeleted.id)).resolves.toMatchObject({ status: 'deleted' })
    await expect(persistence.sessions.get(kept.id)).resolves.toMatchObject({ status: 'active' })
    await expect(persistence.sessionCategories.get(category.id)).resolves.toBeUndefined()
  })

  it('lists categories from persistence', async () => {
    const persistence = await createInMemoryPersistence()
    const categories = createSessionCategoryService(persistence)
    const product = { id: 'category-product', name: '产品图', createdAt: now, updatedAt: now }
    const avatar = { id: 'category-avatar', name: '头像', createdAt: now, updatedAt: now }
    await persistence.sessionCategories.save(product)
    await persistence.sessionCategories.save(avatar)

    await expect(categories.listCategories()).resolves.toEqual([product, avatar])
  })

  it('defaults blank category names to 新分类', async () => {
    const persistence = await createInMemoryPersistence()
    const categories = createSessionCategoryService(persistence)

    const category = await categories.createCategory({ name: '   ', now })
    const renamed = await categories.updateCategory({ id: category.id, name: '   ' })

    expect(category.name).toBe('新分类')
    expect(renamed.name).toBe('新分类')
  })

  it('rejects updates and deletes for missing categories', async () => {
    const persistence = await createInMemoryPersistence()
    const categories = createSessionCategoryService(persistence)

    await expect(categories.updateCategory({ id: 'missing', name: 'x' })).rejects.toThrow(
      'Session category not found: missing'
    )
    await expect(categories.deleteCategory('missing')).rejects.toThrow('Session category not found: missing')
  })
})
