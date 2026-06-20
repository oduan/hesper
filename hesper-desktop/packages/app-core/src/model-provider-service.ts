import type { Persistence } from '@hesper/persistence'
import { nowIso, type ModelConfig, type ModelProviderConfig, type ModelProviderKind } from '@hesper/shared'
import { providerApiKeyRef, type CredentialVaultService } from './credential-vault-service'

export type PiAuthProvider = 'openai-codex'
export type ProviderOAuthStatus = 'pending' | 'authorized' | 'failed'

export type ProviderOAuthGateway = {
  startAuthorization(input: { provider: PiAuthProvider; connectionName: string }): Promise<{ sessionId: string; authorizationUrl: string }>
  getAuthorizationStatus(input: { sessionId: string }): Promise<{ status: ProviderOAuthStatus; message: string }>
  consumeAuthorization(input: { sessionId: string }): Promise<{
    accessToken: string
    models: Array<{ id: string; modelName: string; displayName: string; capabilities: ModelConfig['capabilities']; contextWindow?: number }>
    defaultModelId: string
  }>
}

export type SaveModelProviderInput = {
  id: string
  name: string
  kind: ModelProviderKind
  authType?: ModelProviderConfig['authType']
  piAuthProvider?: ModelProviderConfig['piAuthProvider']
  baseUrl?: string
  enabled?: boolean
  defaultModelId?: string
}

export type SaveModelInput = {
  id: string
  providerId: string
  modelName: string
  displayName: string
  capabilities?: ModelConfig['capabilities']
  contextWindow?: number
  enabled?: boolean
}

export type ProviderConnectionTestStatus = 'ok' | 'disabled' | 'needs_api_key' | 'not_found' | 'failed'

export type ProviderConnectionTestInput = {
  providerId?: string | undefined
  kind?: ModelProviderKind | undefined
  baseUrl?: string | undefined
  apiKey?: string | undefined
  modelId?: string | undefined
}

export type ProviderConnectionTestResult = {
  providerId: string
  status: ProviderConnectionTestStatus
  hasApiKey: boolean
  message: string
}

export type ModelProviderService = {
  listProviders(): Promise<ModelProviderConfig[]>
  getProvider(id: string): Promise<ModelProviderConfig | undefined>
  saveProvider(input: SaveModelProviderInput): Promise<ModelProviderConfig>
  disableProvider(id: string): Promise<ModelProviderConfig>
  deleteProvider(id: string): Promise<ModelProviderConfig | undefined>
  listModels(providerId?: string): Promise<ModelConfig[]>
  saveModel(input: SaveModelInput): Promise<ModelConfig>
  startOAuthAuthorization(input: { provider: PiAuthProvider; connectionName: string }): Promise<{ provider: PiAuthProvider; sessionId: string; authorizationUrl: string; status: ProviderOAuthStatus; message: string }>
  getOAuthAuthorizationStatus(input: { sessionId: string }): Promise<{ provider: PiAuthProvider; sessionId: string; status: ProviderOAuthStatus; message: string }>
  saveOAuthConnection(input: { sessionId: string; connectionName: string }): Promise<ModelProviderConfig>
  testProviderConnection(input: string | ProviderConnectionTestInput): Promise<ProviderConnectionTestResult>
  ensureBuiltinProviders(): Promise<void>
}

const providerPresets: SaveModelProviderInput[] = [
  { id: 'mock', name: 'Mock', kind: 'mock', enabled: true, defaultModelId: 'mock/hesper-fast' },
  { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, defaultModelId: 'gpt-4o' },
  { id: 'openai-compatible', name: 'OpenAI Compatible', kind: 'openai-compatible', enabled: false, defaultModelId: 'openai-compatible/default' }
]

const modelPresets: SaveModelInput[] = [
  { id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming', 'toolCalls'], enabled: true },
  { id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true },
  { id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['streaming', 'toolCalls', 'jsonOutput'], enabled: true },
  { id: 'openai-compatible/default', providerId: 'openai-compatible', modelName: 'model-name', displayName: 'Custom model', capabilities: ['streaming', 'toolCalls'], enabled: false }
]

const builtinProviderIds = new Set(providerPresets.map((provider) => provider.id))
const connectionTestPrompt = 'Reply with only: hesper-ok'
const connectionTestTimeoutMs = 15_000

function assertId(id: string, label = 'id'): void {
  if (!id.trim()) throw new Error(`${label} is required`)
}

function mergeProvider(existing: ModelProviderConfig | undefined, input: SaveModelProviderInput, timestamp: string, hasApiKey: boolean): ModelProviderConfig {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    apiKeyRef: providerApiKeyRef(input.id),
    hasApiKey,
    ...(input.authType !== undefined ? { authType: input.authType } : existing?.authType !== undefined ? { authType: existing.authType } : {}),
    ...(input.piAuthProvider !== undefined ? { piAuthProvider: input.piAuthProvider } : existing?.piAuthProvider !== undefined ? { piAuthProvider: existing.piAuthProvider } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : existing?.baseUrl !== undefined ? { baseUrl: existing.baseUrl } : {}),
    ...(input.defaultModelId !== undefined ? { defaultModelId: input.defaultModelId } : existing?.defaultModelId !== undefined ? { defaultModelId: existing.defaultModelId } : {})
  }
}

