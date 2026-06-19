import { createInMemoryPersistence } from '@hesper/persistence'
import type { ToolDefinition } from '@hesper/shared'
import { describe, expect, it } from 'vitest'
import { createToolSettingsService } from '../tool-settings-service'

const tools: ToolDefinition[] = [
  {
    id: 'filesystem.read-file',
    name: 'Read File',
    description: 'Read a text file from the selected workspace.',
    category: 'filesystem',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
  },
  {
    id: 'web.fetch-url',
    name: 'Fetch URL',
    description: 'Fetch and extract text from a URL.',
    category: 'web',
    inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
  }
]

describe('createToolSettingsService', () => {
  it('lists builtin tools as enabled by default', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createToolSettingsService({ persistence, tools })

    await expect(service.listTools()).resolves.toEqual([
      expect.objectContaining({ id: 'filesystem.read-file', enabled: true }),
      expect.objectContaining({ id: 'web.fetch-url', enabled: true })
    ])
  })

  it('persists global disabled state through tool permission policies', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createToolSettingsService({ persistence, tools, now: () => new Date('2026-06-10T03:00:00.000Z') })

    await expect(service.setToolEnabled('web.fetch-url', false)).resolves.toMatchObject({ id: 'web.fetch-url', enabled: false })
    await expect(service.isToolEnabled('web.fetch-url')).resolves.toBe(false)
    await expect(service.filterEnabledToolIds(['filesystem.read-file', 'web.fetch-url'])).resolves.toEqual(['filesystem.read-file'])

    const storedPolicy = await persistence.toolPermissionPolicies.get('global-tool:web.fetch-url')
    expect(storedPolicy).toMatchObject({ toolId: 'web.fetch-url', scope: 'global', mode: 'deny' })

    const reloaded = createToolSettingsService({ persistence, tools })
    await expect(reloaded.listTools()).resolves.toEqual([
      expect.objectContaining({ id: 'filesystem.read-file', enabled: true }),
      expect.objectContaining({ id: 'web.fetch-url', enabled: false })
    ])

    await reloaded.setToolEnabled('web.fetch-url', true)
    await expect(reloaded.isToolEnabled('web.fetch-url')).resolves.toBe(true)
  })

  it('rejects unknown builtin tool ids', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createToolSettingsService({ persistence, tools })

    await expect(service.setToolEnabled('unknown.tool', false)).rejects.toThrow('Unknown builtin tool')
    await expect(service.isToolEnabled('unknown.tool')).resolves.toBe(false)
  })
})
