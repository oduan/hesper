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

function isTooLongTitle(value: string): boolean {
  if (/[^\x00-\x7F]/.test(value)) {
    return value.replace(/\s+/g, '').length > 24
  }
  return value.split(/\s+/).filter(Boolean).length > 10
}

function validGeneratedTitle(candidate: string): string | undefined {
  const stripped = stripTitleNoise(candidate)
  if (!stripped || isGenericTitle(stripped) || isTooLongTitle(stripped)) {
    return undefined
  }
  return stripped
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

function createTitlePrompt(input: SessionTitleGenerationInput, previousInvalidTitle?: string): string {
  return [
    previousInvalidTitle ? `上一次输出无效：${previousInvalidTitle}。它太泛化、为空或过长，没有体现最近一轮对话正在做的具体事情。` : undefined,
    '请根据下面这段最近一轮对话生成一个会话标题。',
    '',
    '目标：用户只看标题，就能知道这个对话正在做什么。',
    '',
    '硬性要求：',
    '1. 只输出标题本身，不要解释，不要 Markdown，不要引号。',
    '2. 标题必须包含具体任务对象或正在处理的问题。',
    '3. 中文 6-18 个汉字左右；英文不超过 8 个词。',
    '4. 禁止输出：新会话、新对话、会话、对话、聊天、总结、当前任务。',
    '5. 不要复述“用户消息”“助手回复”等标签。',
    '',
    '示例：',
    '用户消息：帮我修复登录按钮点击无响应的问题',
    '助手回复：可以，从事件绑定、禁用状态和请求错误三个方向排查。',
    '标题：登录按钮无响应修复',
    '',
    '最近一轮对话：',
    `<用户消息>${normalizeText(input.userPrompt, 1200)}</用户消息>`,
    `<Agent回答>${normalizeText(input.assistantResponse, 1600)}</Agent回答>`,
    '',
    '请输出标题：'
  ].filter(Boolean).join('\n')
}

export function createSessionTitleGenerator(options: SessionTitleGeneratorOptions): SessionTitleGenerator {
  const complete = options.complete ?? completeSimple

  return {
    async generateTitle(input) {
      const titleModel = await resolveTitleModel(options.registry, input.usedModelId)
      const resolved = await options.modelResolver.resolve(titleModel)
      const apiKey = await resolved.getApiKey?.(resolved.model.provider) ?? await resolved.getApiKey?.(resolved.provider.id)
      let previousInvalidTitle: string | undefined

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const message = await complete(
          resolved.model,
          {
            systemPrompt: titleSystemPrompt,
            messages: [{ role: 'user', content: createTitlePrompt(input, previousInvalidTitle), timestamp: Date.now() }]
          },
          {
            maxTokens: 48,
            temperature: 0,
            reasoning: 'minimal',
            ...(apiKey ? { apiKey } : {}),
            ...(input.signal ? { signal: input.signal } : {})
          }
        )
        previousInvalidTitle = extractAssistantText(message)
        const title = validGeneratedTitle(previousInvalidTitle)
        if (title) {
          return {
            title,
            modelId: titleModel.modelId
          }
        }
      }

      throw new Error(`Title generation returned invalid title: ${previousInvalidTitle || '(empty)'}`)
    }
  }
}
