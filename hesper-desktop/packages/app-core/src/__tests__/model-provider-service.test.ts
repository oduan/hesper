import { createInMemoryPersistence, exportDatabaseBytes } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { createCredentialVaultService, type CredentialVaultCodec } from '../credential-vault-service'
import { createModelProviderService } from '../model-provider-service'

const now = '2026-06-10T03:00:00.000Z'

function createMockCodec(): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
    decryptString: (value) => [...Buffer.from(value).toString('utf8')].reverse().join('')
  }
}

describe('createModelProviderService', () => {
  it('creates builtin providers and models while preserving the mock baseline', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.ensureBuiltinProviders()

    expect((await service.listProviders()).map((provider) => provider.id)).toEqual(['mock', 'deepseek', 'openai', 'openai-compatible'])
    expect(await service.getProvider('mock')).toMatchObject({ kind: 'mock', enabled: true, defaultModelId: 'mock/hesper-fast', hasApiKey: false })
    expect(await service.getProvider('openai-compatible')).toMatchObject({ enabled: false, defaultModelId: 'openai-compatible/default' })
    expect((await service.listModels()).map((model) => model.id)).toEqual(['mock/hesper-fast', 'deepseek-chat', 'gpt-4o', 'openai-compatible/default'])
    expect((await service.listModels('mock')).map((model) => model.id)).toEqual(['mock/hesper-fast'])
  })

  it('seeds builtin providers on first list without overwriting user configuration', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    expect(await persistence.modelProviders.list()).toEqual([])
    expect((await service.listProviders()).map((provider) => provider.id)).toEqual(['mock', 'deepseek', 'openai', 'openai-compatible'])

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek Local', kind: 'deepseek', baseUrl: 'https://local.deepseek.test', enabled: false, defaultModelId: 'local-chat' })
    await service.ensureBuiltinProviders()

    expect(await service.getProvider('deepseek')).toMatchObject({
      name: 'DeepSeek Local',
      baseUrl: 'https://local.deepseek.test',
      enabled: false,
      defaultModelId: 'local-chat'
    })
  })

  it('saves providers and models through persistence repositories', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      defaultModelId: 'deepseek-chat'
    })
    await service.saveModel({
      id: 'deepseek-chat',
      providerId: 'deepseek',
      modelName: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      capabilities: ['streaming', 'toolCalls'],
      contextWindow: 64000,
      enabled: true
    })

    expect(await service.getProvider('deepseek')).toMatchObject({ apiKeyRef: 'provider:deepseek:api-key', hasApiKey: false })
    expect(await service.listModels('deepseek')).toMatchObject([
      { id: 'deepseek-chat', capabilities: ['streaming', 'toolCalls'], contextWindow: 64000 }
    ])
  })

  it('disables providers instead of deleting them', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true })
    const disabled = await service.disableProvider('openai')

    expect(disabled).toMatchObject({ id: 'openai', enabled: false })
    expect(await persistence.modelProviders.get('openai')).toMatchObject({ enabled: false })
  })

  it('tests connections without returning or persisting raw API keys in provider responses', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true })
    expect(await service.testProviderConnection('deepseek')).toMatchObject({ status: 'needs_api_key', hasApiKey: false })

    await credentialVaultService.saveProviderApiKey({ providerId: 'deepseek', apiKey: 'sk-deepseek-secret' })
    const result = await service.testProviderConnection('deepseek')

    expect(result).toMatchObject({ providerId: 'deepseek', status: 'ok', hasApiKey: true })
    expect(JSON.stringify(result)).not.toContain('sk-deepseek-secret')
    expect(JSON.stringify(await service.getProvider('deepseek'))).not.toContain('sk-deepseek-secret')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-deepseek-secret')
  })
})