function mergeModel(existing: ModelConfig | undefined, input: SaveModelInput, timestamp: string): ModelConfig {
  return {
    id: input.id,
    providerId: input.providerId,
    modelName: input.modelName,
    displayName: input.displayName,
    capabilities: input.capabilities ?? existing?.capabilities ?? ['streaming'],
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : existing?.contextWindow !== undefined ? { contextWindow: existing.contextWindow } : {})
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeModelName(providerId: string, modelId: string): string {
  const namespacePrefix = `${providerId}/`
  return modelId.startsWith(namespacePrefix) ? modelId.slice(namespacePrefix.length) : modelId
}

function endpointWithSuffix(baseUrl: string, suffix: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  return normalizedBase.endsWith(suffix) ? normalizedBase : `${normalizedBase}${suffix}`
}

function anthropicMessagesEndpoint(baseUrl: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  if (normalizedBase.endsWith('/v1/messages')) return normalizedBase
  if (normalizedBase.endsWith('/messages')) return normalizedBase
  if (normalizedBase.endsWith('/v1')) return `${normalizedBase}/messages`
  return `${normalizedBase}/v1/messages`
}

function truncateForMessage(value: string, maxLength = 360): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

function redactSensitive(value: string, apiKey: string | undefined): string {
  let redacted = value
  if (apiKey) {
    redacted = redacted.split(apiKey).join('[redacted]')
  }
  return redacted.replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, 'Bearer [redacted]')
}

function unknownToMessage(error: unknown, apiKey: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error)
  return truncateForMessage(redactSensitive(message, apiKey))
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null ? value as JsonRecord : undefined
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return trimOptional(value)
  if (!Array.isArray(value)) return undefined
  return trimOptional(value.map((item) => {
    const record = asRecord(item)
    return typeof record?.text === 'string' ? record.text : ''
  }).join(' '))
}

function extractOpenAIResponseText(payload: unknown): string | undefined {
  const record = asRecord(payload)
  if (!record) return undefined
  if (typeof record.output_text === 'string') return trimOptional(record.output_text)

  const choices = Array.isArray(record.choices) ? record.choices : []
  const firstChoice = asRecord(choices[0])
  const message = asRecord(firstChoice?.message)
  return textFromContent(message?.content) ?? textFromContent(message?.reasoning_content) ?? textFromContent(firstChoice?.text)
}

function extractAnthropicResponseText(payload: unknown): string | undefined {
  const record = asRecord(payload)
  return textFromContent(record?.content)
}

async function responsePayload(response: Response): Promise<{ text: string; json?: unknown }> {
  const text = await response.text()
  if (!text.trim()) return { text }
  try {
    return { text, json: JSON.parse(text) as unknown }
  } catch {
    return { text }
  }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), connectionTestTimeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

function failedResult(provider: ModelProviderConfig, hasApiKey: boolean, message: string): ProviderConnectionTestResult {
  return { providerId: provider.id, status: 'failed', hasApiKey, message }
}

async function probeOpenAICompatibleConnection(options: {
  fetchImpl: typeof fetch
  provider: ModelProviderConfig
  baseUrl: string
  apiKey: string
  modelName: string
}): Promise<ProviderConnectionTestResult> {
  const endpoint = endpointWithSuffix(options.baseUrl, '/chat/completions')
  try {
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({
        model: options.modelName,
        messages: [{ role: 'user', content: connectionTestPrompt }],
        temperature: 0,
        max_tokens: 16
      })
    })
    const payload = await responsePayload(response)
    if (!response.ok) {
      return failedResult(options.provider, true, `连接失败：API 返回 HTTP ${response.status}。${truncateForMessage(redactSensitive(payload.text || response.statusText, options.apiKey))}`)
    }
    const assistantText = extractOpenAIResponseText(payload.json)
    if (!assistantText) {
      return failedResult(options.provider, true, '连接失败：API 返回成功状态，但响应格式中没有可读取的 assistant 内容。请检查协议类型、Endpoint 和模型是否匹配。')
    }
    return { providerId: options.provider.id, status: 'ok', hasApiKey: true, message: '连接成功' }
  } catch (error) {
    return failedResult(options.provider, true, `连接失败：${unknownToMessage(error, options.apiKey)}`)
  }
}

