import { completeSimple } from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import type { ModelConfig } from '@hesper/shared'
import { parseLegacyModelId, type ModelRegistryReader, type ModelResolver } from './model-resolver'

export type SessionTitleGenerationInput = {
  usedModelId: string
  userPrompt: string
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

function parseJsonTitle(value: string): string | undefined {
  const trimmed = value.trim()
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim(),
    trimmed.match(/\{[\s\S]*\}/)?.[0]
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { title?: unknown }
      if (typeof parsed.title === 'string') {
        return parsed.title
      }
    } catch {
      // Try the next candidate.
    }
  }

  return undefined
}

function validGeneratedTitle(candidate: string): string | undefined {
  const parsedTitle = parseJsonTitle(candidate)
  const stripped = parsedTitle ? stripTitleNoise(parsedTitle) : undefined
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
    '请根据下面的用户输入生成一个短会话标题。',
    '',
    '要求：',
    '1. 标题要反映用户正在做的具体事情，让人一眼看出这个对话用途。',
    '2. 中文标题建议 6-18 个汉字；英文标题不超过 8 个词。',
    '3. 不要输出“新会话”“新对话”“会话”“对话”“聊天”“总结”等泛化标题。',
    '4. 只返回 JSON，不要 Markdown，不要代码块，不要额外解释。',
    '5. JSON 格式必须是：{"title":"标题"}',
    previousInvalidTitle ? `6. 上一次输出无效：${previousInvalidTitle}。请根据用户输入重新给出具体标题。` : undefined,
    '',
    `用户输入：${normalizeText(input.userPrompt, 1600)}`,
    '',
    '只返回 JSON：'
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
