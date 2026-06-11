import type { ModelDto, SaveModelInput } from '../../electron/ipc-contract'
import { hesperApi } from './ipc-client'

export const defaultFallbackModelId = 'mock/hesper-fast'
export const fallbackSessionModelOptions = [defaultFallbackModelId]

export const validModelCapabilities: Array<NonNullable<SaveModelInput['capabilities']>[number]> = [
  'streaming',
  'toolCalls',
  'jsonOutput',
  'reasoning'
]

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

export function parseModelCapabilities(value: string): {
  capabilities?: SaveModelInput['capabilities']
  invalidCapabilities: string[]
} {
  const entries = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const capabilities: NonNullable<SaveModelInput['capabilities']> = []
  const invalidCapabilities: string[] = []

  for (const entry of entries) {
    if (validModelCapabilities.includes(entry as NonNullable<SaveModelInput['capabilities']>[number])) {
      capabilities.push(entry as NonNullable<SaveModelInput['capabilities']>[number])
    } else {
      invalidCapabilities.push(entry)
    }
  }

  return {
    ...(capabilities.length ? { capabilities } : {}),
    invalidCapabilities
  }
}