async function probeAnthropicConnection(options: {
  fetchImpl: typeof fetch
  provider: ModelProviderConfig
  baseUrl: string
  apiKey: string
  modelName: string
}): Promise<ProviderConnectionTestResult> {
  const endpoint = anthropicMessagesEndpoint(options.baseUrl)
  try {
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': options.apiKey
      },
      body: JSON.stringify({
        model: options.modelName,
        messages: [{ role: 'user', content: connectionTestPrompt }],
        max_tokens: 16
      })
    })
    const payload = await responsePayload(response)
    if (!response.ok) {
      return failedResult(options.provider, true, `连接失败：API 返回 HTTP ${response.status}。${truncateForMessage(redactSensitive(payload.text || response.statusText, options.apiKey))}`)
    }
    const assistantText = extractAnthropicResponseText(payload.json)
    if (!assistantText) {
      return failedResult(options.provider, true, '连接失败：API 返回成功状态，但响应格式中没有可读取的 assistant 内容。请检查协议类型、Endpoint 和模型是否匹配。')
    }
    return { providerId: options.provider.id, status: 'ok', hasApiKey: true, message: '连接成功' }
  } catch (error) {
    return failedResult(options.provider, true, `连接失败：${unknownToMessage(error, options.apiKey)}`)
  }
}

