import type { ModelDto, ModelProviderDto } from '../../electron/ipc-contract'
import type { ModelOptionGroup } from '@hesper/ui'
import { hesperApi } from './ipc-client'

export const defaultFallbackModelId = 'mock/hesper-fast'
export const fallbackSessionModelOptions = [defaultFallbackModelId]

export type SessionModelCatalog = {
  options: string[]
  optionGroups: ModelOptionGroup[]
  preferredModelId: string
}

export const fallbackSessionModelCatalog: SessionModelCatalog = {
  options: fallbackSessionModelOptions,
  optionGroups: [],
  preferredModelId: defaultFallbackModelId
}

export function namespaceModelId(providerId: string, modelName: string): string {
  const normalizedProviderId = providerId.trim()
  const normalizedModelName = modelName.trim()
  if (!normalizedProviderId || !normalizedModelName) {
    return normalizedModelName || normalizedProviderId
  }

  if (normalizedModelName.startsWith(`${normalizedProviderId}/`) || normalizedModelName.startsWith(`${normalizedProviderId}:`)) {
    return normalizedModelName
  }

  return `${normalizedProviderId}/${normalizedModelName}`
}

export function modelNameFromNamespacedId(providerId: string, modelId: string): string {
  const normalizedProviderId = providerId.trim()
  const normalizedModelId = modelId.trim()
  if (!normalizedProviderId || !normalizedModelId) {
    return normalizedModelId
  }

  for (const separator of ['/', ':']) {
    const prefix = `${normalizedProviderId}${separator}`
    if (normalizedModelId.startsWith(prefix)) {
      return normalizedModelId.slice(prefix.length)
    }
  }

  return normalizedModelId
}

export function mergeModelOptions(...optionGroups: Array<Array<string | undefined>>): string[] {
  const seen = new Set<string>()
  const options: string[] = []

  for (const group of optionGroups) {
    for (const option of group) {
      const normalized = option?.trim()
      if (!normalized || seen.has(normalized)) {
        continue
      }
      seen.add(normalized)
      options.push(normalized)
    }
  }

  return options
}

export function createSessionModelOptions(models: ModelDto[]): string[] {
  return mergeModelOptions(
    fallbackSessionModelOptions,
    models.filter((model) => model.enabled !== false).map((model) => model.id)
  )
}

function defaultModelForProvider(provider: ModelProviderDto, modelIds: string[]): string | undefined {
  if (provider.defaultModelId && modelIds.includes(provider.defaultModelId)) {
    return provider.defaultModelId
  }
  return modelIds[0]
}

export function createSessionModelCatalog(providers: ModelProviderDto[], models: ModelDto[]): SessionModelCatalog {
  const enabledProviders = providers.filter((provider) => provider.enabled !== false)
  const enabledProviderIds = new Set(enabledProviders.map((provider) => provider.id))
  const enabledModels = models.filter((model) => model.enabled !== false && enabledProviderIds.has(model.providerId))

  const optionGroups: ModelOptionGroup[] = enabledProviders
    .map((provider) => {
      const providerModels = enabledModels.filter((model) => model.providerId === provider.id)
      return {
        id: provider.id,
        label: provider.name,
        options: providerModels.map((model) => ({
          value: model.id,
          label: `${provider.name}/${model.modelName}`
        }))
      }
    })
    .filter((group) => group.options.length > 0)

  if (optionGroups.length === 0) {
    return fallbackSessionModelCatalog
  }

  const modelIds = optionGroups.flatMap((group) => group.options.map((option) => option.value))
  const providerHasEnabledModel = (provider: ModelProviderDto) => enabledModels.some((model) => model.providerId === provider.id)
  const preferredConfiguredProvider = enabledProviders.find((provider) => provider.kind !== 'mock' && provider.hasApiKey && providerHasEnabledModel(provider))
  const preferredProvider = preferredConfiguredProvider ?? enabledProviders.find((provider) => provider.kind === 'mock' && providerHasEnabledModel(provider)) ?? enabledProviders[0]
  const preferredProviderModelIds = preferredProvider ? enabledModels.filter((model) => model.providerId === preferredProvider.id).map((model) => model.id) : []
  const preferredModelId = preferredProvider ? defaultModelForProvider(preferredProvider, preferredProviderModelIds) ?? modelIds[0] ?? defaultFallbackModelId : defaultFallbackModelId

  return {
    options: modelIds,
    optionGroups,
    preferredModelId
  }
}

export async function loadAvailableModelCatalog(): Promise<SessionModelCatalog> {
  const listModels = hesperApi.models?.list
  const listProviders = (hesperApi as typeof hesperApi & { providers?: typeof hesperApi.providers }).providers?.list
  if (!listModels) {
    return fallbackSessionModelCatalog
  }

  const models = await listModels()
  if (!listProviders) {
    return {
      options: createSessionModelOptions(models),
      optionGroups: [],
      preferredModelId: defaultFallbackModelId
    }
  }

  const providers = await listProviders()
  return createSessionModelCatalog(providers, models)
}

export async function loadAvailableModelOptions(): Promise<string[]> {
  return (await loadAvailableModelCatalog()).options
}

