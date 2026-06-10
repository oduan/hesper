import type { Persistence } from '@hesper/persistence'
import { nowIso, type ModelConfig, type ModelProviderConfig, type ModelProviderKind } from '@hesper/shared'
import { providerApiKeyRef, type CredentialVaultService } from './credential-vault-service'

export type SaveModelProviderInput = {
  id: string
  name: string
  kind: ModelProviderKind
  baseUrl?: string
  enabled?: boolean
  defaultModelId?: string
}

export type SaveModelInput = {
  id: string
  providerId: string
  modelName: string
  displayName: string
  capabilities?: ModelConfig['capabilities']
  contextWindow?: number
  enabled?: boolean
}

export type ProviderConnectionTestResult = {
  providerId: string
  status: 'ok' | 'disabled' | 'needs_api_key' | 'not_found'
  hasApiKey: boolean
  message: string
}

export type ModelProviderService = {
  listProviders(): Promise<ModelProviderConfig[]>
  getProvider(id: string): Promise<ModelProviderConfig | undefined>
  saveProvider(input: SaveModelProviderInput): Promise<ModelProviderConfig>
  disableProvider(id: string): Promise<ModelProviderConfig>
  listModels(providerId?: string): Promise<ModelConfig[]>
  saveModel(input: SaveModelInput): Promise<ModelConfig>
  testProviderConnection(providerId: string): Promise<ProviderConnectionTestResult>
  ensureBuiltinProviders(): Promise<void>
}

const providerPresets: SaveModelProviderInput[] = [
  { id: 'mock', name: 'Mock', kind: 'mock', enabled: true, defaultModelId: 'mock/hesper-fast' },
  { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, defaultModelId: 'gpt-4o' },
  { id: 'openai-compatible', name: 'OpenAI Compatible', kind: 'openai-compatible', enabled: false, defaultModelId: 'openai-compatible/default' }
]

const modelPresets: SaveModelInput[] = [
  { id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming', 'toolCalls'], enabled: true },
  { id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true },
  { id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['streaming', 'toolCalls', 'jsonOutput'], enabled: true },
  { id: 'openai-compatible/default', providerId: 'openai-compatible', modelName: 'model-name', displayName: 'Custom model', capabilities: ['streaming', 'toolCalls'], enabled: false }
]

function assertId(id: string, label = 'id'): void {
  if (!id.trim()) throw new Error(`${label} is required`)
}

function mergeProvider(existing: ModelProviderConfig | undefined, input: SaveModelProviderInput, timestamp: string, hasApiKey: boolean): ModelProviderConfig {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    apiKeyRef: providerApiKeyRef(input.id),
    hasApiKey,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : existing?.baseUrl !== undefined ? { baseUrl: existing.baseUrl } : {}),
    ...(input.defaultModelId !== undefined ? { defaultModelId: input.defaultModelId } : existing?.defaultModelId !== undefined ? { defaultModelId: existing.defaultModelId } : {})
  }
}

function mergeModel(existing: ModelConfig | undefined, input: SaveModelInput, timestamp: string): ModelConfig {
  return {
    id: input.id,
    providerId: input.providerId,
    modelName: input.modelName,
    displayName: input.displayName,
    capabilities: input.capabilities ?? existing?.capabilities ?? ['streaming'],
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : existing?.contextWindow !== undefined ? { contextWindow: existing.contextWindow } : {})
  }
}

