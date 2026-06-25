import type { ModelCapability, ModelProviderKind } from './domain'

export type ModelCapabilityInferenceInput = {
  modelId: string
  modelName?: string
  providerId?: string
  providerKind?: ModelProviderKind
  existingCapabilities?: ModelCapability[]
}

export type SupportsImageInputInput = {
  modelId: string
  modelName?: string
  providerId?: string
  providerKind?: ModelProviderKind
  capabilities?: ModelCapability[]
}

function normalize(value: string | undefined) {
  return (value ?? '').toLowerCase()
}

function hasVisionLikeMarker(model: string) {
  const tokens = model.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return tokens.some((token) => token === 'vision' || token === 'vl' || token === 'image' || token === 'multimodal' || token === 'omni')
}

function inferImageInputSupport(modelId: string, modelName: string | undefined, providerId: string | undefined, providerKind?: ModelProviderKind) {
  const model = `${normalize(providerId)} ${normalize(modelId)} ${normalize(modelName)}`.trim()

  if (!model) return false
  if (providerKind === 'deepseek' || model.includes('deepseek')) return false

  if (model.includes('gemini')) return true
  if (/claude.*(?:3|4|5)/.test(model)) return true
  if (/gpt-(?:4o|4\.1|5(?:[.-].*)?)/.test(model)) return true
  if (model.includes('kimi') && /(k2\.6|k2p6)/.test(model)) return true

  if (model.includes('glm-4.7') || model.includes('glm-5')) {
    return hasVisionLikeMarker(model)
  }

  return hasVisionLikeMarker(model)
}

export function inferModelCapabilitiesFromName({ modelId, modelName, providerId, providerKind, existingCapabilities }: ModelCapabilityInferenceInput): ModelCapability[] {
  const capabilities = new Set(existingCapabilities ?? [])
  if (inferImageInputSupport(modelId, modelName, providerId, providerKind)) {
    capabilities.add('imageInput')
  }
  return [...capabilities]
}

export function supportsImageInput({ capabilities }: SupportsImageInputInput): boolean {
  return (capabilities ?? []).includes('imageInput')
}
