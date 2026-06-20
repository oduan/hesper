import { getModel, registerFauxProvider, type Api, type KnownProvider, type Model } from '@earendil-works/pi-ai'
import type { ModelConfig, ModelProviderConfig, ModelProviderKind } from '@hesper/shared'

export type ModelResolveInput = {
  modelId: string
  providerId?: string
}

export type ResolvedModel = {
  model: Model<Api>
  provider: ModelProviderConfig
  modelConfig: ModelConfig
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined
}

export type ModelResolver = {
  resolve(input: ModelResolveInput): Promise<ResolvedModel>
}

export type ModelRegistryReader = {
  ensureReady?(): Promise<void>
  getProvider(id: string): Promise<ModelProviderConfig | undefined>
  listModels(providerId?: string): Promise<ModelConfig[]>
}

export type RegistryModelResolverOptions = {
  registry: ModelRegistryReader
  readProviderApiKey: (providerId: string) => Promise<string | undefined>
  getPiModel?: (provider: KnownProvider, modelName: string) => Model<Api>
  createFauxModel?: (provider: ModelProviderConfig, model: ModelConfig) => Model<Api>
}

const knownProviderByKind: Partial<Record<ModelProviderKind, KnownProvider>> = {
  openai: 'openai',
  deepseek: 'deepseek',
  anthropic: 'anthropic'
}

const knownProviderByPiAuthProvider = {
  'openai-codex': 'openai-codex'
} satisfies Record<NonNullable<ModelProviderConfig['piAuthProvider']>, KnownProvider>

function piKnownProvider(provider: ModelProviderConfig): KnownProvider | undefined {
  if (provider.kind === 'pi') {
    return provider.piAuthProvider ? knownProviderByPiAuthProvider[provider.piAuthProvider] : undefined
  }
  return knownProviderByKind[provider.kind]
}

const defaultCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0
}

export function parseLegacyModelId(modelId: string): { providerId?: string; modelName: string } {
  const slashIndex = modelId.indexOf('/')
  if (slashIndex <= 0) {
    return { modelName: modelId }
  }

  const providerId = modelId.slice(0, slashIndex).trim()
  const modelName = modelId.slice(slashIndex + 1).trim()
  return providerId && modelName ? { providerId, modelName } : { modelName: modelId }
}

function defaultGetPiModel(provider: KnownProvider, modelName: string): Model<Api> {
  return getModel(provider, modelName as never) as Model<Api>
}

function defaultFauxModel(provider: ModelProviderConfig, model: ModelConfig): Model<Api> {
  const registration = registerFauxProvider({
    provider: provider.id,
    models: [
      {
        id: model.modelName,
        name: model.displayName,
        reasoning: model.capabilities.includes('reasoning'),
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {})
      }
    ]
  })
  const resolved = registration.getModel(model.modelName) ?? registration.getModel()
  return resolved as Model<Api>
}

function assertNonEmpty(value: string | undefined, message: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(message)
  }
  return normalized
}

function isCodexOAuthProvider(provider: ModelProviderConfig): boolean {
  return provider.kind === 'pi' && provider.authType === 'oauth' && provider.piAuthProvider === 'openai-codex'
}

function accessTokenFromCodexOAuthCredential(rawCredential: string | undefined, nowMs = Date.now()): string | undefined {
  const trimmed = rawCredential?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'object' || parsed === null || (parsed as { type?: unknown }).type !== 'codex_oauth') {
      return undefined
    }
    const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt
    if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt <= nowMs) {
      return undefined
    }
    const accessToken = (parsed as { accessToken?: unknown }).accessToken
    return typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : undefined
  } catch {
    return trimmed
  }
}

async function readResolvedProviderApiKey(options: RegistryModelResolverOptions, provider: ModelProviderConfig): Promise<string | undefined> {
  const rawCredential = await options.readProviderApiKey(provider.id)
  return isCodexOAuthProvider(provider) ? accessTokenFromCodexOAuthCredential(rawCredential) : rawCredential
}

function createOpenAICompatibleModel(provider: ModelProviderConfig, model: ModelConfig): Model<Api> {
  const baseUrl = assertNonEmpty(provider.baseUrl, `Model provider ${provider.id} requires a baseUrl`)
  const contextWindow = model.contextWindow ?? 128000
  return {
    id: model.modelName,
    name: model.displayName,
    api: 'openai-completions',
    provider: provider.id,
    baseUrl,
    reasoning: model.capabilities.includes('reasoning'),
    input: ['text'],
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsUsageInStreaming: false,
      maxTokensField: 'max_tokens'
    },
    cost: defaultCost,
    contextWindow,
    maxTokens: Math.min(contextWindow, 8192)
  }
}

function mergeRegistryModel(base: Model<Api>, provider: ModelProviderConfig, model: ModelConfig): Model<Api> {
  return {
    ...base,
    id: model.modelName,
    name: model.displayName || base.name,
    provider: provider.id,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    reasoning: model.capabilities.includes('reasoning') || base.reasoning,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {})
  }
}

