type KnownModelInput = {
  id: string
  modelName: string
  providerId: string
}

const knownContextWindowsByModelName = new Map<string, number>([
  ['deepseek-v4-flash', 1_000_000],
  ['deepseek-v4-pro', 1_000_000],
  ['mimo-v2.5', 1_000_000],
  ['mimo-v2.5-pro', 1_000_000],
  ['glm-5.2', 1_000_000],
  ['kimi-k2.7-code', 256_000],
  ['kimi-2.7', 256_000]
])

const retiredDeepSeekModelIds = new Set(['deepseek-chat', 'deepseek-reasoner'])
const retiredDeepSeekSuccessorsByModelId = new Map<string, string>([
  ['deepseek-chat', 'deepseek-v4-flash'],
  ['deepseek-reasoner', 'deepseek-v4-flash']
])
const testModelIds = new Set(['mock/hesper-fast'])

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function modelIdWithoutProviderPrefix(input: KnownModelInput): string {
  const normalizedProviderId = normalize(input.providerId)
  const normalizedId = normalize(input.id)
  if (!normalizedProviderId || !normalizedId) return normalizedId

  for (const separator of ['/', ':']) {
    const prefix = `${normalizedProviderId}${separator}`
    if (normalizedId.startsWith(prefix)) {
      return normalizedId.slice(prefix.length)
    }
  }

  return normalizedId
}

function candidateModelKeys(input: KnownModelInput): string[] {
  const normalizedId = normalize(input.id)
  const normalizedModelName = normalize(input.modelName)
  const denamespacedId = modelIdWithoutProviderPrefix(input)
  const slashSuffix = normalizedId.includes('/') ? normalizedId.slice(normalizedId.lastIndexOf('/') + 1) : normalizedId
  const colonSuffix = normalizedId.includes(':') ? normalizedId.slice(normalizedId.lastIndexOf(':') + 1) : normalizedId

  return [...new Set([
    normalizedModelName,
    denamespacedId,
    slashSuffix,
    colonSuffix,
    normalizedId
  ].filter(Boolean))]
}

export function knownContextWindowForModel(input: KnownModelInput): number | undefined {
  for (const key of candidateModelKeys(input)) {
    const contextWindow = knownContextWindowsByModelName.get(key)
    if (contextWindow !== undefined) return contextWindow
  }
  return undefined
}

export function isRetiredOrTestModel(input: KnownModelInput): boolean {
  const candidates = candidateModelKeys(input)
  if (candidates.some((key) => testModelIds.has(key))) return true
  if (normalize(input.providerId) !== 'deepseek') return false

  return candidates.some((key) => retiredDeepSeekModelIds.has(key))
}

export function preferredSuccessorModelNameForRetiredModel(input: KnownModelInput): string | undefined {
  if (normalize(input.providerId) !== 'deepseek') return undefined

  for (const key of candidateModelKeys(input)) {
    const successor = retiredDeepSeekSuccessorsByModelId.get(key)
    if (successor !== undefined) return successor
  }
  return undefined
}

export function modelMatchesKnownModelName(input: KnownModelInput, modelName: string): boolean {
  const normalizedModelName = normalize(modelName)
  return Boolean(normalizedModelName) && candidateModelKeys(input).includes(normalizedModelName)
}