export function createModelProviderService(options: {
  persistence: Persistence
  credentialVaultService: CredentialVaultService
  now?: () => string
  fetch?: typeof fetch
  oauthGateway?: ProviderOAuthGateway
}): ModelProviderService {
  const now = options.now ?? nowIso
  const connectionTestFetch = options.fetch ?? globalThis.fetch
  const oauthGateway = options.oauthGateway
  const oauthSessions = new Map<string, { provider: PiAuthProvider; connectionName: string }>()
  const providerMetadata = new Map<string, { authType?: ModelProviderConfig['authType']; piAuthProvider?: ModelProviderConfig['piAuthProvider'] }>()

  const rememberProviderMetadata = (provider: ModelProviderConfig): void => {
    if (provider.authType === undefined && provider.piAuthProvider === undefined) {
      providerMetadata.delete(provider.id)
      return
    }
    providerMetadata.set(provider.id, {
      ...(provider.authType !== undefined ? { authType: provider.authType } : {}),
      ...(provider.piAuthProvider !== undefined ? { piAuthProvider: provider.piAuthProvider } : {})
    })
  }

  const hydrateProviderMetadata = (provider: ModelProviderConfig): ModelProviderConfig => {
    const metadata = providerMetadata.get(provider.id)
    return {
      ...provider,
      ...(provider.authType !== undefined ? { authType: provider.authType } : metadata?.authType !== undefined ? { authType: metadata.authType } : {}),
      ...(provider.piAuthProvider !== undefined ? { piAuthProvider: provider.piAuthProvider } : metadata?.piAuthProvider !== undefined ? { piAuthProvider: metadata.piAuthProvider } : {})
    }
  }

  const withCredentialStatus = async (provider: ModelProviderConfig): Promise<ModelProviderConfig> => {
    const hydratedProvider = hydrateProviderMetadata(provider)
    const credentialStatus = await options.credentialVaultService.getProviderApiKeyStatus({ providerId: provider.id })
    return {
      ...hydratedProvider,
      apiKeyRef: credentialStatus.apiKeyRef,
      hasApiKey: credentialStatus.hasApiKey
    }
  }

  const saveProviderInternal = async (input: SaveModelProviderInput): Promise<ModelProviderConfig> => {
    assertId(input.id)
    assertId(input.name, 'name')
    const existing = await options.persistence.modelProviders.get(input.id)
    const hydratedExisting = existing ? hydrateProviderMetadata(existing) : undefined
    const credentialStatus = await options.credentialVaultService.getProviderApiKeyStatus({ providerId: input.id })
    const provider = mergeProvider(hydratedExisting, input, now(), credentialStatus.hasApiKey)
    rememberProviderMetadata(provider)
    await options.persistence.modelProviders.save(provider)
    return withCredentialStatus(provider)
  }

  const saveModelInternal = async (input: SaveModelInput): Promise<ModelConfig> => {
    assertId(input.id)
    assertId(input.providerId, 'providerId')
    assertId(input.modelName, 'modelName')
    assertId(input.displayName, 'displayName')
    const provider = await options.persistence.modelProviders.get(input.providerId)
    if (!provider) throw new Error(`Model provider not found: ${input.providerId}`)
    const existing = await options.persistence.models.get(input.id)
    const model = mergeModel(existing, input, now())
    await options.persistence.models.save(model)
    return model
  }

  const ensureBuiltinProviders = async (): Promise<void> => {
    for (const provider of providerPresets) {
      if (!await options.persistence.modelProviders.get(provider.id)) {
        await saveProviderInternal(provider)
      }
    }
    for (const model of modelPresets) {
      if (!await options.persistence.models.get(model.id)) {
        await saveModelInternal(model)
      }
    }
  }

  const connectionTestInput = (input: string | ProviderConnectionTestInput): ProviderConnectionTestInput => (
    typeof input === 'string' ? { providerId: input } : input
  )

  const readApiKeyForTest = async (providerId: string | undefined, inlineApiKey: string | undefined): Promise<string | undefined> => {
    if (inlineApiKey) return inlineApiKey
    if (!providerId) return undefined
    return trimOptional(await options.credentialVaultService.readProviderApiKey(providerId))
  }

  const requireOAuthGateway = (): ProviderOAuthGateway => {
    if (!oauthGateway) throw new Error('OAuth gateway is not configured')
    return oauthGateway
  }

  return {
    async listProviders() {
      await ensureBuiltinProviders()
      return Promise.all((await options.persistence.modelProviders.list()).map(withCredentialStatus))
    },
    async getProvider(id) {
      assertId(id)
      await ensureBuiltinProviders()
      const provider = await options.persistence.modelProviders.get(id)
      return provider ? withCredentialStatus(provider) : undefined
    },
    async saveProvider(input) {
      return saveProviderInternal(input)
    },
    async disableProvider(id) {
      assertId(id)
      const existingRaw = await options.persistence.modelProviders.get(id)
      if (!existingRaw) throw new Error(`Model provider not found: ${id}`)
      const existing = hydrateProviderMetadata(existingRaw)
      const provider = await this.saveProvider({
        id: existing.id,
        name: existing.name,
        kind: existing.kind,
        enabled: false,
        ...(existing.baseUrl !== undefined ? { baseUrl: existing.baseUrl } : {}),
        ...(existing.defaultModelId !== undefined ? { defaultModelId: existing.defaultModelId } : {})
      })
      return provider
    },
    async deleteProvider(id) {
      assertId(id)
      const existing = await options.persistence.modelProviders.get(id)
      if (!existing) throw new Error(`Model provider not found: ${id}`)
      if (builtinProviderIds.has(id)) {
        return this.disableProvider(id)
      }
      await options.persistence.models.deleteByProvider(id)
      await options.credentialVaultService.deleteProviderApiKey({ providerId: id })
      await options.persistence.modelProviders.delete(id)
      providerMetadata.delete(id)
      return undefined
    },
    async listModels(providerId) {
      await ensureBuiltinProviders()
      return providerId ? options.persistence.models.listByProvider(providerId) : options.persistence.models.list()
    },
    async saveModel(input) {
      return saveModelInternal(input)
    },
    async startOAuthAuthorization(input) {
      const gateway = requireOAuthGateway()
      assertId(input.connectionName, 'connectionName')
      const started = await gateway.startAuthorization(input)
      oauthSessions.set(started.sessionId, { provider: input.provider, connectionName: input.connectionName })
      return {
        provider: input.provider,
        sessionId: started.sessionId,
        authorizationUrl: started.authorizationUrl,
        status: 'pending',
        message: '等待浏览器授权'
      }
    },
    async getOAuthAuthorizationStatus(input) {
      const session = oauthSessions.get(input.sessionId)
      if (!session) {
        return { provider: 'openai-codex', sessionId: input.sessionId, status: 'failed', message: '授权会话不存在' }
      }
      const status = await requireOAuthGateway().getAuthorizationStatus({ sessionId: input.sessionId })
      return { provider: session.provider, sessionId: input.sessionId, ...status }
    },
    async saveOAuthConnection(input) {
      const session = oauthSessions.get(input.sessionId)
      if (!session) throw new Error('授权会话不存在')
      assertId(input.connectionName, 'connectionName')
      const gateway = requireOAuthGateway()
      const authorizationStatus = await gateway.getAuthorizationStatus({ sessionId: input.sessionId })
      if (authorizationStatus.status !== 'authorized') {
        throw new Error(authorizationStatus.message || '授权尚未完成')
      }
      const consumed = await gateway.consumeAuthorization({ sessionId: input.sessionId })
      const provider = await saveProviderInternal({
        id: 'chatgpt-codex',
        name: input.connectionName.trim(),
        kind: 'pi',
        authType: 'oauth',
        piAuthProvider: session.provider,
        enabled: true,
        defaultModelId: consumed.defaultModelId
      })
      await options.credentialVaultService.saveProviderApiKey({ providerId: provider.id, apiKey: consumed.accessToken })
      for (const model of consumed.models) {
        await saveModelInternal({
          ...model,
          providerId: provider.id,
          enabled: true
        })
      }
      oauthSessions.delete(input.sessionId)
      return withCredentialStatus(provider)
    },
    async testProviderConnection(input) {
      const testInput = connectionTestInput(input)
      const providerId = trimOptional(testInput.providerId)
      await ensureBuiltinProviders()
      const existingRaw = providerId ? await options.persistence.modelProviders.get(providerId) : undefined
      const existing = existingRaw ? hydrateProviderMetadata(existingRaw) : undefined
      if (!existing && !testInput.kind) {
        return { providerId: providerId ?? 'unknown', status: 'not_found', hasApiKey: false, message: `Model provider not found: ${providerId ?? 'unknown'}` }
      }

      const timestamp = now()
      const inputHasBaseUrl = hasOwn(testInput, 'baseUrl')
      const inputHasModelId = hasOwn(testInput, 'modelId')
      const inputBaseUrl = trimOptional(testInput.baseUrl)
      const inputModelId = trimOptional(testInput.modelId)
      const providerBaseUrl = inputHasBaseUrl ? inputBaseUrl : trimOptional(existing?.baseUrl)
      const providerDefaultModelId = inputHasModelId ? inputModelId : trimOptional(existing?.defaultModelId)
      const provider: ModelProviderConfig = {
        id: providerId ?? 'temporary-provider',
        name: existing?.name ?? 'Custom AI',
        kind: testInput.kind ?? existing?.kind ?? 'custom',
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: existing?.updatedAt ?? timestamp,
        ...(existing?.authType !== undefined ? { authType: existing.authType } : {}),
        ...(existing?.piAuthProvider !== undefined ? { piAuthProvider: existing.piAuthProvider } : {}),
        ...(providerBaseUrl ? { baseUrl: providerBaseUrl } : {}),
        ...(providerDefaultModelId ? { defaultModelId: providerDefaultModelId } : {})
      }

      if (!provider.enabled) {
        return { providerId: provider.id, status: 'disabled', hasApiKey: false, message: `${provider.name} is disabled.` }
      }
      if (provider.kind === 'mock') {
        return { providerId: provider.id, status: 'ok', hasApiKey: false, message: 'Mock provider is available.' }
      }

      const isCodexOAuthProvider = provider.kind === 'pi' && provider.authType === 'oauth' && provider.piAuthProvider === 'openai-codex'
      if (isCodexOAuthProvider) {
        const credentialStatus = await options.credentialVaultService.getProviderApiKeyStatus({ providerId: provider.id })
        return credentialStatus.hasApiKey
          ? { providerId: provider.id, status: 'ok', hasApiKey: true, message: 'Codex 授权可用' }
          : { providerId: provider.id, status: 'needs_api_key', hasApiKey: false, message: 'Codex 授权未完成' }
      }

      const inlineApiKey = trimOptional(testInput.apiKey)
      let apiKey: string | undefined
      try {
        apiKey = await readApiKeyForTest(providerId, inlineApiKey)
      } catch (error) {
        return failedResult(provider, false, `${provider.name} saved API key could not be read: ${unknownToMessage(error, undefined)}`)
      }

      if (!apiKey) {
        return { providerId: provider.id, status: 'needs_api_key', hasApiKey: false, message: `${provider.name} needs an API key before it can be tested.` }
      }

      const baseUrl = providerBaseUrl
      if (!baseUrl) {
        return failedResult(provider, true, `${provider.name} needs an endpoint before it can be tested.`)
      }

      const requestedModelId = providerDefaultModelId
      if (!requestedModelId) {
        return failedResult(provider, true, `${provider.name} needs a model before it can be tested.`)
      }
      const modelName = normalizeModelName(provider.id, requestedModelId)

      if (provider.kind === 'anthropic') {
        return probeAnthropicConnection({ fetchImpl: connectionTestFetch, provider, baseUrl, apiKey, modelName })
      }
      return probeOpenAICompatibleConnection({ fetchImpl: connectionTestFetch, provider, baseUrl, apiKey, modelName })
    },
    async ensureBuiltinProviders() {
      await ensureBuiltinProviders()
    }
  }
}
