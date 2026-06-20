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
      defaultToolIds: ['filesystem.read-file']
    })
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
  })

  it('normalizes optional text fields to empty strings', async () => {
    const { service } = await createService()

    const role = await service.createRole({ name: '搜索专家' })

    expect(role).toMatchObject({
      name: '搜索专家',
      description: '',
      systemPrompt: '',
      defaultToolIds: []
    })
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
      defaultToolIds: ['filesystem.read-file']
    })

    const updated = await service.updateRole({ id: role.id, name: 'Updated' })

    expect(updated).toEqual({
      id: role.id,
      name: 'Updated',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      defaultToolIds: ['filesystem.read-file']
    })
  })

  it('preserves non-managed role fields when updating managed fields', async () => {
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

    const updated = await service.updateRole({ id: 'custom-role', name: 'Updated' })

    expect(updated).toEqual({
      id: 'custom-role',
      name: 'Updated',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      defaultToolIds: ['filesystem.read-file']
    })
    await expect(persistence.roles.get('custom-role')).resolves.toMatchObject({
      id: 'custom-role',
      name: 'Updated',
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
