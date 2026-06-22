import { describe, expect, it } from 'vitest'
import { createHesperApi } from '../src/ipc-client'

describe('ipc-client fallback', () => {
  it('provides a safe fallback api when fallback is explicitly allowed', async () => {
    const api = createHesperApi({ allowFallback: true })
    const sessions = await api.sessions.list()
    const first = await api.sessions.create({ title: 'Fallback 1' })
    const second = await api.sessions.create({ title: 'Fallback 2' })

    expect(sessions).toEqual([])
    expect(first.title).toBe('Fallback 1')
    expect(second.title).toBe('Fallback 2')
    expect(first.status).toBe('active')
    expect(second.status).toBe('active')
    expect(first.id).not.toBe(second.id)
  })

  it('lists and retrieves skills in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const skills = await api.skills.list()

    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'builtin:install-skills', name: 'Install Skills', source: 'builtin' })
    ]))
    await expect(api.skills.get('builtin:install-skills')).resolves.toMatchObject({ id: 'builtin:install-skills' })
    await expect(api.skills.get('missing')).resolves.toBeUndefined()
    await expect(api.skills.refresh()).resolves.toEqual(skills)
  })

  it('lists the edit-file tool in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const tools = await api.tools.list()

    expect(tools.find((tool) => tool.id === 'filesystem.edit-file')).toMatchObject({
      category: 'filesystem',
      enabled: true,
      inputSchema: expect.objectContaining({ required: ['path', 'edits'] })
    })
  })

  it('lists role tools with default model schemas in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const tools = await api.tools.list()

    for (const toolId of ['roles.create', 'roles.update']) {
      expect(tools.find((tool) => tool.id === toolId)).toMatchObject({
        inputSchema: {
          properties: {
            defaultModelId: expect.objectContaining({ type: 'string' }),
            defaultModelRef: expect.objectContaining({
              type: 'object',
              properties: {
                providerId: expect.objectContaining({ type: 'string' }),
                modelId: expect.objectContaining({ type: 'string' })
              }
            })
          }
        }
      })
    }
  })

  it('rejects local file preview in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    await expect(api.files.preview({ sessionId: 'session-1', path: 'README.md' })).rejects.toThrowError('本地文件预览在 renderer fallback 模式不可用')
  })

  it('manages roles in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const created = await api.roles.create({
      name: 'Fallback Role',
      description: 'Created locally',
      systemPrompt: 'Fallback prompt',
      defaultToolIds: ['filesystem.read-file'],
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })

    expect(created).toMatchObject({
      name: 'Fallback Role',
      defaultToolIds: ['filesystem.read-file'],
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })
    expect(await api.roles.list()).toEqual([created])

    const updated = await api.roles.update({ id: created.id, name: 'Updated Fallback Role' })
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Updated Fallback Role',
      description: 'Created locally',
      systemPrompt: 'Fallback prompt',
      defaultToolIds: ['filesystem.read-file'],
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })
    expect(await api.roles.list()).toEqual([updated])

    await expect(api.roles.delete(created.id)).resolves.toEqual({ deleted: true, id: created.id })
    expect(await api.roles.list()).toEqual([])
  })

  it('clears default model fields in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const created = await api.roles.create({
      name: 'Fallback Role',
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })

    const updated = await api.roles.update({ id: created.id, defaultModelId: '' })

    expect(updated.defaultModelId).toBe('')
    expect(updated.defaultModelRef).toBeUndefined()
    expect(await api.roles.list()).toEqual([updated])
  })

  it('does not change fallback role default model when only default model ref is provided', async () => {
    const api = createHesperApi({ allowFallback: true })

    const created = await api.roles.create({
      name: 'Fallback Role',
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })

    const updated = await api.roles.update({
      id: created.id,
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })

    expect(updated).toMatchObject({
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })
    expect(await api.roles.list()).toEqual([updated])
  })

  it('trims role names in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const created = await api.roles.create({ name: '  Fallback Role  ' })
    const updated = await api.roles.update({ id: created.id, name: '  Updated Role  ' })

    expect(created.name).toBe('Fallback Role')
    expect(updated.name).toBe('Updated Role')
  })

  it('rejects blank role names in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    await expect(api.roles.create({ name: '   ' })).rejects.toThrowError('Role name is required')
  })

  it('rejects unknown default tool ids in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    await expect(api.roles.create({
      name: 'Fallback Role',
      defaultToolIds: ['missing.tool']
    })).rejects.toThrowError('Unknown tool id: missing.tool')
  })

  it('rejects invalid role updates in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })
    const created = await api.roles.create({
      name: 'Fallback Role',
      description: 'Created locally',
      systemPrompt: 'Fallback prompt',
      defaultToolIds: ['filesystem.read-file']
    })

    await expect(api.roles.update({ id: created.id, name: '   ' })).rejects.toThrowError('Role name is required')
    await expect(api.roles.update({
      id: created.id,
      defaultToolIds: ['missing.tool']
    })).rejects.toThrowError('Unknown tool id: missing.tool')
    expect(await api.roles.list()).toEqual([created])
  })

  it('rejects missing roles in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    await expect(api.roles.update({ id: 'role-missing', name: 'Updated Role' })).rejects.toThrowError('Role not found: role-missing')
    await expect(api.roles.delete('role-missing')).rejects.toThrowError('Role not found: role-missing')
  })

  it('copies role default tool ids from create inputs in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })
    const defaultToolIds = ['filesystem.read-file']

    await api.roles.create({ name: 'Fallback Role', defaultToolIds })
    defaultToolIds.push('filesystem.write-file')

    expect(await api.roles.list()).toEqual([
      expect.objectContaining({ defaultToolIds: ['filesystem.read-file'] })
    ])
  })

  it('returns copied roles from list in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })
    const created = await api.roles.create({
      name: 'Fallback Role',
      defaultToolIds: ['filesystem.read-file']
    })

    const listed = await api.roles.list()
    const listedRole = listed[0]
    expect(listedRole).toBeDefined()
    if (!listedRole) {
      throw new Error('Expected fallback role to be listed')
    }
    listedRole.name = 'Mutated Role'
    listedRole.defaultToolIds.push('filesystem.write-file')
    listed.push({ ...listedRole, id: 'role-injected', name: 'Injected Role' })

    expect(await api.roles.list()).toEqual([
      expect.objectContaining({
        id: created.id,
        name: 'Fallback Role',
        defaultToolIds: ['filesystem.read-file']
      })
    ])
  })

  it('returns copied role default tool ids from update in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })
    const created = await api.roles.create({
      name: 'Fallback Role',
      defaultToolIds: ['filesystem.read-file']
    })

    const updated = await api.roles.update({
      id: created.id,
      defaultToolIds: ['filesystem.write-file']
    })
    updated.defaultToolIds.push('filesystem.read-file')

    expect(await api.roles.list()).toEqual([
      expect.objectContaining({ defaultToolIds: ['filesystem.write-file'] })
    ])
  })

  it('fails fast when preload api is unavailable outside fallback mode', () => {
    expect(() => createHesperApi({ allowFallback: false })).toThrowError('window.hesper preload API is unavailable')
  })
})
