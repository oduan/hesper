import { completeSimple } from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import type { ModelConfig } from '@hesper/shared'
import { parseLegacyModelId, type ModelRegistryReader, type ModelResolver } from './model-resolver'

export type SessionTitleGenerationInput = {
  usedModelId: string
  userPrompt: string
  assistantResponse: string
  signal?: AbortSignal
}

export type SessionTitleGenerationResult = {
  title: string
  modelId: string
}

export type CompleteSimple = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => Promise<AssistantMessage>

export type SessionTitleGenerator = {
  generateTitle(input: SessionTitleGenerationInput): Promise<SessionTitleGenerationResult>
}

export type SessionTitleGeneratorOptions = {
  registry: ModelRegistryReader
  modelResolver: ModelResolver
  complete?: CompleteSimple
}

const titleSystemPrompt = [
  '你是 Hesper 的会话标题生成器。',
  '你的唯一任务是根据第一轮用户消息和助手回复生成一个简短标题。',
  '只输出标题，不要解释，不要 Markdown，不要引号，不要句号。',
  '标题应使用用户语言，中文标题建议 4 到 12 个汉字；英文标题建议不超过 8 个词。',
  '标题要具体概括任务目标，避免“新会话”“总结”“对话”等空泛词。'
].join('\n')

function normalizeText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact
}

function stripTitleNoise(value: string): string {
  return value
    .replace(/^\s*["'“”‘’「」《》]+/, '')
    .replace(/["'“”‘’「」《》。.!！?？]+\s*$/, '')
    .replace(/^标题\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .flatMap((part) => part.type === 'text' ? [part.text] : [])
    .join(' ')
    .trim()
}

function isEnabled(model: ModelConfig): boolean {
  return model.enabled !== false
}

async function findUsedModel(registry: ModelRegistryReader, usedModelId: string): Promise<ModelConfig | undefined> {
  const models = await registry.listModels()
  const exact = models.find((model) => model.id === usedModelId)
  if (exact) return exact

  const legacy = parseLegacyModelId(usedModelId)
  const scopedModels = legacy.providerId ? await registry.listModels(legacy.providerId) : models
  return scopedModels.find((model) => model.id === legacy.modelName || model.modelName === legacy.modelName)
}

async function resolveTitleModel(registry: ModelRegistryReader, usedModelId: string): Promise<{ modelId: string; providerId?: string }> {
  await registry.ensureReady?.()
  const usedModel = await findUsedModel(registry, usedModelId)
  const legacy = parseLegacyModelId(usedModelId)
  const providerId = usedModel?.providerId ?? legacy.providerId

  if (!providerId) {
    return { modelId: usedModelId }
  }

  const providerModels = await registry.listModels(providerId)
  const firstEnabled = providerModels.find(isEnabled)
  return {
    modelId: firstEnabled?.id ?? usedModel?.id ?? usedModelId,
    providerId
  }
}

function createTitlePrompt(input: SessionTitleGenerationInput): string {
  return [
    '请为下面这段第一轮对话生成一个会话标题。',
    '',
    `用户消息：${normalizeText(input.userPrompt, 1200)}`,
    '',
    `助手回复：${normalizeText(input.assistantResponse, 1600)}`,
    '',
    '再次强调：只输出标题本身。'
  ].join('\n')
}

export function createSessionTitleGenerator(options: SessionTitleGeneratorOptions): SessionTitleGenerator {
  const complete = options.complete ?? completeSimple

  return {
    async generateTitle(input) {
      const titleModel = await resolveTitleModel(options.registry, input.usedModelId)
      const resolved = await options.modelResolver.resolve(titleModel)
      const apiKey = await resolved.getApiKey?.(resolved.model.provider) ?? await resolved.getApiKey?.(resolved.provider.id)
      const message = await complete(
        resolved.model,
        {
          systemPrompt: titleSystemPrompt,
          messages: [{ role: 'user', content: createTitlePrompt(input), timestamp: Date.now() }]
        },
        {
          maxTokens: 32,
          reasoning: 'minimal',
          ...(apiKey ? { apiKey } : {}),
          ...(input.signal ? { signal: input.signal } : {})
        }
      )
      const title = stripTitleNoise(extractAssistantText(message))
      return {
        title: title || '新会话',
        modelId: titleModel.modelId
      }
    }
  }
}
