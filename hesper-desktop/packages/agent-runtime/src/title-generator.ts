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
  '你的唯一任务是根据最近一轮用户消息和助手回复生成一个简短标题。',
  '只输出标题，不要解释，不要 Markdown，不要引号，不要句号。',
  '标题应使用用户语言，中文标题建议 4 到 12 个汉字；英文标题建议不超过 8 个词。',
  '标题要具体概括任务目标，禁止输出“新会话”“新对话”“总结”“对话”等空泛词。'
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

function normalizeTitleForComparison(value: string): string {
  return value.replace(/[\s\-＿_—–,，.。!！?？:：;；"'“”‘’「」《》]/g, '').toLowerCase()
}

function isGenericTitle(value: string): boolean {
  const normalized = normalizeTitleForComparison(value)
  return [
    '新会话',
    '新对话',
    '新聊天',
    '新的会话',
    '新的对话',
    '会话',
    '对话',
    '聊天',
    '会话总结',
    '对话总结',
    '总结',
    'newchat',
    'newconversation',
    'conversation',
    'chat',
    'summary'
  ].includes(normalized)
}

function fallbackTitleFromText(value: string): string {
  const compact = value
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(请|麻烦|帮我|请帮我|能不能|可以帮我|我想|我要|帮忙)\s*/i, '')
    .replace(/^(分析|总结|生成|创建|写一个|设计|修复|实现|优化|改进|调整)\s+(.+)/i, '$1 $2')
    .replace(/[。.!！?？,，:：;；、]+$/g, '')
    .replace(/的问题$/g, '')
    .trim()

  if (!compact) return '整理当前任务'

  if (/[^\x00-\x7F]/.test(compact)) {
    return compact.replace(/\s+/g, '').slice(0, 18)
  }

  return compact.split(/\s+/).filter(Boolean).slice(0, 8).join(' ')
}

function chooseTitle(candidate: string, input: SessionTitleGenerationInput): string {
  const stripped = stripTitleNoise(candidate)
  if (stripped && !isGenericTitle(stripped)) {
    return stripped
  }

  return fallbackTitleFromText(input.userPrompt) || fallbackTitleFromText(input.assistantResponse)
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
    '请为下面这段最近一轮对话生成一个会话标题。',
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
      const title = chooseTitle(extractAssistantText(message), input)
      return {
        title,
        modelId: titleModel.modelId
      }
    }
  }
}
