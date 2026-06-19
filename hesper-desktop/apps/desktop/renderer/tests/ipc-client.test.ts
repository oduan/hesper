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

  it('lists the edit-file tool in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const tools = await api.tools.list()

    expect(tools.find((tool) => tool.id === 'filesystem.edit-file')).toMatchObject({
      category: 'filesystem',
      enabled: true,
      inputSchema: expect.objectContaining({ required: ['path', 'edits'] })
    })
  })

  it('manages roles in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const created = await api.roles.create({
      name: 'Fallback Role',
      description: 'Created locally',
      systemPrompt: 'Fallback prompt',
      defaultToolIds: ['filesystem.read-file']
    })

    expect(created).toMatchObject({ name: 'Fallback Role', defaultToolIds: ['filesystem.read-file'] })
    expect(await api.roles.list()).toEqual([created])

    const updated = await api.roles.update({ id: created.id, name: 'Updated Fallback Role' })
    expect(updated).toMatchObject({ id: created.id, name: 'Updated Fallback Role', description: 'Created locally' })

    await expect(api.roles.delete(created.id)).resolves.toEqual({ deleted: true, id: created.id })
    expect(await api.roles.list()).toEqual([])
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

  it('returns copied role default tool ids in fallback mode', async () => {
    const api = createHesperApi({ allowFallback: true })

    const created = await api.roles.create({
      name: 'Fallback Role',
      defaultToolIds: ['filesystem.read-file']
    })
    created.defaultToolIds.push('filesystem.write-file')

    expect(await api.roles.list()).toEqual([
      expect.objectContaining({ defaultToolIds: ['filesystem.read-file'] })
    ])
  })

  it('fails fast when preload api is unavailable outside fallback mode', () => {
    expect(() => createHesperApi({ allowFallback: false })).toThrowError('window.hesper preload API is unavailable')
  })
})
