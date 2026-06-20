import { createInMemoryPersistence, exportDatabaseBytes } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import { createCredentialVaultService, type CredentialVaultCodec } from '../credential-vault-service'
import { createModelProviderService } from '../model-provider-service'

const now = '2026-06-10T03:00:00.000Z'

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function createMockCodec(): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
    decryptString: (value) => [...Buffer.from(value).toString('utf8')].reverse().join('')
  }
}

describe('createModelProviderService', () => {
  it('creates builtin providers and models while preserving the mock baseline', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.ensureBuiltinProviders()

    expect((await service.listProviders()).map((provider) => provider.id)).toEqual(['mock', 'deepseek', 'openai', 'openai-compatible'])
    expect(await service.getProvider('mock')).toMatchObject({ kind: 'mock', enabled: true, defaultModelId: 'mock/hesper-fast', hasApiKey: false })
    expect(await service.getProvider('openai-compatible')).toMatchObject({ enabled: false, defaultModelId: 'openai-compatible/default' })
    expect((await service.listModels()).map((model) => model.id)).toEqual(['mock/hesper-fast', 'deepseek-chat', 'gpt-4o', 'openai-compatible/default'])
    expect((await service.listModels('mock')).map((model) => model.id)).toEqual(['mock/hesper-fast'])
  })

  it('seeds builtin providers on first list without overwriting user configuration', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    expect(await persistence.modelProviders.list()).toEqual([])
    expect((await service.listProviders()).map((provider) => provider.id)).toEqual(['mock', 'deepseek', 'openai', 'openai-compatible'])

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek Local', kind: 'deepseek', baseUrl: 'https://local.deepseek.test', enabled: false, defaultModelId: 'local-chat' })
    await service.ensureBuiltinProviders()

    expect(await service.getProvider('deepseek')).toMatchObject({
      name: 'DeepSeek Local',
      baseUrl: 'https://local.deepseek.test',
      enabled: false,
      defaultModelId: 'local-chat'
    })
  })

  it('saves providers and models through persistence repositories', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      defaultModelId: 'deepseek-chat'
    })
    await service.saveModel({
      id: 'deepseek-chat',
      providerId: 'deepseek',
      modelName: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      capabilities: ['streaming', 'toolCalls'],
      contextWindow: 64000,
      enabled: true
    })

    expect(await service.getProvider('deepseek')).toMatchObject({ apiKeyRef: 'provider:deepseek:api-key', hasApiKey: false })
    expect(await service.listModels('deepseek')).toMatchObject([
      { id: 'deepseek-chat', capabilities: ['streaming', 'toolCalls'], contextWindow: 64000 }
    ])
  })

  it('disables providers instead of deleting them', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true })
    const disabled = await service.disableProvider('openai')

    expect(disabled).toMatchObject({ id: 'openai', enabled: false })
    expect(await persistence.modelProviders.get('openai')).toMatchObject({ enabled: false })
  })

  it('deletes custom providers with their models and credentials', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.saveProvider({ id: 'custom-api-example-com', name: 'Example API', kind: 'openai-compatible', baseUrl: 'https://api.example.com', enabled: true, defaultModelId: 'example-chat' })
    await service.saveModel({ id: 'example-chat', providerId: 'custom-api-example-com', modelName: 'example-chat', displayName: 'Example Chat', capabilities: ['streaming'], enabled: true })
    await credentialVaultService.saveProviderApiKey({ providerId: 'custom-api-example-com', apiKey: 'sk-custom-secret' })

    await expect(service.deleteProvider('custom-api-example-com')).resolves.toBeUndefined()

    expect(await persistence.modelProviders.get('custom-api-example-com')).toBeUndefined()
    expect(await persistence.models.listByProvider('custom-api-example-com')).toEqual([])
    expect(await credentialVaultService.getProviderApiKeyStatus({ providerId: 'custom-api-example-com' })).toMatchObject({ hasApiKey: false })
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-custom-secret')
  })

  it('disables builtin providers when asked to delete them', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now })

    await service.ensureBuiltinProviders()
    const deleted = await service.deleteProvider('deepseek')

    expect(deleted).toMatchObject({ id: 'deepseek', enabled: false })
    expect(await persistence.modelProviders.get('deepseek')).toMatchObject({ enabled: false })
    expect(await persistence.models.listByProvider('deepseek')).toMatchObject([{ id: 'deepseek-chat' }])
  })

  it('tests saved connections by probing the provider API without returning or persisting raw API keys', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ choices: [{ message: { content: 'hesper-ok' } }] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await service.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat' })
    expect(await service.testProviderConnection('deepseek')).toMatchObject({ status: 'needs_api_key', hasApiKey: false })
    expect(fetchMock).not.toHaveBeenCalled()

    await credentialVaultService.saveProviderApiKey({ providerId: 'deepseek', apiKey: 'sk-deepseek-secret' })
    const result = await service.testProviderConnection('deepseek')

    expect(result).toMatchObject({ providerId: 'deepseek', status: 'ok', hasApiKey: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!
    expect(requestUrl).toBe('https://api.deepseek.com/chat/completions')
    expect((requestInit as RequestInit).headers).toMatchObject({ authorization: 'Bearer sk-deepseek-secret' })
    expect(JSON.parse(String((requestInit as RequestInit).body))).toMatchObject({ model: 'deepseek-chat' })
    expect(JSON.stringify(result)).not.toContain('sk-deepseek-secret')
    expect(JSON.stringify(await service.getProvider('deepseek'))).not.toContain('sk-deepseek-secret')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-deepseek-secret')
  })

  it('tests transient form connections with inline API keys without saving them', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ choices: [{ message: { content: 'hesper-ok' } }] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true })
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!
    expect(requestUrl).toBe('https://api.example.com/v1/chat/completions')
    expect((requestInit as RequestInit).headers).toMatchObject({ authorization: 'Bearer sk-inline-secret' })
    expect(JSON.parse(String((requestInit as RequestInit).body))).toMatchObject({ model: 'example-chat' })
    expect(await persistence.modelProviders.get('custom-api-example-com')).toBeUndefined()
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-inline-secret')
  })

  it('redacts inline API keys from failed connection test results', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ error: { message: 'bad key sk-inline-secret' } }, 401))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'failed', hasApiKey: true })
    expect(JSON.stringify(result)).not.toContain('sk-inline-secret')
  })

  it('explains successful connection tests with a user-facing success message', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ choices: [{ message: { content: 'hesper-ok' } }] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true })
    expect(result.message).toBe('连接成功')
  })

  it('accepts OpenAI-compatible reasoning content as an assistant response', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({
      id: '2f2a730f-6f37-4d8e-8354-fc3eeceb7c08',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: 'We are asked to reply with a test response.'
        }
      }]
    }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'deepseek-v4-flash'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true })
    expect(result.message).toBe('连接成功')
  })

  it('explains malformed successful responses as protocol or model mismatches', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createJsonResponse({ ok: true, data: [] }))
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    const result = await service.testProviderConnection({
      providerId: 'custom-api-example-com',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-inline-secret',
      modelId: 'example-chat'
    })

    expect(result).toMatchObject({ providerId: 'custom-api-example-com', status: 'failed', hasApiKey: true })
    expect(result.message).toBe('连接失败：API 返回成功状态，但响应格式中没有可读取的 assistant 内容。请检查协议类型、Endpoint 和模型是否匹配。')
    expect(result.message).not.toContain('响应预览：')
    expect(JSON.stringify(result)).not.toContain('sk-inline-secret')
  })

  it('starts, authorizes, and saves a Codex OAuth provider without exposing tokens', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-1',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [
          { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 },
          { id: 'pi/gpt-5.4-mini', modelName: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
        ],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    const started = await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    expect(started).toMatchObject({ provider: 'openai-codex', sessionId: 'oauth-session-1', status: 'pending' })

    await expect(service.getOAuthAuthorizationStatus({ sessionId: 'oauth-session-1' })).resolves.toMatchObject({ status: 'authorized' })
    const saved = await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })

    expect(saved).toMatchObject({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5',
      hasApiKey: true
    })
    expect((await service.listModels('chatgpt-codex')).map((model) => model.id)).toEqual(['pi/gpt-5.5', 'pi/gpt-5.4-mini'])
    expect(JSON.stringify(saved)).not.toContain('codex-oauth-access-token')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('codex-oauth-access-token')
  })

  it('cancels Codex OAuth authorization sessions through the gateway', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-cancel',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-cancel'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'pending' as const, message: '等待浏览器授权' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })

    await expect(service.cancelOAuthAuthorization({ sessionId: 'oauth-session-cancel' })).resolves.toEqual({
      cancelled: true,
      sessionId: 'oauth-session-cancel'
    })
    expect(oauthGateway.cancelAuthorization).toHaveBeenCalledWith({ sessionId: 'oauth-session-cancel' })
    await expect(service.getOAuthAuthorizationStatus({ sessionId: 'oauth-session-cancel' })).resolves.toEqual({
      provider: 'openai-codex',
      sessionId: 'oauth-session-cancel',
      status: 'failed',
      message: '授权会话不存在'
    })
    await expect(service.saveOAuthConnection({ sessionId: 'oauth-session-cancel', connectionName: 'ChatGPT Codex' })).rejects.toThrow('授权会话不存在')
  })

  it('keeps Codex OAuth provider metadata after rebuilding the service', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-1',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [
          { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
        ],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })

    const fetchMock = vi.fn()
    const rebuiltService = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await expect(rebuiltService.getProvider('chatgpt-codex')).resolves.toMatchObject({
      id: 'chatgpt-codex',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      hasApiKey: true
    })
    await expect(rebuiltService.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'ok', hasApiKey: true, message: 'Codex 授权可用' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not leave a half-initialized Codex OAuth provider when credential save fails', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const failingCredentialVaultService = {
      ...credentialVaultService,
      saveProviderApiKey: vi.fn(async () => {
        throw new Error('vault unavailable')
      })
    }
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-1',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn(async () => ({
        accessToken: 'codex-oauth-access-token',
        models: [
          { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
        ],
        defaultModelId: 'pi/gpt-5.5'
      })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService: failingCredentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await expect(service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })).rejects.toThrow('vault unavailable')

    await expect(service.getProvider('chatgpt-codex')).resolves.toBeUndefined()
    await expect(service.listModels('chatgpt-codex')).resolves.toEqual([])
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('codex-oauth-access-token')
  })

  it('replaces stale Codex OAuth models on reauthorization', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const oauthGateway = {
      startAuthorization: vi.fn()
        .mockResolvedValueOnce({ sessionId: 'oauth-session-1', authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1' })
        .mockResolvedValueOnce({ sessionId: 'oauth-session-2', authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-2' }),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
      consumeAuthorization: vi.fn()
        .mockResolvedValueOnce({
          accessToken: 'codex-oauth-access-token-1',
          models: [
            { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 },
            { id: 'pi/gpt-5.4-mini', modelName: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
          ],
          defaultModelId: 'pi/gpt-5.5'
        })
        .mockResolvedValueOnce({
          accessToken: 'codex-oauth-access-token-2',
          models: [
            { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as any, contextWindow: 272000 }
          ],
          defaultModelId: 'pi/gpt-5.5'
        }),
      cancelAuthorization: vi.fn(async () => {})
    }
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })
    expect((await service.listModels('chatgpt-codex')).map((model) => model.id)).toEqual(['pi/gpt-5.5', 'pi/gpt-5.4-mini'])

    await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    await service.saveOAuthConnection({ sessionId: 'oauth-session-2', connectionName: 'ChatGPT Codex' })

    expect((await service.listModels('chatgpt-codex')).map((model) => model.id)).toEqual(['pi/gpt-5.5'])
  })

  it('tests Codex OAuth providers by credential status instead of chat completions probe', async () => {
    const persistence = await createInMemoryPersistence()
    const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
    const fetchMock = vi.fn()
    const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

    await service.saveProvider({ id: 'chatgpt-codex', name: 'ChatGPT Codex', kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, defaultModelId: 'pi/gpt-5.5' })
    await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'needs_api_key', hasApiKey: false })

    await credentialVaultService.saveProviderApiKey({ providerId: 'chatgpt-codex', apiKey: 'codex-oauth-access-token' })
    await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'ok', hasApiKey: true, message: 'Codex 授权可用' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
