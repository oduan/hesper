import type { ModelDto } from '../../electron/ipc-contract'
import { hesperApi } from './ipc-client'

export const defaultFallbackModelId = 'mock/hesper-fast'
export const fallbackSessionModelOptions = [defaultFallbackModelId]

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

export async function loadAvailableModelOptions(): Promise<string[]> {
  const listModels = hesperApi.models?.list
  if (!listModels) {
    return fallbackSessionModelOptions
  }

  return createSessionModelOptions(await listModels())
}