async function findModel(registry: ModelRegistryReader, input: ModelResolveInput): Promise<ModelConfig | undefined> {
  const models = input.providerId ? await registry.listModels(input.providerId) : await registry.listModels()
  const exact = models.find((model) => model.id === input.modelId)
  if (exact) return exact

  const legacy = parseLegacyModelId(input.modelId)
  const providerModels = input.providerId ? models : legacy.providerId ? await registry.listModels(legacy.providerId) : models
  return providerModels.find((model) => model.id === legacy.modelName || model.modelName === legacy.modelName)
}

function assertEnabled(provider: ModelProviderConfig, model: ModelConfig): void {
  if (!provider.enabled) {
    throw new Error(`Model provider is disabled: ${provider.id}`)
  }
  if (model.enabled === false) {
    throw new Error(`Model is disabled: ${model.id}`)
  }
}

async function assertProviderKey(options: RegistryModelResolverOptions, provider: ModelProviderConfig): Promise<void> {
  if (provider.kind === 'mock') {
    return
  }

  const apiKey = await readResolvedProviderApiKey(options, provider)
  if (!apiKey) {
    if (provider.authType === 'oauth') {
      throw new Error(`Model provider needs OAuth authorization: ${provider.id}`)
    }
    throw new Error(`Model provider needs an API key: ${provider.id}`)
  }
}

function createModelForProvider(
  provider: ModelProviderConfig,
  model: ModelConfig,
  getPiModel: (provider: KnownProvider, modelName: string) => Model<Api>,
  createFauxModel: (provider: ModelProviderConfig, model: ModelConfig) => Model<Api>
): Model<Api> {
  if (provider.kind === 'mock') {
    return createFauxModel(provider, model)
  }

  if (provider.kind === 'pi') {
    const knownProvider = piKnownProvider(provider)
    if (!knownProvider) {
      throw new Error(`Unsupported Pi auth provider: ${provider.piAuthProvider ?? 'missing'}`)
    }
    return mergeRegistryModel(getPiModel(knownProvider, model.modelName), provider, model)
  }

  if (provider.kind === 'openai-compatible' || provider.kind === 'custom') {
    return createOpenAICompatibleModel(provider, model)
  }

  const knownProvider = piKnownProvider(provider)
  if (!knownProvider) {
    throw new Error(`Unsupported model provider kind: ${provider.kind}`)
  }

  return mergeRegistryModel(getPiModel(knownProvider, model.modelName), provider, model)
}

export function createRegistryModelResolver(options: RegistryModelResolverOptions): ModelResolver {
  const getPiModel = options.getPiModel ?? defaultGetPiModel
  const createFauxModel = options.createFauxModel ?? defaultFauxModel

  return {
    async resolve(input) {
      await options.registry.ensureReady?.()
      const model = await findModel(options.registry, input)
      if (!model) {
        throw new Error(`Model not found: ${input.modelId}`)
      }

      const provider = await options.registry.getProvider(model.providerId)
      if (!provider) {
        throw new Error(`Model provider not found: ${model.providerId}`)
      }

      assertEnabled(provider, model)
      await assertProviderKey(options, provider)
      const resolvedModel = createModelForProvider(provider, model, getPiModel, createFauxModel)

      const apiKeyProviderAliases = new Set([
        provider.id,
        provider.kind,
        ...(provider.piAuthProvider ? [provider.piAuthProvider] : []),
        ...(provider.kind === 'openai-compatible' || provider.kind === 'custom' ? ['openai'] : [])
      ])

      return {
        model: resolvedModel,
        provider,
        modelConfig: model,
        ...(provider.kind === 'mock'
          ? {}
          : {
              getApiKey: (requestedProvider: string) => {
                if (!apiKeyProviderAliases.has(requestedProvider)) {
                  return undefined
                }
                return readResolvedProviderApiKey(options, provider)
              }
            })
      }
    }
  }
}

export function createStaticModelResolver(options: {
  getPiModel?: (provider: KnownProvider, modelName: string) => Model<Api>
} = {}): ModelResolver {
  const getPiModel = options.getPiModel ?? defaultGetPiModel
  return {
    async resolve(input) {
      const legacy = parseLegacyModelId(input.modelId)
      const providerId = input.providerId ?? legacy.providerId ?? 'openai'
      const provider: ModelProviderConfig = {
        id: providerId,
        name: providerId,
        kind: providerId as ModelProviderKind,
        enabled: true,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }
      const modelConfig: ModelConfig = {
        id: input.modelId,
        providerId,
        modelName: legacy.modelName,
        displayName: legacy.modelName,
        capabilities: ['streaming'],
        enabled: true,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }
      return {
        model: getPiModel(providerId as KnownProvider, legacy.modelName),
        provider,
        modelConfig
      }
    }
  }
}
