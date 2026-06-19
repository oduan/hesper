import { createInMemoryPersistence } from '@hesper/persistence'
import type { ToolDefinition } from '@hesper/shared'
import type { CredentialVaultService } from '../credential-vault-service'
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
  },
  {
    id: 'web.search',
    name: 'Web Search',
    description: 'Search the web with TinyFish.',
    category: 'web',
    requiresApiKey: true,
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }
  }
]

function credentialVault(hasApiKey: boolean): CredentialVaultService {
  return {
    getProviderApiKeyStatus: async (input) => ({ providerId: input.providerId, apiKeyRef: `provider:${input.providerId}:api-key`, hasApiKey: false, encryptionAvailable: true }),
    saveProviderApiKey: async (input) => ({ providerId: input.providerId, apiKeyRef: `provider:${input.providerId}:api-key`, hasApiKey: true, encryptionAvailable: true }),
    deleteProviderApiKey: async (input) => ({ providerId: input.providerId, apiKeyRef: `provider:${input.providerId}:api-key`, hasApiKey: false, encryptionAvailable: true }),
    readProviderApiKey: async () => undefined,
    getToolApiKeyStatus: async (input) => ({ toolId: input.toolId, apiKeyRef: `tool:${input.toolId}:api-key`, hasApiKey, encryptionAvailable: true }),
    saveToolApiKey: async (input) => ({ toolId: input.toolId, apiKeyRef: `tool:${input.toolId}:api-key`, hasApiKey: true, encryptionAvailable: true }),
    deleteToolApiKey: async (input) => ({ toolId: input.toolId, apiKeyRef: `tool:${input.toolId}:api-key`, hasApiKey: false, encryptionAvailable: true }),
    readToolApiKey: async () => hasApiKey ? 'tinyfish-key' : undefined
  }
}

describe('createToolSettingsService', () => {
  it('lists builtin tools as enabled by default', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createToolSettingsService({ persistence, tools })

    await expect(service.listTools()).resolves.toEqual([
      expect.objectContaining({ id: 'filesystem.read-file', enabled: true }),
      expect.objectContaining({ id: 'web.fetch-url', enabled: true }),
      expect.objectContaining({ id: 'web.search', enabled: false, hasApiKey: false })
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
      expect.objectContaining({ id: 'web.fetch-url', enabled: false }),
      expect.objectContaining({ id: 'web.search', enabled: false })
    ])

    await reloaded.setToolEnabled('web.fetch-url', true)
    await expect(reloaded.isToolEnabled('web.fetch-url')).resolves.toBe(true)
  })

  it('keeps API-key tools effectively disabled until a tool API key exists', async () => {
    const persistence = await createInMemoryPersistence()
    const serviceWithoutKey = createToolSettingsService({ persistence, tools, credentialVaultService: credentialVault(false) })

    await expect(serviceWithoutKey.getTool('web.search')).resolves.toMatchObject({ id: 'web.search', enabled: false, hasApiKey: false })
    await expect(serviceWithoutKey.isToolEnabled('web.search')).resolves.toBe(false)
    await expect(serviceWithoutKey.filterEnabledToolIds(['filesystem.read-file', 'web.search'])).resolves.toEqual(['filesystem.read-file'])
    await expect(serviceWithoutKey.setToolEnabled('web.search', true)).rejects.toThrow('API key is required')

    const serviceWithKey = createToolSettingsService({ persistence, tools, credentialVaultService: credentialVault(true) })
    await expect(serviceWithKey.getTool('web.search')).resolves.toMatchObject({ id: 'web.search', enabled: true, hasApiKey: true })
    await expect(serviceWithKey.filterEnabledToolIds(['filesystem.read-file', 'web.search'])).resolves.toEqual(['filesystem.read-file', 'web.search'])
  })

  it('rejects unknown builtin tool ids', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createToolSettingsService({ persistence, tools })

    await expect(service.setToolEnabled('unknown.tool', false)).rejects.toThrow('Unknown builtin tool')
    await expect(service.isToolEnabled('unknown.tool')).resolves.toBe(false)
  })
})
