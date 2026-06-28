import { createInMemoryPersistence, exportDatabaseBytes } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import { createCredentialVaultService, type CredentialVaultCodec, type CredentialVaultService } from '../credential-vault-service'
import { codexOAuthAccessTokenFromCredential, createModelProviderService } from '../model-provider-service'

const now = '2026-06-10T03:00:00.000Z'

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function createMockCodec(): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
    decryptString: (value) => [...Buffer.from(value).toString('utf8')].reverse().join('')
  }
}

describe('createModelProviderService', () => {
  it('does not unwrap expired structured Codex OAuth credentials for runtime use', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(now))
      expect(codexOAuthAccessTokenFromCredential(JSON.stringify({
        type: 'codex_oauth',
        accessToken: 'expired-codex-oauth-access-token',
        refreshToken: 'codex-oauth-refresh-token',
        expiresAt: Date.parse(now) - 1000
      }))).toBeUndefined()
      expect(codexOAuthAccessTokenFromCredential(JSON.stringify({
        type: 'codex_oauth',
        accessToken: 'valid-codex-oauth-access-token',
        expiresAt: Date.parse(now) + 1000
      }))).toBe('valid-codex-oauth-access-token')
      expect(codexOAuthAccessTokenFromCredential('legacy-codex-oauth-access-token')).toBe('legacy-codex-oauth-access-token')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not seed providers or models into empty persistence', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.ensureBuiltinProviders()

    expect(await service.listProviders()).toEqual([])
    expect(await service.listModels()).toEqual([])
  })

  it('backfills official context windows for persisted known models that are missing them', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true })
    await service.saveProvider({ id: 'custom-api-deepseek-com', name: 'DeepSeek Custom API', kind: 'openai-compatible', enabled: true })
    await service.saveProvider({ id: 'mimo', name: 'MiMo', kind: 'openai-compatible', enabled: true })
    await service.saveProvider({ id: 'glm', name: 'GLM', kind: 'openai-compatible', enabled: true })
    await service.saveProvider({ id: 'kimi', name: 'Kimi', kind: 'openai-compatible', enabled: true })

    for (const model of [
      { id: 'deepseek-v4-flash', providerId: 'deepseek', modelName: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' },
      { id: 'custom-api-deepseek-com/deepseek-v4-pro', providerId: 'custom-api-deepseek-com', modelName: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' },
      { id: 'mimo-v2.5', providerId: 'mimo', modelName: 'mimo-v2.5', displayName: 'MiMo V2.5' },
      { id: 'mimo-v2.5-pro', providerId: 'mimo', modelName: 'mimo-v2.5-pro', displayName: 'MiMo V2.5 Pro' },
      { id: 'glm-5.2', providerId: 'glm', modelName: 'glm-5.2', displayName: 'GLM 5.2' },
      { id: 'kimi-k2.7-code', providerId: 'kimi', modelName: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code' },
      { id: 'kimi-2.7', providerId: 'kimi', modelName: 'kimi-2.7', displayName: 'Kimi 2.7' }
    ]) {
      await service.saveModel({ ...model, capabilities: ['streaming', 'toolCalls'], enabled: true })
    }

    await service.ensureBuiltinProviders()

    const modelsById = new Map((await service.listModels()).map((model) => [model.id, model]))
    for (const id of ['deepseek-v4-flash', 'custom-api-deepseek-com/deepseek-v4-pro', 'mimo-v2.5', 'mimo-v2.5-pro', 'glm-5.2']) {
      expect(modelsById.get(id)?.contextWindow).toBe(1_000_000)
    }
    for (const id of ['kimi-k2.7-code', 'kimi-2.7']) {
      expect(modelsById.get(id)?.contextWindow).toBe(256_000)
    }
  })

  it('preserves user customized context windows while backfilling known models', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'glm', name: 'GLM', kind: 'openai-compatible', enabled: true })
    await service.saveModel({
      id: 'glm-5.2',
      providerId: 'glm',
      modelName: 'glm-5.2',
      displayName: 'GLM 5.2',
      capabilities: ['streaming', 'toolCalls'],
      contextWindow: 512_000,
      enabled: true
    })

    await service.ensureBuiltinProviders()

    await expect(persistence.models.get('glm-5.2')).resolves.toMatchObject({ contextWindow: 512_000 })
  })

  it('disables retired and test models without deleting them', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true })
    await service.saveProvider({ id: 'mock', name: 'Mock', kind: 'mock', enabled: true })
    await service.saveModel({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await service.saveModel({ id: 'deepseek-reasoner', providerId: 'deepseek', modelName: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', capabilities: ['streaming', 'toolCalls', 'reasoning'], enabled: true })
    await service.saveModel({ id: 'mock/hesper-fast', providerId: 'mock', modelName: 'hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming', 'toolCalls'], enabled: true })

    await service.ensureBuiltinProviders()

    await expect(persistence.models.get('deepseek-chat')).resolves.toMatchObject({ id: 'deepseek-chat', enabled: false })
    await expect(persistence.models.get('deepseek-reasoner')).resolves.toMatchObject({ id: 'deepseek-reasoner', enabled: false })
    await expect(persistence.models.get('mock/hesper-fast')).resolves.toMatchObject({ id: 'mock/hesper-fast', enabled: false })
  })

  it('repairs provider defaults that point at retired models when a current model exists', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true, defaultModelId: 'deepseek-chat' })
    await service.saveModel({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await service.saveModel({ id: 'deepseek-v4-flash', providerId: 'deepseek', modelName: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', capabilities: ['streaming', 'toolCalls'], enabled: true })

    await service.ensureBuiltinProviders()

    await expect(service.getProvider('deepseek')).resolves.toMatchObject({ defaultModelId: 'deepseek-v4-flash' })
    await expect(persistence.models.get('deepseek-chat')).resolves.toMatchObject({ enabled: false })
  })

  it('prefers deepseek-v4-flash over earlier enabled models when repairing retired DeepSeek defaults', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true, defaultModelId: 'deepseek-chat' })
    await service.saveModel({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await service.saveModel({ id: 'aaa-custom', providerId: 'deepseek', modelName: 'aaa-custom', displayName: 'AAA Custom', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await service.saveModel({ id: 'deepseek-v4-flash', providerId: 'deepseek', modelName: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', capabilities: ['streaming', 'toolCalls'], enabled: true })

    await service.ensureBuiltinProviders()

    await expect(service.getProvider('deepseek')).resolves.toMatchObject({ defaultModelId: 'deepseek-v4-flash' })
    await expect(persistence.models.get('aaa-custom')).resolves.toMatchObject({ enabled: true })
  })

  it('does not treat custom provider models as retired merely because their model name is deepseek-chat', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'custom-api-deepseek-com', name: 'DeepSeek Custom API', kind: 'openai-compatible', enabled: true, defaultModelId: 'custom-api-deepseek-com/deepseek-chat' })
    await service.saveModel({ id: 'custom-api-deepseek-com/deepseek-chat', providerId: 'custom-api-deepseek-com', modelName: 'deepseek-chat', displayName: 'Custom DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await service.saveModel({ id: 'custom-api-deepseek-com/aaa-custom', providerId: 'custom-api-deepseek-com', modelName: 'aaa-custom', displayName: 'AAA Custom', capabilities: ['streaming', 'toolCalls'], enabled: true })

    await service.ensureBuiltinProviders()

    await expect(service.getProvider('custom-api-deepseek-com')).resolves.toMatchObject({ defaultModelId: 'custom-api-deepseek-com/deepseek-chat' })
    await expect(persistence.models.get('custom-api-deepseek-com/deepseek-chat')).resolves.toMatchObject({ enabled: true })
  })

  it('only disables the explicit mock/hesper-fast test model for the built-in mock provider', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'mock', name: 'Mock', kind: 'mock', enabled: true, defaultModelId: 'mock/hesper-fast' })
    await service.saveModel({ id: 'mock/hesper-fast', providerId: 'mock', modelName: 'hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await service.saveModel({ id: 'mock/custom-fast', providerId: 'mock', modelName: 'custom-fast', displayName: 'Custom Fast', capabilities: ['streaming', 'toolCalls'], enabled: true })

    await service.ensureBuiltinProviders()

    await expect(persistence.models.get('mock/hesper-fast')).resolves.toMatchObject({ enabled: false })
    await expect(persistence.models.get('mock/custom-fast')).resolves.toMatchObject({ enabled: true })
  })

  it('keeps empty persistence empty when listing providers and models', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    expect(await service.listProviders()).toEqual([])
    expect(await service.listModels()).toEqual([])
  })

  it('does not add default providers or overwrite user configuration after manual saves', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    expect(await persistence.modelProviders.list()).toEqual([])
    expect(await service.listProviders()).toEqual([])

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek Local', kind: 'deepseek', baseUrl: 'https://local.deepseek.test', enabled: false, defaultModelId: 'local-chat' })
    await service.saveModel({ id: 'local-chat', providerId: 'deepseek', modelName: 'local-chat', displayName: 'Local Chat', capabilities: ['streaming'], enabled: true })
    await service.ensureBuiltinProviders()

    expect((await service.listProviders()).map((provider) => provider.id)).toEqual(['deepseek'])
    expect((await service.listModels()).map((model) => model.id)).toEqual(['local-chat'])
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

  it('saves and preserves provider fast mode through generic provider updates', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5',
      fastModeEnabled: true
    })

    await expect(service.getProvider('chatgpt-codex')).resolves.toMatchObject({ fastModeEnabled: true })

    await service.saveProvider({
      id: 'chatgpt-codex',
      name: 'Renamed Codex',
      kind: 'pi',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5'
    })

    await expect(service.getProvider('chatgpt-codex')).resolves.toMatchObject({ name: 'Renamed Codex', fastModeEnabled: true })

    await service.saveProvider({
      id: 'chatgpt-codex',
      name: 'Renamed Codex',
      kind: 'pi',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5',
      fastModeEnabled: false
    })
    await expect(service.getProvider('chatgpt-codex')).resolves.toMatchObject({ fastModeEnabled: false })

    await service.saveProvider({
      id: 'chatgpt-codex',
      name: 'Renamed Again',
      kind: 'pi',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5'
    })
    await expect(service.getProvider('chatgpt-codex')).resolves.toMatchObject({ name: 'Renamed Again', fastModeEnabled: false })
  })

  it('backfills imageInput for legacy system vision models without changing custom explicit capabilities', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, defaultModelId: 'gpt-4o' })
    await service.saveModel({
      id: 'gpt-4o',
      providerId: 'openai',
      modelName: 'gpt-4o',
      displayName: 'GPT-4o',
      capabilities: ['streaming', 'toolCalls', 'jsonOutput'],
      enabled: true
    })
    await service.saveProvider({ id: 'chatgpt-codex', name: 'ChatGPT Codex', kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, defaultModelId: 'pi/gpt-5.5' })
    await service.saveModel({
      id: 'pi/gpt-5.5',
      providerId: 'chatgpt-codex',
      modelName: 'gpt-5.5',
      displayName: 'GPT-5.5',
      capabilities: ['streaming', 'toolCalls', 'reasoning'],
      enabled: true
    })
    await service.saveProvider({ id: 'custom-ai', name: 'Custom AI', kind: 'openai-compatible', baseUrl: 'https://api.example.com', enabled: true })
    await service.saveModel({
      id: 'custom-ai/gpt-4o-text',
      providerId: 'custom-ai',
      modelName: 'gpt-4o',
      displayName: 'GPT-4o Text',
      capabilities: ['streaming'],
      enabled: true
    })

    await expect(service.listModels('openai')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gpt-4o', capabilities: expect.arrayContaining(['streaming', 'toolCalls', 'jsonOutput', 'imageInput']) })
    ]))
    await expect(service.listModels('chatgpt-codex')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pi/gpt-5.5', capabilities: expect.arrayContaining(['streaming', 'toolCalls', 'reasoning', 'imageInput']) })
    ]))
    await expect(service.listModels('custom-ai')).resolves.toEqual([
      expect.objectContaining({ id: 'custom-ai/gpt-4o-text', capabilities: ['streaming'] })
    ])
    await expect(persistence.models.get('pi/gpt-5.5')).resolves.toMatchObject({ capabilities: expect.arrayContaining(['imageInput']) })
  })

  it('infers custom model capabilities only when explicit or existing capabilities are absent', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'custom-ai', name: 'Custom AI', kind: 'openai-compatible', baseUrl: 'https://api.example.com', enabled: true })

    await expect(service.saveModel({
      id: 'custom-ai/custom-vision',
      providerId: 'custom-ai',
      modelName: 'custom-vision',
      displayName: 'Custom Vision',
      enabled: true
    })).resolves.toMatchObject({ capabilities: ['streaming', 'toolCalls', 'imageInput'] })

    await expect(service.saveModel({
      id: 'custom-ai/gpt-4o-text',
      providerId: 'custom-ai',
      modelName: 'gpt-4o',
      displayName: 'GPT-4o Text',
      capabilities: ['streaming'],
      enabled: true
    })).resolves.toMatchObject({ capabilities: ['streaming'] })

    await service.saveModel({
      id: 'custom-ai/existing-json',
      providerId: 'custom-ai',
      modelName: 'text-model',
      displayName: 'Existing JSON',
      capabilities: ['streaming', 'jsonOutput'],
      enabled: true
    })
    await expect(service.saveModel({
      id: 'custom-ai/existing-json',
      providerId: 'custom-ai',
      modelName: 'custom-vision',
      displayName: 'Existing JSON',
      enabled: true
    })).resolves.toMatchObject({ capabilities: ['streaming', 'jsonOutput'] })
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

  it('deletes custom providers with their models and credentials', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'custom-api-example-com', name: 'Example API', kind: 'openai-compatible', baseUrl: 'https://api.example.com', enabled: true, defaultModelId: 'example-chat' })
    await service.saveModel({ id: 'example-chat', providerId: 'custom-api-example-com', modelName: 'example-chat', displayName: 'Example Chat', capabilities: ['streaming'], enabled: true })
    await credentialVaultService.saveProviderApiKey({ providerId: 'custom-api-example-com', apiKey: 'sk-custom-secret' })

    await expect(service.deleteProvider('custom-api-example-com')).resolves.toBeUndefined()

    expect(await persistence.modelProviders.get('custom-api-example-com')).toBeUndefined()
    expect(await persistence.models.listByProvider('custom-api-example-com')).toEqual([])
    expect(await credentialVaultService.getProviderApiKeyStatus({ providerId: 'custom-api-example-com' })).toMatchObject({ hasApiKey: false })
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-custom-secret')
  })

  it('rolls back custom provider model deletion when credential deletion fails', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const failingCredentialVaultService: CredentialVaultService = {
      ...credentialVaultService,
      deleteProviderApiKey: vi.fn(async () => {
        throw new Error('vault delete failed')
      })
    }
    const service = createModelProviderService({ persistence, credentialVaultService: failingCredentialVaultService, now: () => now })

    await service.saveProvider({ id: 'custom-api-example-com', name: 'Example API', kind: 'openai-compatible', baseUrl: 'https://api.example.com', enabled: true, defaultModelId: 'example-chat' })
    await service.saveModel({ id: 'example-chat', providerId: 'custom-api-example-com', modelName: 'example-chat', displayName: 'Example Chat', capabilities: ['streaming'], enabled: true })

    await expect(service.deleteProvider('custom-api-example-com')).rejects.toThrow('vault delete failed')

    await expect(persistence.modelProviders.get('custom-api-example-com')).resolves.toMatchObject({ id: 'custom-api-example-com' })
    expect(await persistence.models.listByProvider('custom-api-example-com')).toMatchObject([{ id: 'example-chat' }])
  })

  it('deletes manually saved providers that reuse former builtin ids', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat' })
    await service.saveModel({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming'], enabled: true })
    await credentialVaultService.saveProviderApiKey({ providerId: 'deepseek', apiKey: 'sk-deepseek-secret' })

    const deleted = await service.deleteProvider('deepseek')

    expect(deleted).toBeUndefined()
    expect(await persistence.modelProviders.get('deepseek')).toBeUndefined()
    expect(await persistence.models.listByProvider('deepseek')).toEqual([])
    expect(await credentialVaultService.readProviderApiKey('deepseek')).toBeUndefined()
  })

  it('tests saved connections by probing the provider API without returning or persisting raw API keys', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ choices: [{ message: { content: 'hesper-ok' } }] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat' })
    expect(await service.testProviderConnection('deepseek')).toMatchObject({ status: 'needs_api_key', hasApiKey: false })
    expect(fetchMock).not.toHaveBeenCalled()

    await credentialVaultService.saveProviderApiKey({ providerId: 'deepseek', apiKey: 'sk-deepseek-secret' })
    const result = await service.testProviderConnection('deepseek')

    expect(result).toMatchObject({ providerId: 'deepseek', status: 'ok', hasApiKey: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!
    expect(requestUrl).toBe('https://api.deepseek.com/chat/completions')
    expect((requestInit as RequestInit).headers).toMatchObject({ authorization: 'Bearer sk-deepseek-secret' })
    expect(JSON.parse(String((requestInit as RequestInit).body))).toMatchObject({ model: 'deepseek-chat' })
    expect(JSON.stringify(result)).not.toContain('sk-deepseek-secret')
    expect(JSON.stringify(await service.getProvider('deepseek'))).not.toContain('sk-deepseek-secret')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-deepseek-secret')
  })

  it('tests transient form connections with inline API keys without saving them', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ choices: [{ message: { content: 'hesper-ok' } }] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true })
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!
    expect(requestUrl).toBe('https://api.example.com/v1/chat/completions')
    expect((requestInit as RequestInit).headers).toMatchObject({ authorization: 'Bearer sk-inline-secret' })
    expect(JSON.parse(String((requestInit as RequestInit).body))).toMatchObject({ model: 'example-chat' })
    expect(await persistence.modelProviders.get('custom-api-example-com')).toBeUndefined()
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-inline-secret')
  })

  it('redacts inline API keys from failed connection test results', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ error: { message: 'bad key sk-inline-secret' } }, 401))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'failed', hasApiKey: true })
    expect(JSON.stringify(result)).not.toContain('sk-inline-secret')
  })

  it('explains successful connection tests with a user-facing success message', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ choices: [{ message: { content: 'hesper-ok' } }] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true })
    expect(result.message).toBe('连接成功')
  })

  it('accepts OpenAI-compatible reasoning content as an assistant response', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({
      id: '2f2a730f-6f37-4d8e-8354-fc3eeceb7c08',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: 'We are asked to reply with a test response.'
        }
      }]
    }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'deepseek-v4-flash'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true })
    expect(result.message).toBe('连接成功')
  })

  it('explains malformed successful responses as protocol or model mismatches', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ ok: true, data: [] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'failed', hasApiKey: true })
    expect(result.message).toBe('连接失败：API 返回成功状态，但响应格式中没有可读取的 assistant 内容。请检查协议类型、Endpoint 和模型是否匹配。')
    expect(result.message).not.toContain('响应预览：')
    expect(JSON.stringify(result)).not.toContain('sk-inline-secret')
  })

  it('starts, authorizes, and saves a Codex OAuth provider without exposing tokens', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-1',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        refreshToken: 'codex-oauth-refresh-token',
        expiresAt: Date.parse(now) + 3600_000,
        models: [
          { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 },
          { id: 'pi/gpt-5.4-mini', modelName: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
        ],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    const started = await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    expect(started).toMatchObject({ provider: 'openai-codex', sessionId: 'oauth-session-1', status: 'pending' })

    await expect(service.getOAuthAuthorizationStatus({ sessionId: 'oauth-session-1' })).resolves.toMatchObject({ status: 'authorized' })
    const saved = await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })

    expect(saved).toMatchObject({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5',
      hasApiKey: true
    })
    expect(saved.fastModeEnabled).toBeUndefined()
    expect((await service.listModels('chatgpt-codex')).map((model) => model.id)).toEqual(['pi/gpt-5.5', 'pi/gpt-5.4-mini'])
    expect(JSON.stringify(saved)).not.toContain('codex-oauth-access-token')
    expect(JSON.stringify(saved)).not.toContain('codex-oauth-refresh-token')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('codex-oauth-access-token')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('codex-oauth-refresh-token')
  })

  it('passes Codex OAuth gateway start messages through to the UI', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-device',
        authorizationUrl: 'https://auth.openai.com/codex/device',
        message: '请在打开的 OpenAI 页面输入代码：ABCD-EFGH'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'pending' as const, message: '请在打开的 OpenAI 页面输入代码：ABCD-EFGH' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await expect(service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })).resolves.toMatchObject({
      provider: 'openai-codex',
      sessionId: 'oauth-session-device',
      authorizationUrl: 'https://auth.openai.com/codex/device',
      status: 'pending',
      message: '请在打开的 OpenAI 页面输入代码：ABCD-EFGH'
    })
  })

  it('cancels Codex OAuth authorization sessions through the gateway', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-cancel',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-cancel'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'pending' as const, message: '等待浏览器授权' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })

    await expect(service.cancelOAuthAuthorization({ sessionId: 'oauth-session-cancel' })).resolves.toEqual({
      cancelled: true,
      sessionId: 'oauth-session-cancel'
    })
    expect(oauthGateway.cancelAuthorization).toHaveBeenCalledWith({ sessionId: 'oauth-session-cancel' })
    await expect(service.getOAuthAuthorizationStatus({ sessionId: 'oauth-session-cancel' })).resolves.toEqual({
      provider: 'openai-codex',
      sessionId: 'oauth-session-cancel',
      status: 'failed',
      message: '授权会话不存在'
    })
    await expect(service.saveOAuthConnection({ sessionId: 'oauth-session-cancel', connectionName: 'ChatGPT Codex' })).rejects.toThrow('授权会话不存在')
  })

  it('rejects editing a Codex OAuth provider through generic custom API save and keeps persisted metadata intact', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-1',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [
          { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
        ],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })

    await expect(service.saveProvider({
      id: 'chatgpt-codex',
      name: 'Broken',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com'
    })).rejects.toThrow('Codex OAuth providers cannot be edited as custom API providers')

    await expect(service.getProvider('chatgpt-codex')).resolves.toMatchObject({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex'
    })

    await expect(service.saveProvider({
      id: 'chatgpt-codex',
      name: 'Renamed Codex',
      kind: 'pi',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5'
    })).resolves.toMatchObject({
      name: 'Renamed Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex'
    })
  })

  it('keeps Codex OAuth provider metadata after rebuilding the service', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-1',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [
          { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
        ],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })

    const fetchMock = vi.fn()
    const rebuiltService = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await expect(rebuiltService.getProvider('chatgpt-codex')).resolves.toMatchObject({
      id: 'chatgpt-codex',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      hasApiKey: true
    })
    await expect(rebuiltService.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'ok', hasApiKey: true, message: 'Codex 授权可用' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid Codex OAuth consumed models before saving any provider or credential state', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const saveProviderApiKeySpy = vi.spyOn(credentialVaultService, 'saveProviderApiKey')
    const saveProviderSpy = vi.spyOn(persistence.modelProviders, 'save')
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-invalid-models',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-invalid-models'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await expect(service.saveOAuthConnection({ sessionId: 'oauth-session-invalid-models', connectionName: 'ChatGPT Codex' })).rejects.toThrow(/model/i)

    expect(saveProviderApiKeySpy).not.toHaveBeenCalled()
    expect(saveProviderSpy).not.toHaveBeenCalled()
    await expect(service.getProvider('chatgpt-codex')).resolves.toBeUndefined()
    await expect(service.listModels('chatgpt-codex')).resolves.toEqual([])
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('codex-oauth-access-token')
  })

  it('does not leave a half-initialized Codex OAuth provider when credential save fails', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const failingCredentialVaultService = {
      ...credentialVaultService,
      saveProviderApiKey: vi.fn(async () => {
        throw new Error('vault unavailable')
      })
    }
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-1',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [
          { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
        ],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService: failingCredentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await expect(service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })).rejects.toThrow('vault unavailable')

    await expect(service.getProvider('chatgpt-codex')).resolves.toBeUndefined()
    await expect(service.listModels('chatgpt-codex')).resolves.toEqual([])
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('codex-oauth-access-token')
  })

  it('replaces stale Codex OAuth models on reauthorization', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn()
        .mockResolvedValueOnce({ sessionId: 'oauth-session-1', authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1' })
        .mockResolvedValueOnce({ sessionId: 'oauth-session-2', authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-2' }),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn()
        .mockResolvedValueOnce({
          accessToken: 'codex-oauth-access-token-1',
          models: [
            { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 },
            { id: 'pi/gpt-5.4-mini', modelName: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
          ],
          defaultModelId: 'pi/gpt-5.5'
        })
        .mockResolvedValueOnce({
          accessToken: 'codex-oauth-access-token-2',
          models: [
            { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
          ],
          defaultModelId: 'pi/gpt-5.5'
        }),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })
    expect((await service.listModels('chatgpt-codex')).map((model) => model.id)).toEqual(['pi/gpt-5.5', 'pi/gpt-5.4-mini'])

    await service.saveProvider({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5',
      fastModeEnabled: true
    })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await service.saveOAuthConnection({ sessionId: 'oauth-session-2', connectionName: 'ChatGPT Codex' })

    expect((await service.listModels('chatgpt-codex')).map((model) => model.id)).toEqual(['pi/gpt-5.5'])
    await expect(service.getProvider('chatgpt-codex')).resolves.toMatchObject({ fastModeEnabled: true })
  })

  it('requires reauthorization for expired Codex OAuth credentials without a refresh token', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn()
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await service.saveProvider({ id: 'chatgpt-codex', name: 'ChatGPT Codex', kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, defaultModelId: 'pi/gpt-5.5' })
    await credentialVaultService.saveProviderApiKey({
      providerId: 'chatgpt-codex',
      apiKey: JSON.stringify({ type: 'codex_oauth', accessToken: 'expired-access-token', expiresAt: Date.parse(now) - 1000 })
    })

    await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({
      status: 'needs_api_key',
      hasApiKey: false,
      message: expect.stringContaining('重新授权')
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires reauthorization for expired Codex OAuth credentials even when a refresh token exists', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn()
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await service.saveProvider({ id: 'chatgpt-codex', name: 'ChatGPT Codex', kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, defaultModelId: 'pi/gpt-5.5' })
    await credentialVaultService.saveProviderApiKey({
      providerId: 'chatgpt-codex',
      apiKey: JSON.stringify({
        type: 'codex_oauth',
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token-without-refresh-implementation',
        expiresAt: Date.parse(now) - 1000
      })
    })

    await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({
      status: 'needs_api_key',
      hasApiKey: false,
      message: 'Codex 授权已过期，请重新授权'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tests Codex OAuth providers by credential status instead of chat completions probe', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn()
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await service.saveProvider({ id: 'chatgpt-codex', name: 'ChatGPT Codex', kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, defaultModelId: 'pi/gpt-5.5' })
    await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'needs_api_key', hasApiKey: false })

    await credentialVaultService.saveProviderApiKey({ providerId: 'chatgpt-codex', apiKey: 'codex-oauth-access-token' })
    await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'ok', hasApiKey: true, message: 'Codex 授权可用' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
