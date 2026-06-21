import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { createToolCatalogService } from '../registry-services'
import { createRoleManagementService } from '../role-management-service'

const tools = [
  { id: 'filesystem.read-file', name: 'Read File', description: 'Read', category: 'filesystem' as const, inputSchema: {} },
  { id: 'roles.create', name: 'Create Role', description: 'Create role', category: 'agent' as const, inputSchema: {} }
]

function createService() {
  const persistencePromise = createInMemoryPersistence()
  return persistencePromise.then((persistence) => ({
    persistence,
    service: createRoleManagementService({
      persistence,
      toolCatalogService: createToolCatalogService(tools)
    })
  }))
}

describe('role management service', () => {
  it('creates and lists user-defined roles', async () => {
    const { persistence, service } = await createService()

    const role = await service.createRole({
      name: '运维助手',
      description: '执行 Git 和 Linux 命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: ['filesystem.read-file']
    })

    expect(role).toMatchObject({
      name: '运维助手',
      description: '执行 Git 和 Linux 命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: ['filesystem.read-file'],
      defaultModelId: ''
    })
    expect(role.defaultModelRef).toBeUndefined()
    expect(role.id).toMatch(/^role-/)
    expect(await service.listRoles()).toEqual([role])
    await expect(persistence.roles.get(role.id)).resolves.toMatchObject({
      id: role.id,
      allowedSkillIds: [],
      defaultSkillIds: [],
      defaultToolIds: ['filesystem.read-file'],
      canBeMainAgent: true,
      canBeWorkerAgent: true,
      canBeAssignedToWorkerAgent: true
    })
    const stored = await persistence.roles.get(role.id)
    expect(stored?.defaultModelId).toBeUndefined()
    expect(stored?.defaultModelRef).toBeUndefined()
  })

  it('creates roles with default model metadata', async () => {
    const { persistence, service } = await createService()

    const role = await service.createRole({
      name: '搜索专家',
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })

    expect(role).toMatchObject({
      name: '搜索专家',
      description: '',
      systemPrompt: '',
      defaultToolIds: [],
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })
    expect(await service.listRoles()).toEqual([role])
    await expect(persistence.roles.get(role.id)).resolves.toMatchObject({
      id: role.id,
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' },
      allowedSkillIds: [],
      defaultSkillIds: [],
      defaultToolIds: [],
      canBeMainAgent: true,
      canBeWorkerAgent: true,
      canBeAssignedToWorkerAgent: true
    })
  })

  it('rejects default model references whose model id differs from defaultModelId', async () => {
    const { service } = await createService()

    await expect(service.createRole({
      name: 'Mismatch Role',
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o-mini' }
    })).rejects.toThrow('Default model reference modelId must match defaultModelId')

    const role = await service.createRole({
      name: 'Model Role',
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })

    await expect(service.updateRole({
      id: role.id,
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-coder' }
    })).rejects.toThrow('Default model reference modelId must match defaultModelId')
  })

  it('updates roles with matching default model metadata', async () => {
    const { persistence, service } = await createService()
    const role = await service.createRole({ name: 'Model Role' })

    const updated = await service.updateRole({
      id: role.id,
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })

    expect(updated).toMatchObject({
      id: role.id,
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })
    await expect(persistence.roles.get(role.id)).resolves.toMatchObject({
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })
  })

  it('ignores default model ref on create without explicit default model id', async () => {
    const { persistence, service } = await createService()

    const role = await service.createRole({
      name: 'Ref Only Role',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })

    expect(role).toMatchObject({
      name: 'Ref Only Role',
      description: '',
      systemPrompt: '',
      defaultToolIds: [],
      defaultModelId: ''
    })
    expect(role.defaultModelRef).toBeUndefined()

    const stored = await persistence.roles.get(role.id)
    expect(stored?.defaultModelId).toBeUndefined()
    expect(stored?.defaultModelRef).toBeUndefined()
  })

  it('normalizes optional text fields to empty strings', async () => {
    const { service } = await createService()

    const role = await service.createRole({ name: '搜索专家' })

    expect(role).toMatchObject({
      name: '搜索专家',
      description: '',
      systemPrompt: '',
      defaultToolIds: [],
      defaultModelId: ''
    })
    expect(role.defaultModelRef).toBeUndefined()
  })

  it('rejects blank names and unknown default tools', async () => {
    const { service } = await createService()

    await expect(service.createRole({ name: '   ' })).rejects.toThrow('Role name is required')
    await expect(service.createRole({ name: 'Bad tools', defaultToolIds: ['missing.tool'] })).rejects.toThrow('Unknown tool id: missing.tool')
  })

  it('updates existing roles without overwriting omitted fields', async () => {
    const { service } = await createService()
    const role = await service.createRole({
      name: 'Original',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      defaultToolIds: ['filesystem.read-file'],
      defaultModelId: 'legacy-model',
      defaultModelRef: { providerId: 'provider-1', modelId: 'legacy-model' }
    })

    const updated = await service.updateRole({ id: role.id, name: 'Updated' })

    expect(updated).toEqual({
      id: role.id,
      name: 'Updated',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      defaultToolIds: ['filesystem.read-file'],
      defaultModelId: 'legacy-model',
      defaultModelRef: { providerId: 'provider-1', modelId: 'legacy-model' }
    })
  })

  it('does not update default model fields when only default model ref is provided', async () => {
    const { persistence, service } = await createService()
    const role = await service.createRole({
      name: 'Model Role',
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })

    const updated = await service.updateRole({
      id: role.id,
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })

    expect(updated).toMatchObject({
      id: role.id,
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })
    await expect(persistence.roles.get(role.id)).resolves.toMatchObject({
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })
  })

  it('clears default model fields while preserving non-managed fields', async () => {
    const { persistence, service } = await createService()
    await persistence.roles.save({
      id: 'custom-role',
      name: 'Original',
      description: 'Original description',
      defaultModelId: 'legacy-model',
      defaultModelRef: { providerId: 'provider-1', modelId: 'model-1' },
      systemPrompt: 'Original prompt',
      allowedSkillIds: ['builtin:notes'],
      defaultSkillIds: ['workspace:notes'],
      defaultToolIds: ['filesystem.read-file'],
      canBeMainAgent: false,
      canBeWorkerAgent: true,
      canBeAssignedToWorkerAgent: true,
      workerAgentGuidance: 'Keep guidance'
    })

    const updated = await service.updateRole({ id: 'custom-role', name: 'Updated', defaultModelId: '' })

    expect(updated).toMatchObject({
      id: 'custom-role',
      name: 'Updated',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      defaultToolIds: ['filesystem.read-file'],
      defaultModelId: ''
    })
    expect(updated.defaultModelRef).toBeUndefined()
    await expect(persistence.roles.get('custom-role')).resolves.toMatchObject({
      id: 'custom-role',
      name: 'Updated',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      allowedSkillIds: ['builtin:notes'],
      defaultSkillIds: ['workspace:notes'],
      defaultToolIds: ['filesystem.read-file'],
      canBeMainAgent: false,
      canBeWorkerAgent: true,
      canBeAssignedToWorkerAgent: true,
      workerAgentGuidance: 'Keep guidance'
    })
    const stored = await persistence.roles.get('custom-role')
    expect(stored?.defaultModelId).toBeUndefined()
    expect(stored?.defaultModelRef).toBeUndefined()
  })

  it('rejects invalid updates and deletes roles', async () => {
    const { service } = await createService()
    const role = await service.createRole({ name: 'Delete me' })

    await expect(service.updateRole({ id: 'missing', name: 'Nope' })).rejects.toThrow('Role not found: missing')
    await expect(service.updateRole({ id: role.id, name: '' })).rejects.toThrow('Role name is required')
    await expect(service.updateRole({ id: role.id, defaultToolIds: ['missing.tool'] })).rejects.toThrow('Unknown tool id: missing.tool')

    await expect(service.deleteRole(role.id)).resolves.toEqual({ deleted: true, id: role.id })
    await expect(service.listRoles()).resolves.toEqual([])
    await expect(service.deleteRole(role.id)).rejects.toThrow(`Role not found: ${role.id}`)
  })
})
