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

    await expect(sessions.setCategory(created.id, 'category-avatar')).resolves.toMatchObject({ categoryId: 'category-avatar' })
    await expect(sessions.setCategoryForSessions([created.id], undefined)).resolves.toEqual([
      expect.objectContaining({ id: created.id, categoryId: undefined })
    ])
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

    await service.deleteSession(created.id)
    await expect(service.getSession(created.id)).rejects.toThrow(`Session not found: ${created.id}`)
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
