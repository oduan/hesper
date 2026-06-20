import type { Api, KnownProvider, Model } from '@earendil-works/pi-ai'
import type { ModelConfig, ModelProviderConfig } from '@hesper/shared'
import { describe, expect, it, vi } from 'vitest'
import { createRegistryModelResolver, parseLegacyModelId, type ModelRegistryReader } from '../model-resolver'

const timestamp = '2026-06-11T00:00:00.000Z'

function provider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    defaultModelId: 'gpt-4o',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'gpt-4o',
    providerId: 'openai',
    modelName: 'gpt-4o',
    displayName: 'GPT-4o',
    capabilities: ['streaming', 'toolCalls', 'jsonOutput'],
    contextWindow: 128000,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function piModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: 'gpt-4o',
    name: 'GPT-4o builtin',
    api: 'openai-responses',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...overrides
  }
}

function registry({ providers, models }: { providers: ModelProviderConfig[]; models: ModelConfig[] }): ModelRegistryReader {
  return {
    async getProvider(id: string) {
      return providers.find((entry) => entry.id === id)
    },
    async listModels(providerId?: string) {
      return providerId ? models.filter((entry) => entry.providerId === providerId) : models
    }
  }
}

describe('ModelResolver', () => {
  it('parses legacy provider/model ids without changing exact registry model ids', () => {
    expect(parseLegacyModelId('openai/gpt-4o')).toEqual({ providerId: 'openai', modelName: 'gpt-4o' })
    expect(parseLegacyModelId('mock/hesper-fast')).toEqual({ providerId: 'mock', modelName: 'hesper-fast' })
    expect(parseLegacyModelId('deepseek-chat')).toEqual({ modelName: 'deepseek-chat' })
  })

  it('resolves a registry model and scopes API key reads to the provider id', async () => {
    const readProviderApiKey = vi.fn(async () => 'sk-openai')
    const getPiModel = vi.fn(() => piModel())
    const resolver = createRegistryModelResolver({
      registry: registry({ providers: [provider()], models: [model()] }),
      readProviderApiKey,
      getPiModel
    })

    const resolved = await resolver.resolve({ modelId: 'gpt-4o' })

    expect(getPiModel).toHaveBeenCalledWith('openai', 'gpt-4o')
    expect(resolved.model).toEqual(expect.objectContaining({ id: 'gpt-4o', provider: 'openai', baseUrl: 'https://api.openai.com/v1' }))
    expect(readProviderApiKey).toHaveBeenCalledWith('openai')
    await expect(resolved.getApiKey?.('openai')).resolves.toBe('sk-openai')
    expect(resolved.getApiKey?.('other-provider')).toBeUndefined()
  })

  it('calls registry ensureReady before resolving models', async () => {
    const ensureReady = vi.fn(async () => undefined)
    const resolver = createRegistryModelResolver({
      registry: {
        ensureReady,
        ...registry({ providers: [provider()], models: [model()] })
      },
      readProviderApiKey: vi.fn(async () => 'sk-openai'),
      getPiModel: vi.fn(() => piModel())
    })

    await resolver.resolve({ modelId: 'gpt-4o' })

    expect(ensureReady).toHaveBeenCalledTimes(1)
  })

  it('falls back from legacy provider/model ids to registry model records', async () => {
    const resolver = createRegistryModelResolver({
      registry: registry({ providers: [provider()], models: [model()] }),
      readProviderApiKey: vi.fn(async () => 'sk-openai'),
      getPiModel: vi.fn(() => piModel())
    })

    const resolved = await resolver.resolve({ modelId: 'openai/gpt-4o' })

    expect(resolved.modelConfig.id).toBe('gpt-4o')
    expect(resolved.provider.id).toBe('openai')
  })

  it('does not let legacy model ids override an explicit provider scope', async () => {
    const resolver = createRegistryModelResolver({
      registry: registry({
        providers: [provider(), provider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com' })],
        models: [
          model(),
          model({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat' })
        ]
      }),
      readProviderApiKey: vi.fn(async () => 'sk-provider'),
      getPiModel: vi.fn(() => piModel())
    })

    await expect(resolver.resolve({ providerId: 'deepseek', modelId: 'openai/gpt-4o' })).rejects.toThrow('Model not found: openai/gpt-4o')
  })

  it('creates an OpenAI-compatible model from registry baseUrl without using getModel', async () => {
    const getPiModel = vi.fn(() => piModel())
    const customProvider = provider({
      id: 'local-compatible',
      name: 'Local Compatible',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      defaultModelId: 'local-chat'
    })
    const customModel = model({
      id: 'local-chat',
      providerId: 'local-compatible',
      modelName: 'local-chat',
      displayName: 'Local Chat',
      capabilities: ['streaming', 'toolCalls'],
      contextWindow: 32000
    })
    const resolver = createRegistryModelResolver({
      registry: registry({ providers: [customProvider], models: [customModel] }),
      readProviderApiKey: vi.fn(async () => 'sk-local'),
      getPiModel
    })

    const resolved = await resolver.resolve({ modelId: 'local-chat' })

    expect(getPiModel).not.toHaveBeenCalled()
    expect(resolved.model).toEqual(expect.objectContaining({
      id: 'local-chat',
      api: 'openai-completions',
      provider: 'local-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 32000,
      compat: expect.objectContaining({
        supportsDeveloperRole: false,
        supportsStore: false,
        supportsUsageInStreaming: false,
        maxTokensField: 'max_tokens'
      })
    }))
    await expect(resolved.getApiKey?.('local-compatible')).resolves.toBe('sk-local')
    await expect(resolved.getApiKey?.('openai')).resolves.toBe('sk-local')
    expect(resolved.getApiKey?.('deepseek')).toBeUndefined()
  })

  it('uses a faux model factory for mock providers and never requires a key', async () => {
    const mockProvider = provider({ id: 'mock', name: 'Mock', kind: 'mock', defaultModelId: 'mock/hesper-fast' })
    const mockModel = model({ id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', displayName: 'Hesper Mock Fast' })
    const readProviderApiKey = vi.fn(async () => undefined)
    const createFauxModel = vi.fn(() => piModel({ provider: 'mock', id: 'mock/hesper-fast', name: 'Hesper Mock Fast' }))
    const resolver = createRegistryModelResolver({
      registry: registry({ providers: [mockProvider], models: [mockModel] }),
      readProviderApiKey,
      createFauxModel
    })

    const resolved = await resolver.resolve({ modelId: 'mock/hesper-fast' })

    expect(createFauxModel).toHaveBeenCalledWith(mockProvider, mockModel)
    expect(readProviderApiKey).not.toHaveBeenCalled()
    expect(resolved.getApiKey).toBeUndefined()
  })

  it('fails fast for missing API keys, disabled providers, disabled models and missing baseUrl', async () => {
    await expect(createRegistryModelResolver({
      registry: registry({ providers: [provider()], models: [model()] }),
      readProviderApiKey: vi.fn(async () => undefined),
      getPiModel: vi.fn(() => piModel())
    }).resolve({ modelId: 'gpt-4o' })).rejects.toThrow('Model provider needs an API key: openai')

    await expect(createRegistryModelResolver({
      registry: registry({ providers: [provider({ enabled: false })], models: [model()] }),
      readProviderApiKey: vi.fn(async () => 'sk-openai'),
      getPiModel: vi.fn(() => piModel())
    }).resolve({ modelId: 'gpt-4o' })).rejects.toThrow('Model provider is disabled: openai')

    await expect(createRegistryModelResolver({
      registry: registry({ providers: [provider()], models: [model({ enabled: false })] }),
      readProviderApiKey: vi.fn(async () => 'sk-openai'),
      getPiModel: vi.fn(() => piModel())
    }).resolve({ modelId: 'gpt-4o' })).rejects.toThrow('Model is disabled: gpt-4o')

    const providerWithoutBaseUrl = provider({ kind: 'openai-compatible' })
    delete providerWithoutBaseUrl.baseUrl
    await expect(createRegistryModelResolver({
      registry: registry({ providers: [providerWithoutBaseUrl], models: [model()] }),
      readProviderApiKey: vi.fn(async () => 'sk-openai'),
      getPiModel: vi.fn(() => piModel())
    }).resolve({ modelId: 'gpt-4o' })).rejects.toThrow('Model provider openai requires a baseUrl')
  })

  it('resolves Codex OAuth Pi models through openai-codex credentials', async () => {
    const readProviderApiKey = vi.fn(async () => 'codex-oauth-access-token')
    const getPiModel = vi.fn((_provider: KnownProvider, _modelName: string): Model<Api> => (
      piModel({ id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai-codex', reasoning: true })
    ))
    const codexProvider = provider({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      defaultModelId: 'pi/gpt-5.5'
    })
    const codexModel = model({
      id: 'pi/gpt-5.5',
      providerId: 'chatgpt-codex',
      modelName: 'gpt-5.5',
      displayName: 'GPT-5.5',
      capabilities: ['streaming', 'toolCalls', 'reasoning'],
      contextWindow: 272000
    })
    const resolver = createRegistryModelResolver({
      registry: registry({ providers: [codexProvider], models: [codexModel] }),
      readProviderApiKey,
      getPiModel
    })

    const resolved = await resolver.resolve({ modelId: 'pi/gpt-5.5' })

    expect(getPiModel).toHaveBeenCalledWith('openai-codex', 'gpt-5.5')
    expect(resolved.model).toEqual(expect.objectContaining({ id: 'gpt-5.5', provider: 'chatgpt-codex', reasoning: true }))
    await expect(resolved.getApiKey?.('openai-codex')).resolves.toBe('codex-oauth-access-token')
    await expect(resolved.getApiKey?.('chatgpt-codex')).resolves.toBe('codex-oauth-access-token')
    await expect(resolved.getApiKey?.('pi')).resolves.toBe('codex-oauth-access-token')
    expect(resolved.getApiKey?.('openai')).toBeUndefined()
  })

  it('unwraps structured Codex OAuth JSON credentials before returning keys to pi-ai', async () => {
    const readProviderApiKey = vi.fn(async () => JSON.stringify({
      type: 'codex_oauth',
      accessToken: 'codex-oauth-access-token',
      refreshToken: 'codex-oauth-refresh-token',
      expiresAt: Date.now() + 3600_000
    }))
    const getPiModel = vi.fn((_provider: KnownProvider, _modelName: string): Model<Api> => (
      piModel({ id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai-codex', reasoning: true })
    ))
    const codexProvider = provider({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      defaultModelId: 'pi/gpt-5.5'
    })
    const codexModel = model({
      id: 'pi/gpt-5.5',
      providerId: 'chatgpt-codex',
      modelName: 'gpt-5.5',
      displayName: 'GPT-5.5',
      capabilities: ['streaming', 'toolCalls', 'reasoning'],
      contextWindow: 272000
    })
    const resolver = createRegistryModelResolver({
      registry: registry({ providers: [codexProvider], models: [codexModel] }),
      readProviderApiKey,
      getPiModel
    })

    const resolved = await resolver.resolve({ modelId: 'pi/gpt-5.5' })

    await expect(resolved.getApiKey?.('openai-codex')).resolves.toBe('codex-oauth-access-token')
    await expect(resolved.getApiKey?.('chatgpt-codex')).resolves.toBe('codex-oauth-access-token')
  })

  it('fails with an OAuth authorization error when Codex Pi credentials are missing', async () => {
    const codexProvider = provider({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      defaultModelId: 'pi/gpt-5.5'
    })
    const codexModel = model({
      id: 'pi/gpt-5.5',
      providerId: 'chatgpt-codex',
      modelName: 'gpt-5.5',
      displayName: 'GPT-5.5',
      capabilities: ['streaming', 'toolCalls', 'reasoning']
    })

    await expect(createRegistryModelResolver({
      registry: registry({ providers: [codexProvider], models: [codexModel] }),
      readProviderApiKey: vi.fn(async () => undefined),
      getPiModel: vi.fn(() => piModel())
    }).resolve({ modelId: 'pi/gpt-5.5' })).rejects.toThrow('Model provider needs OAuth authorization: chatgpt-codex')
  })
})