export function createModelProviderService(options: {
  persistence: Persistence
  credentialVaultService: CredentialVaultService
  now?: () => string
}): ModelProviderService {
  const now = options.now ?? nowIso

  const withCredentialStatus = async (provider: ModelProviderConfig): Promise<ModelProviderConfig> => {
    const credentialStatus = await options.credentialVaultService.getProviderApiKeyStatus({ providerId: provider.id })
    return {
      ...provider,
      apiKeyRef: credentialStatus.apiKeyRef,
      hasApiKey: credentialStatus.hasApiKey
    }
  }

  const saveProviderInternal = async (input: SaveModelProviderInput): Promise<ModelProviderConfig> => {
    assertId(input.id)
    assertId(input.name, 'name')
    const existing = await options.persistence.modelProviders.get(input.id)
    const credentialStatus = await options.credentialVaultService.getProviderApiKeyStatus({ providerId: input.id })
    const provider = mergeProvider(existing, input, now(), credentialStatus.hasApiKey)
    await options.persistence.modelProviders.save(provider)
    return withCredentialStatus(provider)
  }

  const saveModelInternal = async (input: SaveModelInput): Promise<ModelConfig> => {
    assertId(input.id)
    assertId(input.providerId, 'providerId')
    assertId(input.modelName, 'modelName')
    assertId(input.displayName, 'displayName')
    const provider = await options.persistence.modelProviders.get(input.providerId)
    if (!provider) throw new Error(`Model provider not found: ${input.providerId}`)
    const existing = await options.persistence.models.get(input.id)
    const model = mergeModel(existing, input, now())
    await options.persistence.models.save(model)
    return model
  }

  const ensureBuiltinProviders = async (): Promise<void> => {
    for (const provider of providerPresets) {
      if (!await options.persistence.modelProviders.get(provider.id)) {
        await saveProviderInternal(provider)
      }
    }
    for (const model of modelPresets) {
      if (!await options.persistence.models.get(model.id)) {
        await saveModelInternal(model)
      }
    }
  }

  return {
    async listProviders() {
      await ensureBuiltinProviders()
      return Promise.all((await options.persistence.modelProviders.list()).map(withCredentialStatus))
    },
    async getProvider(id) {
      assertId(id)
      await ensureBuiltinProviders()
      const provider = await options.persistence.modelProviders.get(id)
      return provider ? withCredentialStatus(provider) : undefined
    },
    async saveProvider(input) {
      return saveProviderInternal(input)
    },
    async disableProvider(id) {
      assertId(id)
      const existing = await options.persistence.modelProviders.get(id)
      if (!existing) throw new Error(`Model provider not found: ${id}`)
      const provider = await this.saveProvider({
        id: existing.id,
        name: existing.name,
        kind: existing.kind,
        enabled: false,
        ...(existing.baseUrl !== undefined ? { baseUrl: existing.baseUrl } : {}),
        ...(existing.defaultModelId !== undefined ? { defaultModelId: existing.defaultModelId } : {})
      })
      return provider
    },
    async listModels(providerId) {
      await ensureBuiltinProviders()
      return providerId ? options.persistence.models.listByProvider(providerId) : options.persistence.models.list()
    },
    async saveModel(input) {
      return saveModelInternal(input)
    },
    async testProviderConnection(providerId) {
      assertId(providerId, 'providerId')
      await ensureBuiltinProviders()
      const provider = await options.persistence.modelProviders.get(providerId)
      if (!provider) {
        return { providerId, status: 'not_found', hasApiKey: false, message: `Model provider not found: ${providerId}` }
      }
      if (!provider.enabled) {
        return { providerId, status: 'disabled', hasApiKey: false, message: `${provider.name} is disabled.` }
      }
      if (provider.kind === 'mock') {
        return { providerId, status: 'ok', hasApiKey: false, message: 'Mock provider is available.' }
      }
      const credentialStatus = await options.credentialVaultService.getProviderApiKeyStatus({ providerId })
      if (!credentialStatus.hasApiKey) {
        return { providerId, status: 'needs_api_key', hasApiKey: false, message: `${provider.name} needs an API key before it can be used.` }
      }
      return { providerId, status: 'ok', hasApiKey: true, message: `${provider.name} has credentials configured. Network test is deferred to the model resolver task.` }
    },
    async ensureBuiltinProviders() {
      await ensureBuiltinProviders()
    }
  }
}
