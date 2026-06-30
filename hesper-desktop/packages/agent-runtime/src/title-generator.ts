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

type TitleCompleteOptions = SimpleStreamOptions & { serviceTier?: 'priority' }

export type SessionTitleGenerator = {
  generateTitle(input: SessionTitleGenerationInput): Promise<SessionTitleGenerationResult | undefined>
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

function containsJsonObject(value: string): boolean {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  return /\{[\s\S]*\}/.test(trimmed)
}

function validGeneratedTitle(candidate: string): string | undefined {
  const parsedTitle = parseJsonTitle(candidate)
  if (parsedTitle === undefined && containsJsonObject(candidate)) {
    return undefined
  }

  const stripped = stripTitleNoise(parsedTitle ?? candidate)
  if (!stripped || isGenericTitle(stripped)) {
    return undefined
  }
  return stripped
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withJsonOutput(payload: unknown, model: Model<Api>): unknown {
  if (!isRecord(payload)) return payload

  if (model.api === 'openai-completions') {
    return {
      ...payload,
      response_format: { type: 'json_object' }
    }
  }

  if (model.api === 'openai-responses' || model.api === 'azure-openai-responses') {
    return {
      ...payload,
      text: {
        ...(isRecord(payload.text) ? payload.text : {}),
        format: { type: 'json_object' }
      }
    }
  }

  return payload
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
  const titleModel = providerModels.find(isEnabled)
  return {
    modelId: titleModel?.id ?? usedModel?.id ?? usedModelId,
    providerId
  }
}

function createTitlePrompt(input: SessionTitleGenerationInput): string {
  return [
    '请只根据下面的用户输入生成会话标题。',
    '',
    '要求：',
    '1. 标题要反映用户正在做的具体事情，让人一眼看出这个对话用途。',
    '2. 不要输出“新会话”“新对话”“会话”“对话”“聊天”“总结”等泛化标题。',
    '3. 只返回 JSON，不要 Markdown，不要代码块，不要额外解释。',
    '4. JSON 格式必须是：{"title":"标题"}',
    '',
    '输入示例：帮我修复登录按钮点击无响应的问题',
    'JSON 输出示例：{"title":"修复登录按钮无响应"}',
    '',
    `用户输入：${normalizeText(input.userPrompt, 1600)}`,
    '',
    '只返回 JSON：'
  ].filter((line): line is string => line !== undefined).join('\n')
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
          messages: [{ role: 'user', content: createTitlePrompt(input), timestamp: Date.now() }]
        },
        {
          maxTokens: 512,
          ...(resolved.model.api === 'openai-codex-responses' ? {} : { temperature: 0 }),
          onPayload: (payload, model) => withJsonOutput(payload, model),
          ...(apiKey ? { apiKey } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          ...(resolved.runtimeOptions?.serviceTier ? { serviceTier: resolved.runtimeOptions.serviceTier } : {})
        } as TitleCompleteOptions
      )
      if (message.stopReason === 'error') {
        throw new Error(message.errorMessage ?? 'Title generation failed')
      }

      const text = extractAssistantText(message)
      if (!text) return undefined

      const title = validGeneratedTitle(text)
      if (title) {
        return {
          title,
          modelId: titleModel.modelId
        }
      }

      throw new Error(`Title generation returned invalid title: ${text}`)
    }
  }
}
