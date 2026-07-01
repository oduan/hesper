import { describe, expect, it } from 'vitest'
import { createInMemoryPersistence } from '@hesper/persistence'
import { createSessionService } from '../session-service'

const now = '2026-06-10T05:00:00.000Z'

describe('createSessionService', () => {
  it('creates and moves sessions between categories', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessionCategories.save({ id: 'category-product', name: '产品图', createdAt: now, updatedAt: now })
    await persistence.sessionCategories.save({ id: 'category-avatar', name: '头像', createdAt: now, updatedAt: now })
    const sessions = createSessionService(persistence)

    const created = await sessions.createSession({ title: '分类会话', categoryId: 'category-product', now })
    expect(created.categoryId).toBe('category-product')

    const avatarCategorized = await sessions.setCategory(created.id, 'category-avatar')
    expect(avatarCategorized).toMatchObject({ categoryId: 'category-avatar', updatedAt: created.updatedAt })

    const uncategorized = await sessions.setCategory(created.id, undefined)
    expect(uncategorized.updatedAt).toBe(created.updatedAt)
    expect(uncategorized).not.toHaveProperty('categoryId')
    await expect(persistence.sessions.get(created.id)).resolves.not.toHaveProperty('categoryId')

    await sessions.setCategory(created.id, 'category-product')
    const clearedWithBlank = await sessions.setCategory(created.id, '')
    expect(clearedWithBlank.updatedAt).toBe(created.updatedAt)
    expect(clearedWithBlank).not.toHaveProperty('categoryId')
    await expect(persistence.sessions.get(created.id)).resolves.not.toHaveProperty('categoryId')

    await sessions.setCategory(created.id, 'category-product')
    const batch = await sessions.setCategoryForSessions([created.id], undefined)
    expect(batch[0]?.updatedAt).toBe(created.updatedAt)
    expect(batch[0]).not.toHaveProperty('categoryId')
    await expect(persistence.sessions.get(created.id)).resolves.not.toHaveProperty('categoryId')
  })

  it('persists session soul only when provided at creation time', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)

    const withSoul = await sessions.createSession({ title: 'With soul', soul: 'Focused assistant behavior', now })
    const withoutSoul = await sessions.createSession({ title: 'Without soul', now })

    expect(withSoul.soul).toBe('Focused assistant behavior')
    await expect(persistence.sessions.get(withSoul.id)).resolves.toMatchObject({ soul: 'Focused assistant behavior' })
    expect(withoutSoul.soul).toBeUndefined()
    await expect(persistence.sessions.get(withoutSoul.id)).resolves.not.toHaveProperty('soul')
  })

  it('normalizes blank category ids to uncategorized sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)

    const createdWithEmpty = await sessions.createSession({ title: '空分类', categoryId: '', now })
    const createdWithBlank = await sessions.createSession({ title: '空白分类', categoryId: '   ', now })

    expect(createdWithEmpty).not.toHaveProperty('categoryId')
    expect(createdWithBlank).not.toHaveProperty('categoryId')
    await expect(persistence.sessions.get(createdWithEmpty.id)).resolves.not.toHaveProperty('categoryId')
    await expect(persistence.sessions.get(createdWithBlank.id)).resolves.not.toHaveProperty('categoryId')
  })

  it('updates multiple session categories only after validating every session', async () => {
    const persistence = await createInMemoryPersistence()
    await persistence.sessionCategories.save({ id: 'category-source', name: '原分类', createdAt: now, updatedAt: now })
    await persistence.sessionCategories.save({ id: 'category-target', name: '目标分类', createdAt: now, updatedAt: now })
    const sessions = createSessionService(persistence)

    const first = await sessions.createSession({ title: 'First', categoryId: 'category-source', now })
    const second = await sessions.createSession({ title: 'Second', categoryId: 'category-source', now })

    await expect(sessions.setCategoryForSessions([first.id, 'missing-session'], 'category-target')).rejects.toThrow(
      'Session not found: missing-session'
    )
    await expect(persistence.sessions.get(first.id)).resolves.toMatchObject({ categoryId: 'category-source' })

    const moved = await sessions.setCategoryForSessions([first.id, second.id], 'category-target')
    expect(moved.map((session) => session.categoryId)).toEqual(['category-target', 'category-target'])
    expect(moved.map((session) => session.updatedAt)).toEqual([first.updatedAt, second.updatedAt])
    await expect(persistence.sessions.get(first.id)).resolves.toMatchObject({ categoryId: 'category-target' })
    await expect(persistence.sessions.get(second.id)).resolves.toMatchObject({ categoryId: 'category-target' })
  })

  it('rejects missing session categories', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)

    await expect(sessions.createSession({ title: 'Missing', categoryId: 'missing-category', now })).rejects.toThrow(
      'Session category not found: missing-category'
    )

    const created = await sessions.createSession({ title: '分类会话', now })
    await expect(sessions.setCategory(created.id, 'missing-category')).rejects.toThrow(
      'Session category not found: missing-category'
    )
    await expect(sessions.setCategoryForSessions([created.id], 'missing-category')).rejects.toThrow(
      'Session category not found: missing-category'
    )
  })

  it('preserves session config fields across title, workspace, model, output mode and archive updates', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const session = {
      id: 'session-config',
      title: 'Build hesper',
      status: 'active' as const,
      workspacePath: 'C:/workspace',
      defaultModelId: 'mock/model-default',
      providerId: 'provider-deepseek',
      modelId: 'deepseek-chat',
      roleId: 'coding',
      enabledSkillIds: ['skill-review'],
      enabledToolIds: ['filesystem.read-file', 'agent.spawn-worker-agent'],
      allowedWorkerAgentRoleIds: ['reviewer'],
      maxWorkerAgentDepth: 2,
      maxWorkerAgentsPerRun: 4,
      outputMode: 'markdown' as const,
      createdAt: now,
      updatedAt: now
    }
    await persistence.sessions.save(session)

    const renamed = await service.updateTitle(session.id, 'Updated')
    expect(renamed.updatedAt).toBe(session.updatedAt)
    expect(renamed).toMatchObject({
      title: 'Updated',
      workspacePath: session.workspacePath,
      defaultModelId: session.defaultModelId,
      providerId: session.providerId,
      modelId: session.modelId,
      roleId: session.roleId,
      enabledSkillIds: session.enabledSkillIds,
      enabledToolIds: session.enabledToolIds,
      allowedWorkerAgentRoleIds: session.allowedWorkerAgentRoleIds,
      maxWorkerAgentDepth: session.maxWorkerAgentDepth,
      maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun,
      outputMode: session.outputMode,
      status: 'active'
    })

    const moved = await service.setWorkspacePath(session.id, 'D:/workspace')
    expect(moved).toMatchObject({
      workspacePath: 'D:/workspace',
      defaultModelId: session.defaultModelId,
      providerId: session.providerId,
      modelId: session.modelId,
      roleId: session.roleId,
      enabledSkillIds: session.enabledSkillIds,
      enabledToolIds: session.enabledToolIds,
      allowedWorkerAgentRoleIds: session.allowedWorkerAgentRoleIds,
      maxWorkerAgentDepth: session.maxWorkerAgentDepth,
      maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun,
      outputMode: session.outputMode,
      title: 'Updated'
    })

    const modeled = await service.setDefaultModel(session.id, 'mock/model-updated')
    expect(modeled).toMatchObject({
      workspacePath: 'D:/workspace',
      defaultModelId: 'mock/model-updated',
      providerId: session.providerId,
      modelId: session.modelId,
      roleId: session.roleId,
      enabledSkillIds: session.enabledSkillIds,
      enabledToolIds: session.enabledToolIds,
      allowedWorkerAgentRoleIds: session.allowedWorkerAgentRoleIds,
      maxWorkerAgentDepth: session.maxWorkerAgentDepth,
      maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun,
      outputMode: session.outputMode,
      title: 'Updated'
    })

    const outputMode = await service.setOutputMode(session.id, 'html')
    expect(outputMode).toMatchObject({
      workspacePath: 'D:/workspace',
      defaultModelId: 'mock/model-updated',
      providerId: session.providerId,
      modelId: session.modelId,
      roleId: session.roleId,
      enabledSkillIds: session.enabledSkillIds,
      enabledToolIds: session.enabledToolIds,
      allowedWorkerAgentRoleIds: session.allowedWorkerAgentRoleIds,
      maxWorkerAgentDepth: session.maxWorkerAgentDepth,
      maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun,
      outputMode: 'html',
      title: 'Updated'
    })

    const archived = await service.archiveSession(session.id)
    expect(archived).toMatchObject({
      title: 'Updated',
      workspacePath: 'D:/workspace',
      defaultModelId: 'mock/model-updated',
      providerId: session.providerId,
      modelId: session.modelId,
      roleId: session.roleId,
      enabledSkillIds: session.enabledSkillIds,
      enabledToolIds: session.enabledToolIds,
      allowedWorkerAgentRoleIds: session.allowedWorkerAgentRoleIds,
      maxWorkerAgentDepth: session.maxWorkerAgentDepth,
      maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun,
      outputMode: 'html',
      status: 'archived'
    })

    const persisted = await service.getSession(session.id)
    expect(persisted.updatedAt).toBe(archived.updatedAt)
    expect(persisted).toMatchObject({
      providerId: session.providerId,
      modelId: session.modelId,
      roleId: session.roleId,
      enabledSkillIds: session.enabledSkillIds,
      enabledToolIds: session.enabledToolIds,
      allowedWorkerAgentRoleIds: session.allowedWorkerAgentRoleIds,
      maxWorkerAgentDepth: session.maxWorkerAgentDepth,
      maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun
    })
  })

  it('keeps workspace and model unchanged when setWorkspacePath and setDefaultModel receive undefined', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const session = {
      id: 'session-undefined',
      title: 'Build hesper',
      status: 'active' as const,
      workspacePath: 'C:/workspace',
      defaultModelId: 'mock/model-default',
      outputMode: 'markdown' as const,
      createdAt: now,
      updatedAt: now
    }
    await persistence.sessions.save(session)

    const workspaceUnchanged = await service.setWorkspacePath(session.id, undefined)
    const modelUnchanged = await service.setDefaultModel(session.id, undefined)

    expect(workspaceUnchanged).toMatchObject({
      workspacePath: 'C:/workspace',
      defaultModelId: 'mock/model-default'
    })
    expect(modelUnchanged).toMatchObject({
      workspacePath: 'C:/workspace',
      defaultModelId: 'mock/model-default'
    })
  })

  it('marks sessions and restores archived sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const sessions = createSessionService(persistence)

    const first = await sessions.createSession({ title: 'First', now })
    const second = await sessions.createSession({ title: 'Second', now })

    const firstMarked = await sessions.setMarked(first.id, true)
    expect(firstMarked).toMatchObject({ id: first.id, isMarked: true, updatedAt: first.updatedAt })
    await expect(persistence.sessions.get(first.id)).resolves.toMatchObject({ isMarked: true, updatedAt: first.updatedAt })

    const markedBatch = await sessions.setMarkedForSessions([first.id, second.id], true)
    expect(markedBatch.map((session) => session.isMarked)).toEqual([true, true])
    expect(markedBatch.map((session) => session.updatedAt)).toEqual([first.updatedAt, second.updatedAt])

    const unmarkedBatch = await sessions.setMarkedForSessions([first.id, second.id], false)
    expect(unmarkedBatch.map((session) => session.isMarked)).toEqual([undefined, undefined])
    expect(unmarkedBatch.map((session) => session.updatedAt)).toEqual([first.updatedAt, second.updatedAt])
    await expect(persistence.sessions.get(first.id)).resolves.not.toHaveProperty('isMarked')

    const archived = await sessions.archiveSession(first.id)
    expect(archived).toMatchObject({ status: 'archived', updatedAt: first.updatedAt })
    await expect(sessions.restoreSession(first.id)).resolves.toMatchObject({ id: first.id, status: 'active', updatedAt: first.updatedAt })
  })

  it('creates, updates, archives and deletes sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const created = await service.createSession({ title: 'First', now })
    expect(created).toMatchObject({
      title: 'First',
      status: 'active',
      outputMode: 'markdown'
    })

    await service.updateTitle(created.id, 'Updated')
    await service.setWorkspacePath(created.id, 'C:/workspace')
    await service.setDefaultModel(created.id, 'mock/model')
    await service.setOutputMode(created.id, 'html')
    await service.archiveSession(created.id)

    const archived = await service.getSession(created.id)
    expect(archived).toMatchObject({
      title: 'Updated',
      workspacePath: 'C:/workspace',
      defaultModelId: 'mock/model',
      outputMode: 'html',
      status: 'archived'
    })

    const deleted = await service.deleteSession(created.id)
    expect(deleted).toMatchObject({ id: created.id, status: 'deleted' })
    await expect(service.getSession(created.id)).rejects.toThrow(`Session not found: ${created.id}`)
    await expect(persistence.sessions.get(created.id)).resolves.toBeUndefined()
  })

  it('defaults createSession title to New chat and trims blank titles', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const createdDefault = await service.createSession({})
    const createdBlank = await service.createSession({ title: '   ' })

    expect(createdDefault.title).toBe('New chat')
    expect(createdBlank.title).toBe('New chat')
  })

  it('normalizes blank updates to Untitled chat', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const created = await service.createSession({ title: 'Named' })
    const updated = await service.updateTitle(created.id, '   ')

    expect(updated.title).toBe('Untitled chat')
    expect(updated.updatedAt).toBe(created.updatedAt)
  })

  it('persists unread completion markers until a session is viewed without refreshing updatedAt', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)
    const created = await service.createSession({ title: 'Unread', now })

    const firstUnreadAt = '2026-06-10T05:01:00.000Z'
    const olderUnreadAt = '2026-06-10T05:00:30.000Z'
    const newerUnreadAt = '2026-06-10T05:02:00.000Z'
    const marked = await service.markUnreadCompleted(created.id, firstUnreadAt)
    expect(marked.unreadCompletedAt).toBe(firstUnreadAt)
    expect(marked.updatedAt).toBe(created.updatedAt)

    const olderIgnored = await service.markUnreadCompleted(created.id, olderUnreadAt)
    expect(olderIgnored.unreadCompletedAt).toBe(firstUnreadAt)
    expect(olderIgnored.updatedAt).toBe(created.updatedAt)

    const newerMarked = await service.markUnreadCompleted(created.id, newerUnreadAt)
    expect(newerMarked.unreadCompletedAt).toBe(newerUnreadAt)
    expect(newerMarked.updatedAt).toBe(created.updatedAt)
    expect((await service.getSession(created.id)).unreadCompletedAt).toBe(newerUnreadAt)

    const viewed = await service.markViewed(created.id)
    expect(viewed.unreadCompletedAt).toBeUndefined()
    expect(viewed.updatedAt).toBe(created.updatedAt)
    expect((await service.getSession(created.id)).unreadCompletedAt).toBeUndefined()
  })

  it('lists sessions by visible order and excludes deleted sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const first = await service.createSession({ title: 'First', now })
    const second = await service.createSession({ title: 'Second', now })
    await service.deleteSession(second.id)

    const sessions = await service.listSessions()
    expect(sessions.map((session) => session.id)).toEqual([first.id])
  })
})
