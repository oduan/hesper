import type { CredentialVaultCodec } from '@hesper/app-core'
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import { registerIpcHandlers } from '../electron/ipc-handlers'
import { ipcChannels, ipcEvents } from '../electron/ipc-contract'
import { createServiceContainer } from '../electron/service-container'

function createMockCredentialCodec(): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
    decryptString: (value) => [...Buffer.from(value).toString('utf8')].reverse().join('')
  }
}

type ListedAvailableModelCatalog = {
  providers: Array<{
    id: string
    credentialStatus: string
    hasApiKey?: boolean
    apiKeyRef?: string
    models: Array<{
      id: string
      readyForRuntime: boolean
      modelRef: { providerId: string; modelId: string }
    }>
  }>
}

async function listAvailableModelCatalog(container: ReturnType<typeof createServiceContainer>): Promise<{ catalog: ListedAvailableModelCatalog; raw: string }> {
  const result = await container.toolRunner.run(container.toolCatalogService.get('models.list-available')!, {}, {
    runId: 'run-1',
    sessionId: 'session-1',
    allowedToolIds: ['models.list-available']
  })

  expect(result.isError).not.toBe(true)
  return {
    catalog: JSON.parse(result.content) as ListedAvailableModelCatalog,
    raw: JSON.stringify(result)
  }
}

describe('desktop service container', () => {
  it('creates a session through app-core services', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const session = await container.sessionService.createSession({ title: 'Desktop test' })

    expect(session.title).toBe('Desktop test')
    expect(await container.sessionService.listSessions()).toHaveLength(1)
    expect(container.roleManagementService).toBeDefined()
    expect(container.promptAssemblyService.assembleMainPrompt({
      session,
      role: container.roleService.getRole('main-agent')!,
      skills: container.skillService.listSkills(),
      tools: container.toolCatalogService.list(),
      assignableWorkerAgentRoles: container.roleService.listRoles()
    }).systemPrompt).toContain('hesper desktop Agent')
  })

  it('injects role management tools into the production tool runner', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })

    const result = await container.toolRunner.run(container.toolCatalogService.get('roles.create')!, { name: 'Tool-created role' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['roles.create']
    })

    expect(result.isError).not.toBe(true)
    const created = JSON.parse(result.content) as { id: string; name: string }
    expect(created).toMatchObject({ id: expect.stringMatching(/^role-/), name: 'Tool-created role' })

    const listed = await container.toolRunner.run(container.toolCatalogService.get('roles.list')!, {}, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['roles.list']
    })
    expect(JSON.parse(listed.content)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main-agent', name: 'Main Agent' }),
      expect.objectContaining({ id: 'worker-agent', name: 'Worker Agent' }),
      expect.objectContaining({ id: created.id, name: 'Tool-created role' })
    ]))

    const found = await container.toolRunner.run(container.toolCatalogService.get('roles.find')!, { query: 'created' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['roles.find']
    })
    expect(JSON.parse(found.content)).toEqual([
      expect.objectContaining({ id: created.id, name: 'Tool-created role' })
    ])

    await expect(persistence.roles.list()).resolves.toEqual([
      expect.objectContaining({ id: created.id, name: 'Tool-created role' })
    ])
  })

  it('delegates SSH tools through the production tool runner without exposing connection details', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-key-secret\n-----END OPENSSH PRIVATE KEY-----'
    const key = await container.sshConfigurationService.createKey({ name: 'Production key', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAprod prod@example', privateKey })
    await container.sshConfigurationService.createServer({
      name: 'Production',
      host: 'prod.internal.example',
      username: 'deploy-user',
      keyId: key.id
    })

    const result = await container.toolRunner.run(container.toolCatalogService.get('ssh.list-servers')!, {}, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['ssh.list-servers']
    })

    expect(result.isError).not.toBe(true)
    expect(result.content).toContain('Production')
    expect(result.content).not.toContain('prod.internal.example')
    expect(result.content).not.toContain('deploy-user')
    expect(result.content).not.toContain('private-key-secret')
  })

  it('delegates Worker Agent tools to the worker service when allowed', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const workerAgentService = (container as any).workerAgentService as { spawn: ReturnType<typeof vi.fn> }
    const spawnSpy = vi.spyOn(workerAgentService, 'spawn').mockResolvedValueOnce({
      invocationId: 'worker-agent-1',
      childRunId: 'run-child',
      status: 'running'
    })

    const result = await container.toolRunner.run(container.toolCatalogService.get('agent.spawn-worker-agent')!, {
      task: 'Review the staged diff.',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      wait: false
    }, {
      runId: 'run-parent',
      sessionId: 'session-1',
      allowedToolIds: ['agent.spawn-worker-agent']
    })

    expect(spawnSpy).toHaveBeenCalledWith(
      {
        task: 'Review the staged diff.',
        roleId: 'reviewer',
        allowedToolIds: ['filesystem.read-file'],
        wait: false
      },
      expect.objectContaining({ runId: 'run-parent', sessionId: 'session-1', allowedToolIds: ['agent.spawn-worker-agent'] })
    )
    expect(JSON.parse(result.content)).toEqual({
      invocationId: 'worker-agent-1',
      childRunId: 'run-child',
      status: 'running'
    })
  })

  it('spawns Worker Agents with custom roles created through role management', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const session = await container.sessionService.createSession({ title: 'Custom worker role' })
    await persistence.runs.save({
      id: 'run-parent',
      sessionId: session.id,
      status: 'running',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 0
    })
    const role = await container.roleManagementService.createRole({
      name: 'Custom Reviewer',
      systemPrompt: 'Review carefully.',
      defaultToolIds: ['filesystem.read-file']
    })

    await expect(container.workerAgentService.spawn({
      task: 'Read the root README.',
      roleId: role.id,
      allowedToolIds: ['filesystem.read-file'],
      wait: true,
      timeoutMs: 5_000
    }, {
      runId: 'run-parent',
      sessionId: session.id,
      allowedToolIds: ['agent.spawn-worker-agent', 'filesystem.read-file']
    })).resolves.toMatchObject({
      roleId: role.id,
      status: 'succeeded',
      result: expect.objectContaining({ content: expect.stringContaining('Read the root README.') })
    })
  })

  it('seeds builtin providers for an empty desktop persistence store', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })

    await container.modelProviderService.ensureBuiltinProviders()

    expect((await container.modelProviderService.listProviders()).map((provider) => provider.id)).toEqual(['mock', 'deepseek', 'openai', 'openai-compatible'])
    expect((await container.modelProviderService.listModels('mock')).map((model) => model.id)).toEqual(['mock/hesper-fast'])
  })

  it('injects model listing tools into the production tool runner without exposing credentials', async () => {
    const secret = 'sk-live-secret-never-return'
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.ensureBuiltinProviders()
    await container.credentialVaultService.saveProviderApiKey({ providerId: 'openai', apiKey: secret })

    const { catalog, raw } = await listAvailableModelCatalog(container)

    expect(catalog.providers.map((provider) => provider.id)).toEqual(expect.arrayContaining(['mock', 'deepseek', 'openai']))
    expect(catalog.providers.find((provider) => provider.id === 'mock')).toMatchObject({ credentialStatus: 'ready' })
    expect(catalog.providers.find((provider) => provider.id === 'deepseek')).toMatchObject({ credentialStatus: 'needs_api_key' })
    expect(catalog.providers.find((provider) => provider.id === 'openai')).toMatchObject({ credentialStatus: 'ready', hasApiKey: true })
    expect(catalog.providers.find((provider) => provider.id === 'openai')?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'gpt-4o',
        readyForRuntime: true,
        modelRef: { providerId: 'openai', modelId: 'gpt-4o' }
      })
    ]))
    expect(catalog.providers.every((provider) => provider.apiKeyRef === undefined)).toBe(true)
    expect(raw).not.toContain(secret)
  })

  it('marks openai-compatible providers with baseUrl and credentials ready for runtime without exposing credentials', async () => {
    const secret = 'sk-openai-compatible-ready-secret'
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.saveProvider({
      id: 'openai-compatible-ready',
      name: 'OpenAI Compatible Ready',
      kind: 'openai-compatible',
      authType: 'api_key',
      baseUrl: 'https://api.compatible.example.com/v1',
      enabled: true,
      defaultModelId: 'openai-compatible-ready/chat'
    })
    await container.modelProviderService.saveModel({
      id: 'openai-compatible-ready/chat',
      providerId: 'openai-compatible-ready',
      modelName: 'chat',
      displayName: 'Compatible Chat',
      capabilities: ['streaming', 'toolCalls'],
      enabled: true
    })
    await container.credentialVaultService.saveProviderApiKey({ providerId: 'openai-compatible-ready', apiKey: secret })

    const { catalog, raw } = await listAvailableModelCatalog(container)
    const provider = catalog.providers.find((entry) => entry.id === 'openai-compatible-ready')

    expect(provider).toMatchObject({ credentialStatus: 'ready', hasApiKey: true })
    expect(provider?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai-compatible-ready/chat',
        readyForRuntime: true,
        modelRef: { providerId: 'openai-compatible-ready', modelId: 'openai-compatible-ready/chat' }
      })
    ]))
    expect(provider?.apiKeyRef).toBeUndefined()
    expect(raw).not.toContain(secret)
  })

  it('requires credentials for non-mock authType none providers in the model catalog', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.saveProvider({
      id: 'none-auth-compatible',
      name: 'None Auth Compatible',
      kind: 'openai-compatible',
      authType: 'none',
      baseUrl: 'https://api.none-auth.example.com/v1',
      enabled: true,
      defaultModelId: 'none-auth-compatible/chat'
    })
    await container.modelProviderService.saveModel({
      id: 'none-auth-compatible/chat',
      providerId: 'none-auth-compatible',
      modelName: 'chat',
      displayName: 'None Auth Compatible Chat',
      capabilities: ['streaming'],
      enabled: true
    })

    const { catalog } = await listAvailableModelCatalog(container)
    const provider = catalog.providers.find((entry) => entry.id === 'none-auth-compatible')

    expect(provider).toMatchObject({ credentialStatus: 'needs_api_key', hasApiKey: false })
    expect(provider?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'none-auth-compatible/chat', readyForRuntime: false })
    ]))
  })

  it('marks disabled providers and disabled models unavailable in the model catalog', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.ensureBuiltinProviders()
    await container.credentialVaultService.saveProviderApiKey({ providerId: 'deepseek', apiKey: 'sk-disabled-provider-secret' })
    await container.modelProviderService.disableProvider('deepseek')
    await container.credentialVaultService.saveProviderApiKey({ providerId: 'openai', apiKey: 'sk-disabled-model-secret' })
    await container.modelProviderService.saveModel({
      id: 'gpt-4o',
      providerId: 'openai',
      modelName: 'gpt-4o',
      displayName: 'GPT-4o',
      capabilities: ['streaming', 'toolCalls', 'jsonOutput'],
      enabled: false
    })

    const { catalog, raw } = await listAvailableModelCatalog(container)

    expect(catalog.providers.find((provider) => provider.id === 'deepseek')).toMatchObject({ credentialStatus: 'disabled' })
    expect(catalog.providers.find((provider) => provider.id === 'deepseek')?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deepseek-chat', readyForRuntime: false })
    ]))
    expect(catalog.providers.find((provider) => provider.id === 'openai')).toMatchObject({ credentialStatus: 'ready' })
    expect(catalog.providers.find((provider) => provider.id === 'openai')?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gpt-4o', readyForRuntime: false })
    ]))
    expect(raw).not.toContain('sk-disabled-provider-secret')
    expect(raw).not.toContain('sk-disabled-model-secret')
  })

  it('treats expired Codex OAuth credentials as not ready without leaking the token', async () => {
    const expiredAccessToken = 'codex-expired-access-token-never-return'
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.saveProvider({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5'
    })
    await container.modelProviderService.saveModel({
      id: 'pi/gpt-5.5',
      providerId: 'chatgpt-codex',
      modelName: 'gpt-5.5',
      displayName: 'GPT-5.5',
      capabilities: ['streaming', 'toolCalls', 'reasoning'],
      enabled: true
    })
    await container.credentialVaultService.saveProviderApiKey({
      providerId: 'chatgpt-codex',
      apiKey: JSON.stringify({ type: 'codex_oauth', accessToken: expiredAccessToken, expiresAt: Date.now() - 1_000 })
    })

    const { catalog, raw } = await listAvailableModelCatalog(container)
    const provider = catalog.providers.find((entry) => entry.id === 'chatgpt-codex')

    expect(provider).toMatchObject({ credentialStatus: 'needs_oauth', hasApiKey: true })
    expect(provider?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pi/gpt-5.5', readyForRuntime: false })
    ]))
    expect(raw).not.toContain(expiredAccessToken)
  })

  it('does not mark openai-compatible providers without a baseUrl ready for runtime', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.saveProvider({
      id: 'custom-no-base-url',
      name: 'Custom without baseUrl',
      kind: 'openai-compatible',
      enabled: true,
      defaultModelId: 'custom-no-base-url/chat'
    })
    await container.modelProviderService.saveModel({
      id: 'custom-no-base-url/chat',
      providerId: 'custom-no-base-url',
      modelName: 'chat',
      displayName: 'Custom Chat',
      capabilities: ['streaming', 'toolCalls'],
      enabled: true
    })
    await container.credentialVaultService.saveProviderApiKey({ providerId: 'custom-no-base-url', apiKey: 'sk-custom-no-base-url' })

    const { catalog, raw } = await listAvailableModelCatalog(container)
    const provider = catalog.providers.find((entry) => entry.id === 'custom-no-base-url')

    expect(provider).toMatchObject({ credentialStatus: 'ready', hasApiKey: true })
    expect(provider?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-no-base-url/chat', readyForRuntime: false })
    ]))
    expect(raw).not.toContain('sk-custom-no-base-url')
  })

  it('does not mark pi providers without a supported piAuthProvider ready for runtime', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.saveProvider({
      id: 'pi-missing-auth-provider',
      name: 'Pi Missing Auth Provider',
      kind: 'pi',
      authType: 'api_key',
      enabled: true,
      defaultModelId: 'pi-missing-auth-provider/model'
    })
    await container.modelProviderService.saveModel({
      id: 'pi-missing-auth-provider/model',
      providerId: 'pi-missing-auth-provider',
      modelName: 'model',
      displayName: 'Pi Missing Auth Model',
      capabilities: ['streaming'],
      enabled: true
    })
    await container.credentialVaultService.saveProviderApiKey({ providerId: 'pi-missing-auth-provider', apiKey: 'sk-pi-missing-auth-provider' })

    const { catalog, raw } = await listAvailableModelCatalog(container)
    const provider = catalog.providers.find((entry) => entry.id === 'pi-missing-auth-provider')

    expect(provider).toMatchObject({ credentialStatus: 'ready', hasApiKey: true })
    expect(provider?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pi-missing-auth-provider/model', readyForRuntime: false })
    ]))
    expect(raw).not.toContain('sk-pi-missing-auth-provider')
  })

  it('wires pi-core runs through the provider registry resolver and fails fast without credentials', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'pi-core', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.ensureBuiltinProviders()
    const session = await container.sessionService.createSession({ title: 'Pi core resolver', defaultModelId: 'gpt-4o' })

    const run = await container.agentRuntime.enqueue({ sessionId: session.id, prompt: 'needs credentials', modelId: 'gpt-4o' })
    await container.agentRuntime.waitForIdle(session.id)

    const storedRun = await persistence.runs.get(run.id)
    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error?.message).toContain('Model provider needs an API key: openai')
  })
})

describe('registerIpcHandlers', () => {
  it('returns the original session without saving when title generation returns no title', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
    }
    const session = await container.sessionService.createSession({ title: 'Keep this title' })
    vi.spyOn(container.sessionTitleGenerator, 'generateTitle').mockResolvedValueOnce(undefined as Awaited<ReturnType<typeof container.sessionTitleGenerator.generateTitle>>)

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

    await expect(handles.get(ipcChannels.sessionsGenerateTitle)?.({ sender: { id: 1 } }, {
      id: session.id,
      modelId: 'mock/hesper-fast',
      userPrompt: 'empty output'
    })).resolves.toMatchObject({ id: session.id, title: 'Keep this title' })
    await expect(container.sessionService.getSession(session.id)).resolves.toMatchObject({ title: 'Keep this title' })
    expect(savePersistence).not.toHaveBeenCalled()
  })

  it('stops agent runs through IPC and persists the cancellation', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const schedulePersistenceSave = vi.fn()
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
    }
    const cancelSpy = vi.spyOn(container.agentRuntime, 'cancelRun').mockResolvedValueOnce({
      id: 'run-to-stop',
      sessionId: 'session-1',
      status: 'cancelled',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 5,
      endedAt: '2026-06-10T03:00:05.000Z'
    })

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })

    await expect(handles.get(ipcChannels.agentStop)?.({ sender: { id: 1 } }, 'run-to-stop')).resolves.toMatchObject({
      id: 'run-to-stop',
      status: 'cancelled'
    })
    expect(cancelSpy).toHaveBeenCalledWith('run-to-stop')
    expect(schedulePersistenceSave).toHaveBeenCalled()
    expect(savePersistence).toHaveBeenCalled()
  })

  it('registers typed handlers and forwards runtime events to the sender', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const schedulePersistenceSave = vi.fn()
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const removeHandler = vi.fn((channel: string) => {
      handles.delete(channel)
    })
    const destroyedListeners = new Map<string, () => void>()
    const sender = {
      id: 7,
      isDestroyed: () => false,
      send: vi.fn(),
      once: vi.fn((eventName: string, listener: () => void) => {
        destroyedListeners.set(eventName, listener)
      })
    }
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const workerSubscribeSpy = vi.spyOn(container.workerAgentService, 'subscribe')

    const dispose = registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })

    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.sessionsList, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.agentEventsSubscribe, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.agentEventsUnsubscribe, expect.any(Function))

    await handles.get(ipcChannels.agentEventsSubscribe)?.({ sender })
    expect(workerSubscribeSpy).toHaveBeenCalledTimes(1)
    const session = (await handles.get(ipcChannels.sessionsCreate)?.({ sender }, { title: 'IPC created' })) as { id: string }
    const enqueueResult = await handles.get(ipcChannels.agentEnqueue)?.({ sender }, { sessionId: session.id, prompt: 'Ping', modelId: 'mock/hesper-fast', messageId: 'message-client-1', messageCreatedAt: '2026-06-10T03:00:01.000Z' }) as { runId: string }
    await container.agentRuntime.waitForIdle(session.id)

    expect(await persistence.messages.listBySession(session.id)).toEqual([
      expect.objectContaining({
        id: 'message-client-1',
        sessionId: session.id,
        role: 'user',
        content: 'Ping',
        runId: enqueueResult.runId,
        createdAt: '2026-06-10T03:00:01.000Z'
      }),
      expect.objectContaining({
        sessionId: session.id,
        role: 'assistant'
      })
    ])

    expect(sender.send).toHaveBeenCalledWith(
      ipcEvents.agentEvent,
      expect.objectContaining({ type: 'run.created' })
    )
    const unreadSession = await persistence.sessions.get(session.id)
    expect(unreadSession?.unreadCompletedAt).toBeTruthy()
    const viewedSession = await handles.get(ipcChannels.sessionsMarkViewed)?.({ sender }, session.id) as { id: string; unreadCompletedAt?: string }
    expect(viewedSession.id).toBe(session.id)
    expect(viewedSession.unreadCompletedAt).toBeUndefined()
    expect((await persistence.sessions.get(session.id))?.unreadCompletedAt).toBeUndefined()
    expect(schedulePersistenceSave).toHaveBeenCalled()
    expect(savePersistence).toHaveBeenCalled()

    await handles.get(ipcChannels.agentEventsUnsubscribe)?.({ sender })
    const sendsBefore = sender.send.mock.calls.length
    await handles.get(ipcChannels.agentEnqueue)?.({ sender }, { sessionId: session.id, prompt: 'Second run', modelId: 'mock/hesper-fast' })
    await container.agentRuntime.waitForIdle(session.id)
    expect(sender.send.mock.calls).toHaveLength(sendsBefore)

    await handles.get(ipcChannels.agentEventsSubscribe)?.({ sender })
    destroyedListeners.get('destroyed')?.()
    const sendsAfterDestroyed = sender.send.mock.calls.length
    await handles.get(ipcChannels.agentEnqueue)?.({ sender }, { sessionId: session.id, prompt: 'Third run', modelId: 'mock/hesper-fast' })
    await container.agentRuntime.waitForIdle(session.id)
    expect(sender.send.mock.calls).toHaveLength(sendsAfterDestroyed)

    dispose()
    expect(removeHandler).toHaveBeenCalledWith(ipcChannels.sessionsList)
  })

  it('assembles a registry-backed system prompt before enqueueing an agent run', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const schedulePersistenceSave = vi.fn()
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const assembled = {
      systemPrompt: 'assembled system prompt',
      toolManifest: 'tools',
      skillManifest: 'skills',
      roleManifest: 'roles',
      workerAgentRules: 'rules'
    }
    const promptSpy = vi.spyOn(container.promptAssemblyService, 'assembleMainPrompt').mockReturnValueOnce(assembled)
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce({ id: 'run-assembled' } as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)
    const createUserMessageSpy = vi.spyOn(container.conversationService, 'createUserMessage')

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })
    const session = await container.sessionService.createSession({ title: 'Prompt assembly IPC', workspacePath: 'C:/workspace' })
    await container.roleManagementService.createRole({ name: 'Custom Worker', defaultToolIds: ['filesystem.read-file'] })

    await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: session.id, prompt: 'Use assembled prompt', modelId: 'mock/hesper-fast', messageId: 'message-client-1', messageCreatedAt: '2026-06-10T03:00:02.000Z' })).resolves.toEqual({ runId: 'run-assembled' })

    const expectedDefaultEnabledTools = ['filesystem.read-file', 'filesystem.write-file', 'filesystem.edit-file', 'filesystem.delete-file', 'filesystem.delete-directory', 'filesystem.list-directory', 'filesystem.find', 'filesystem.search', 'git.status', 'git.run', 'roles.list', 'roles.find', 'roles.create', 'roles.update', 'models.list-available', 'agent.spawn-worker-agent', 'agent.list-worker-agents', 'agent.get-worker-agent', 'agent.wait-worker-agent', 'agent.cancel-worker-agent', 'ssh.list-servers', 'ssh.run-commands', 'ssh.list-executions', 'ssh.get-execution-output', 'time.current', 'time.sleep', 'time.wait-until', 'system.execute-command', 'system.show-notification']
    expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        id: session.id,
        workspacePath: 'C:/workspace',
        enabledToolIds: expectedDefaultEnabledTools
      }),
      role: expect.objectContaining({ id: 'main-agent' }),
      skills: expect.any(Array),
      tools: expect.any(Array)
    }))
    const promptInput = promptSpy.mock.calls[0]![0]
    expect(promptInput.session).not.toHaveProperty('allowedWorkerAgentRoleIds')
    expect(promptInput).not.toHaveProperty('assignableWorkerAgentRoles')
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      prompt: 'Use assembled prompt',
      modelId: 'mock/hesper-fast',
      systemPrompt: 'assembled system prompt',
      enabledToolIds: expectedDefaultEnabledTools,
      workspacePath: 'C:/workspace'
    }))
    expect(createUserMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'message-client-1',
      sessionId: session.id,
      content: 'Use assembled prompt',
      runId: 'run-assembled',
      now: '2026-06-10T03:00:02.000Z'
    }))
    expect(enqueueSpy.mock.invocationCallOrder[0]!).toBeLessThan(createUserMessageSpy.mock.invocationCallOrder[0]!)
  })

  it('narrows per-run enabled tools without expanding beyond the configured allowlist', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const promptSpy = vi.spyOn(container.promptAssemblyService, 'assembleMainPrompt')
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue')
      .mockResolvedValueOnce({ id: 'run-narrowed' } as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)
      .mockResolvedValueOnce({ id: 'run-empty' } as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)

    registerIpcHandlers({ ipcMain, dialog, container })
    const session = await container.sessionService.createSession({ title: 'Narrow tools', workspacePath: 'C:/workspace' })

    await expect(handles.get(ipcChannels.agentEnqueue)?.(
      { sender: { id: 1 } },
      { sessionId: session.id, prompt: 'Use only read', modelId: 'mock/hesper-fast', enabledToolIds: ['filesystem.read-file', 'filesystem.write-file'] }
    )).resolves.toEqual({ runId: 'run-narrowed' })

    expect(promptSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ enabledToolIds: ['filesystem.read-file', 'filesystem.write-file'] })
    }))
    expect(enqueueSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      enabledToolIds: ['filesystem.read-file', 'filesystem.write-file']
    }))

    await expect(handles.get(ipcChannels.agentEnqueue)?.(
      { sender: { id: 1 } },
      { sessionId: session.id, prompt: 'Use no tools', modelId: 'mock/hesper-fast', enabledToolIds: [] }
    )).resolves.toEqual({ runId: 'run-empty' })

    expect(promptSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ enabledToolIds: [] })
    }))
    expect(enqueueSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      enabledToolIds: []
    }))
  })

  it('filters globally disabled tools out of prompt assembly and runtime enqueue', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const promptSpy = vi.spyOn(container.promptAssemblyService, 'assembleMainPrompt')
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce({ id: 'run-global-filter' } as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)

    await container.toolSettingsService.setToolEnabled('system.show-notification', false)
    registerIpcHandlers({ ipcMain, dialog, container })
    const session = await container.sessionService.createSession({ title: 'Global tools', workspacePath: 'C:/workspace' })

    await expect(handles.get(ipcChannels.toolsList)?.({ sender: { id: 1 } })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'system.show-notification', enabled: false })
    ]))

    await expect(handles.get(ipcChannels.agentEnqueue)?.(
      { sender: { id: 1 } },
      { sessionId: session.id, prompt: 'Do not expose disabled web fetch', modelId: 'mock/hesper-fast' }
    )).resolves.toEqual({ runId: 'run-global-filter' })

    const expectedEnabledTools = ['filesystem.read-file', 'filesystem.write-file', 'filesystem.edit-file', 'filesystem.delete-file', 'filesystem.delete-directory', 'filesystem.list-directory', 'filesystem.find', 'filesystem.search', 'git.status', 'git.run', 'roles.list', 'roles.find', 'roles.create', 'roles.update', 'models.list-available', 'agent.spawn-worker-agent', 'agent.list-worker-agents', 'agent.get-worker-agent', 'agent.wait-worker-agent', 'agent.cancel-worker-agent', 'ssh.list-servers', 'ssh.run-commands', 'ssh.list-executions', 'ssh.get-execution-output', 'time.current', 'time.sleep', 'time.wait-until', 'system.execute-command']
    expect(promptSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ enabledToolIds: expectedEnabledTools })
    }))
    expect(enqueueSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      enabledToolIds: expectedEnabledTools
    }))

    const updatedTool = await handles.get(ipcChannels.toolsSetEnabled)?.({ sender: { id: 1 } }, { id: 'system.show-notification', enabled: true })
    expect(updatedTool).toMatchObject({ id: 'system.show-notification', enabled: true })
    expect(await container.toolSettingsService.isToolEnabled('system.show-notification')).toBe(true)
  })

  it('manages SSH keys and servers through strict IPC without returning secrets', async () => {
    const handles = new Map<string, any>()
    const ipcMain = { handle: vi.fn((channel, handler) => handles.set(channel, handler)) } as any
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    registerIpcHandlers({ ipcMain, container, savePersistence: async () => undefined } as any)

    const key = await handles.get(ipcChannels.sshKeysCreate)?.({ sender: { id: 1 } }, {
      name: 'Prod key',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAprod prod@example',
      privateKey: 'private-key-secret',
      passphrase: 'passphrase-secret',
      note: 'deploy'
    })
    expect(key).toMatchObject({ name: 'Prod key', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAprod prod@example', hasPassphrase: true })
    expect(JSON.stringify(key)).not.toContain('private-key-secret')
    expect(JSON.stringify(key)).not.toContain('passphrase-secret')

    const server = await handles.get(ipcChannels.sshServersCreate)?.({ sender: { id: 1 } }, {
      name: 'Prod server',
      host: '10.0.0.8',
      port: 22,
      username: 'deploy',
      keyId: key.id,
      note: 'logs'
    })
    expect(server).toMatchObject({ host: '10.0.0.8', username: 'deploy', keyId: key.id })

    await expect(handles.get(ipcChannels.sshKeysDelete)?.({ sender: { id: 1 } }, key.id)).rejects.toThrow('SSH key is used')

    const updated = await handles.get(ipcChannels.sshServersUpdate)?.({ sender: { id: 1 } }, { id: server.id, port: 2222, note: 'new note' })
    expect(updated).toMatchObject({ port: 2222, note: 'new note' })

    await expect(handles.get(ipcChannels.sshServersList)?.({ sender: { id: 1 } })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: server.id })]))
    expect(JSON.stringify(await handles.get(ipcChannels.sshKeysList)?.({ sender: { id: 1 } }))).not.toContain('private-key-secret')
  })

  it('manages roles through typed IPC handlers and persists mutations', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

    const created = await handles.get(ipcChannels.rolesCreate)?.({ sender: { id: 1 } }, {
      name: '运维助手',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: ['git.status'],
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    }) as { id: string }

    expect(created).toMatchObject({
      name: '运维助手',
      defaultToolIds: ['git.status'],
      defaultModelId: 'gpt-4o',
      defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
    })
    await expect(handles.get(ipcChannels.rolesList)?.({ sender: { id: 1 } })).resolves.toEqual([expect.objectContaining({ id: created.id, defaultModelId: 'gpt-4o' })])

    await expect(handles.get(ipcChannels.rolesUpdate)?.({ sender: { id: 1 } }, {
      id: created.id,
      name: '更新后的角色',
      defaultModelId: ''
    })).resolves.toMatchObject({ id: created.id, name: '更新后的角色', defaultModelId: '' })

    await expect(handles.get(ipcChannels.rolesList)?.({ sender: { id: 1 } })).resolves.toEqual([expect.objectContaining({ id: created.id, defaultModelId: '' })])

    await expect(handles.get(ipcChannels.rolesDelete)?.({ sender: { id: 1 } }, created.id)).resolves.toEqual({ deleted: true, id: created.id })
    await expect(handles.get(ipcChannels.rolesList)?.({ sender: { id: 1 } })).resolves.toEqual([])
    expect(savePersistence).toHaveBeenCalledTimes(3)
  })

  it('does not persist a user message when runtime enqueue fails', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const schedulePersistenceSave = vi.fn()
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    const createUserMessageSpy = vi.spyOn(container.conversationService, 'createUserMessage')
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockRejectedValueOnce(new Error('runtime failed'))

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })
    const session = await container.sessionService.createSession({ title: 'IPC failure' })

    await expect(
      handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: session.id, prompt: 'Persist me', modelId: 'mock/hesper-fast', messageId: 'message-failure-1' })
    ).rejects.toThrow('runtime failed')

    expect(enqueueSpy).toHaveBeenCalled()
    expect(createUserMessageSpy).not.toHaveBeenCalled()
    expect(schedulePersistenceSave).not.toHaveBeenCalled()
    expect(savePersistence).not.toHaveBeenCalled()
    expect(await persistence.messages.listBySession(session.id)).toEqual([])
  })

  it('marks the run failed if the user message cannot be stored after enqueue succeeds', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const schedulePersistenceSave = vi.fn()
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    const session = await container.sessionService.createSession({ title: 'IPC compensation' })
    const run = {
      id: 'run-compensate-1',
      sessionId: session.id,
      status: 'running',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 2,
      startedAt: '2026-06-17T10:14:58.000Z'
    } as const
    await persistence.runs.save(run)

    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce(run as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)
    const createUserMessageSpy = vi.spyOn(container.conversationService, 'createUserMessage').mockRejectedValueOnce(new Error('message write failed'))
    const failRunSpy = vi.spyOn(container.agentRuntime, 'failRun')

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })

    await expect(
      handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: session.id, prompt: 'Persist me', modelId: 'mock/hesper-fast', messageId: 'message-compensate-1' })
    ).rejects.toThrow('message write failed')

    expect(enqueueSpy.mock.invocationCallOrder[0]!).toBeLessThan(createUserMessageSpy.mock.invocationCallOrder[0]!)
    expect(failRunSpy).toHaveBeenCalledWith(run.id, expect.any(Error))
    expect(schedulePersistenceSave).toHaveBeenCalled()
    expect(savePersistence).not.toHaveBeenCalled()
    expect(await persistence.messages.listBySession(session.id)).toEqual([])

    const storedRun = await persistence.runs.get(run.id)
    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error?.message).toBe('message write failed')
    expect(storedRun?.status).not.toBe('running')
    expect(storedRun?.status).not.toBe('succeeded')
    expect((await persistence.events.listByRun(run.id)).map((event) => event.type)).toContain('run.failed')
  })

  it('registers conversation history handlers and returns persisted messages, runs, and steps', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    const session = await container.sessionService.createSession({ title: 'Restored chat' })
    await persistence.runs.save({ id: 'run-restored', sessionId: session.id, status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2 })
    await persistence.messages.save({
      id: 'message-restored-user',
      sessionId: session.id,
      role: 'user',
      content: 'persisted question',
      contentType: 'plain',
      runId: 'run-restored',
      createdAt: '2026-06-10T03:00:01.000Z'
    })
    await persistence.steps.save({
      id: 'step-restored',
      runId: 'run-restored',
      type: 'thought',
      status: 'succeeded',
      title: 'Restored thinking',
      createdAt: '2026-06-10T03:00:02.000Z'
    })
    await persistence.runs.save({ id: 'run-child', sessionId: session.id, parentRunId: 'run-restored', workerAgentInvocationId: 'worker-agent-1', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2 })
    await persistence.messages.save({
      id: 'message-child',
      sessionId: session.id,
      role: 'assistant',
      content: 'worker answer',
      contentType: 'plain',
      runId: 'run-child',
      createdAt: '2026-06-10T03:00:03.000Z'
    })
    await persistence.workerAgentInvocations.save({
      id: 'worker-agent-1',
      parentRunId: 'run-restored',
      childRunId: 'run-child',
      parentStepId: 'step-run-restored-tool-1',
      parentToolCallId: 'tool-1',
      task: 'Review the diff',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      status: 'running',
      createdAt: '2026-06-10T03:00:04.000Z',
      lastEventAt: '2026-06-10T03:00:04.000Z'
    })

    registerIpcHandlers({ ipcMain, dialog, container })

    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.conversationListMessages, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.conversationListMessagesByRun, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.conversationListRuns, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.conversationListSteps, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.workerInvocationsListByParentRun, expect.any(Function))

    await expect(handles.get(ipcChannels.conversationListMessages)?.({ sender: { id: 1 } }, session.id)).resolves.toEqual([
      expect.objectContaining({ id: 'message-restored-user', content: 'persisted question' })
    ])
    await expect(handles.get(ipcChannels.conversationListMessages)?.({ sender: { id: 1 } }, session.id)).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'message-child' })
    ]))
    await expect(handles.get(ipcChannels.conversationListMessagesByRun)?.({ sender: { id: 1 } }, { sessionId: session.id, runId: 'run-child' })).resolves.toEqual([
      expect.objectContaining({ id: 'message-child', content: 'worker answer' })
    ])
    await expect(handles.get(ipcChannels.workerInvocationsListByParentRun)?.({ sender: { id: 1 } }, { sessionId: session.id, parentRunId: 'run-restored' })).resolves.toEqual([
      expect.objectContaining({ id: 'worker-agent-1', childRunId: 'run-child' })
    ])
    await expect(handles.get(ipcChannels.conversationListRuns)?.({ sender: { id: 1 } }, session.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-restored', sessionId: session.id }),
      expect.objectContaining({ id: 'run-child', parentRunId: 'run-restored' })
    ]))
    await expect(handles.get(ipcChannels.conversationListSteps)?.({ sender: { id: 1 } }, 'run-restored')).resolves.toEqual([
      expect.objectContaining({ id: 'step-restored', runId: 'run-restored' })
    ])
  })

  it('rejects cross-session run-based history requests', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    const session = await container.sessionService.createSession({ title: 'History source' })
    const otherSession = await container.sessionService.createSession({ title: 'Other session' })
    await persistence.runs.save({ id: 'run-source', sessionId: session.id, status: 'running', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2 })

    registerIpcHandlers({ ipcMain, dialog, container })

    await expect(handles.get(ipcChannels.conversationListMessagesByRun)?.({ sender: { id: 1 } }, { sessionId: otherSession.id, runId: 'run-source' })).rejects.toThrow('access denied')
    await expect(handles.get(ipcChannels.workerInvocationsListByParentRun)?.({ sender: { id: 1 } }, { sessionId: otherSession.id, parentRunId: 'run-source' })).rejects.toThrow('access denied')
  })

  it('validates agent enqueue input before invoking the runtime', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container })

    await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: '', prompt: '', modelId: '' })).rejects.toThrow()
    expect(await persistence.messages.listBySession('')).toEqual([])
  })

  it('controls the source BrowserWindow through window IPC channels', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    let maximized = false
    const window = {
      minimize: vi.fn(),
      maximize: vi.fn(() => { maximized = true }),
      unmaximize: vi.fn(() => { maximized = false }),
      isMaximized: vi.fn(() => maximized),
      close: vi.fn()
    }

    registerIpcHandlers({ ipcMain, dialog, container, getWindowForEvent: () => window })

    await expect(handles.get(ipcChannels.windowMinimize)?.({ sender: { id: 1 } })).resolves.toEqual({ minimized: true })
    expect(window.minimize).toHaveBeenCalledTimes(1)

    await expect(handles.get(ipcChannels.windowToggleMaximize)?.({ sender: { id: 1 } })).resolves.toEqual({ isMaximized: true })
    expect(window.maximize).toHaveBeenCalledTimes(1)

    await expect(handles.get(ipcChannels.windowToggleMaximize)?.({ sender: { id: 1 } })).resolves.toEqual({ isMaximized: false })
    expect(window.unmaximize).toHaveBeenCalledTimes(1)

    await expect(handles.get(ipcChannels.windowClose)?.({ sender: { id: 1 } })).resolves.toEqual({ closed: true })
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('stores provider API keys through credential IPC without returning secrets', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const savePersistence = vi.fn(async () => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

    const saved = await handles.get(ipcChannels.credentialsSaveProviderApiKey)?.(
      { sender: { id: 1 } },
      { providerId: 'provider-deepseek', apiKey: 'sk-super-secret' }
    )
    expect(saved).toMatchObject({
      providerId: 'provider-deepseek',
      apiKeyRef: 'provider:provider-deepseek:api-key',
      hasApiKey: true,
      encryptionAvailable: true
    })
    expect(JSON.stringify(saved)).not.toContain('sk-super-secret')
    expect(JSON.stringify(saved)).not.toContain('encrypted')

    const status = await handles.get(ipcChannels.credentialsProviderStatus)?.({ sender: { id: 1 } }, { providerId: 'provider-deepseek' })
    expect(status).toMatchObject({ hasApiKey: true })
    expect(JSON.stringify(status)).not.toContain('sk-super-secret')
    expect(await container.credentialVaultService.readProviderApiKey('provider-deepseek')).toBe('sk-super-secret')
    expect(JSON.stringify(await persistence.credentialRecords.list())).not.toContain('sk-super-secret')
    expect(savePersistence).toHaveBeenCalled()

    const deleted = await handles.get(ipcChannels.credentialsDeleteProviderApiKey)?.({ sender: { id: 1 } }, { providerId: 'provider-deepseek' })
    expect(deleted).toMatchObject({ hasApiKey: false })
    expect(JSON.stringify(deleted)).not.toContain('sk-super-secret')
  })

  it('stores tool API keys through tools IPC and updates API-key tool availability', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const savePersistence = vi.fn(async () => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

    await expect(handles.get(ipcChannels.toolsList)?.({ sender: { id: 1 } })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'web.search', enabled: false, hasApiKey: false })
    ]))
    await expect(handles.get(ipcChannels.toolsSetEnabled)?.({ sender: { id: 1 } }, { id: 'web.search', enabled: true })).rejects.toThrow('API key is required')

    const saved = await handles.get(ipcChannels.toolsSaveApiKey)?.({ sender: { id: 1 } }, { toolId: 'web.search', apiKey: 'tinyfish-secret' })
    expect(saved).toMatchObject({ toolId: 'web.search', apiKeyRef: 'tool:web.search:api-key', hasApiKey: true, encryptionAvailable: true })
    expect(JSON.stringify(saved)).not.toContain('tinyfish-secret')
    expect(await container.credentialVaultService.readToolApiKey('web.search')).toBe('tinyfish-secret')

    const enabled = await handles.get(ipcChannels.toolsSetEnabled)?.({ sender: { id: 1 } }, { id: 'web.search', enabled: true })
    expect(enabled).toMatchObject({ id: 'web.search', enabled: true, hasApiKey: true })

    const status = await handles.get(ipcChannels.toolsCredentialStatus)?.({ sender: { id: 1 } }, { toolId: 'web.search' })
    expect(status).toMatchObject({ hasApiKey: true })

    const deleted = await handles.get(ipcChannels.toolsDeleteApiKey)?.({ sender: { id: 1 } }, { toolId: 'web.search' })
    expect(deleted).toMatchObject({ hasApiKey: false })
    await expect(handles.get(ipcChannels.toolsList)?.({ sender: { id: 1 } })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'web.search', enabled: false, hasApiKey: false })
    ]))
    expect(savePersistence).toHaveBeenCalled()
  })

  it('rejects unknown credential IPC fields at the boundary', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container })

    await expect(
      handles.get(ipcChannels.credentialsSaveProviderApiKey)?.(
        { sender: { id: 1 } },
        { providerId: 'provider-openai', apiKey: 'sk-test', unexpected: true }
      )
    ).rejects.toThrow()

    await expect(
      handles.get(ipcChannels.credentialsProviderStatus)?.({ sender: { id: 1 } }, { providerId: 'provider-openai', apiKey: 'sk-test' })
    ).rejects.toThrow()

    await expect(
      handles.get(ipcChannels.providersTestConnection)?.({ sender: { id: 1 } }, { providerId: 'deepseek', unexpected: true })
    ).rejects.toThrow()
  })

  it('manages providers and models through strict IPC without returning API keys', async () => {
    const persistence = await createInMemoryPersistence()
    const connectionTestFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: 'hesper-ok' } }] }), { status: 200 }))
    const container = createServiceContainer({
      persistence,
      agentMode: 'mock',
      credentialCodec: createMockCredentialCodec(),
      connectionTestFetch: connectionTestFetch as unknown as typeof fetch
    })
    const savePersistence = vi.fn(async () => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

    const provider = await handles.get(ipcChannels.providersSave)?.({ sender: { id: 1 } }, {
      id: 'deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      defaultModelId: 'deepseek-chat'
    })
    expect(provider).toMatchObject({ id: 'deepseek', hasApiKey: false, apiKeyRef: 'provider:deepseek:api-key' })

    const needsKey = await handles.get(ipcChannels.providersTestConnection)?.({ sender: { id: 1 } }, { providerId: 'deepseek' })
    expect(needsKey).toMatchObject({ providerId: 'deepseek', status: 'needs_api_key', hasApiKey: false })

    await handles.get(ipcChannels.credentialsSaveProviderApiKey)?.({ sender: { id: 1 } }, { providerId: 'deepseek', apiKey: 'sk-provider-secret' })
    const connected = await handles.get(ipcChannels.providersTestConnection)?.({ sender: { id: 1 } }, { providerId: 'deepseek' })
    expect(connected).toMatchObject({ providerId: 'deepseek', status: 'ok', hasApiKey: true })
    expect(connectionTestFetch).toHaveBeenCalledTimes(1)
    expect(connectionTestFetch.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/chat/completions')
    expect(JSON.stringify(connected)).not.toContain('sk-provider-secret')

    const model = await handles.get(ipcChannels.modelsSave)?.({ sender: { id: 1 } }, {
      id: 'deepseek-chat',
      providerId: 'deepseek',
      modelName: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      capabilities: ['streaming', 'toolCalls'],
      enabled: true
    })
    expect(model).toMatchObject({ id: 'deepseek-chat', providerId: 'deepseek' })
    await expect(handles.get(ipcChannels.modelsList)?.({ sender: { id: 1 } }, { providerId: 'deepseek' })).resolves.toHaveLength(1)

    const disabled = await handles.get(ipcChannels.providersDisable)?.({ sender: { id: 1 } }, { providerId: 'deepseek' })
    expect(disabled).toMatchObject({ id: 'deepseek', enabled: false, hasApiKey: true })

    await handles.get(ipcChannels.providersSave)?.({ sender: { id: 1 } }, {
      id: 'custom-api-example-com',
      name: 'Example API',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com',
      enabled: true,
      defaultModelId: 'example-chat'
    })
    await handles.get(ipcChannels.modelsSave)?.({ sender: { id: 1 } }, {
      id: 'example-chat',
      providerId: 'custom-api-example-com',
      modelName: 'example-chat',
      displayName: 'Example Chat',
      capabilities: ['streaming'],
      enabled: true
    })
    await handles.get(ipcChannels.credentialsSaveProviderApiKey)?.({ sender: { id: 1 } }, { providerId: 'custom-api-example-com', apiKey: 'sk-custom-secret' })
    const deleted = await handles.get(ipcChannels.providersDelete)?.({ sender: { id: 1 } }, { providerId: 'custom-api-example-com' })
    expect(deleted).toEqual({ deleted: true, providerId: 'custom-api-example-com' })
    expect(await container.modelProviderService.getProvider('custom-api-example-com')).toBeUndefined()
    expect(await container.modelProviderService.listModels('custom-api-example-com')).toEqual([])
    expect(await container.credentialVaultService.getProviderApiKeyStatus({ providerId: 'custom-api-example-com' })).toMatchObject({ hasApiKey: false })
    expect(savePersistence).toHaveBeenCalled()
  })

  it('starts Codex OAuth through strict IPC and opens only trusted authorization URLs', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const openExternal = vi.fn(async (_url: string) => {})
    const authorizationUrl = 'https://auth.craft.do/oauth/authorize?session=oauth-session-1'
    const startSpy = vi.spyOn(container.modelProviderService, 'startOAuthAuthorization').mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-1',
      authorizationUrl,
      status: 'pending',
      message: '等待浏览器授权'
    })

    registerIpcHandlers({ ipcMain, dialog, container, openExternal })

    await expect(
      handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
        { sender: { id: 1 } },
        { provider: 'openai-codex', connectionName: 'ChatGPT Codex' }
      )
    ).resolves.toEqual({
      provider: 'openai-codex',
      sessionId: 'oauth-session-1',
      authorizationUrl,
      status: 'pending',
      message: '等待浏览器授权'
    })
    expect(startSpy).toHaveBeenCalledWith({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(authorizationUrl)
  })

  it('rejects unsupported Codex OAuth providers before opening a browser', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const openExternal = vi.fn(async (_url: string) => {})
    const startSpy = vi.spyOn(container.modelProviderService, 'startOAuthAuthorization')

    registerIpcHandlers({ ipcMain, dialog, container, openExternal })

    await expect(
      handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
        { sender: { id: 1 } },
        { provider: 'github-copilot', connectionName: 'GitHub Copilot' }
      )
    ).rejects.toThrow()
    await expect(
      handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
        { sender: { id: 1 } },
        { provider: 'unknown-oauth', connectionName: 'Unknown' }
      )
    ).rejects.toThrow()
    expect(startSpy).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects untrusted Codex OAuth authorization URLs before opening a browser', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const openExternal = vi.fn(async (_url: string) => {})
    vi.spyOn(container.modelProviderService, 'startOAuthAuthorization').mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-evil',
      authorizationUrl: 'http://evil.test/oauth',
      status: 'pending',
      message: '等待浏览器授权'
    })

    registerIpcHandlers({ ipcMain, dialog, container, openExternal })

    await expect(
      handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
        { sender: { id: 1 } },
        { provider: 'openai-codex', connectionName: 'ChatGPT Codex' }
      )
    ).rejects.toThrow(/untrusted|trusted|authorization/i)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects invalid Codex OAuth start results before opening a browser', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }
    const openExternal = vi.fn(async (_url: string) => {})
    vi.spyOn(container.modelProviderService, 'startOAuthAuthorization').mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-invalid',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-invalid',
      status: 'complete',
      message: '授权完成'
    } as any)

    registerIpcHandlers({ ipcMain, dialog, container, openExternal })

    await expect(
      handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
        { sender: { id: 1 } },
        { provider: 'openai-codex', connectionName: 'ChatGPT Codex' }
      )
    ).rejects.toThrow()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('cancels Codex OAuth authorization if opening the external browser fails', async () => {
    const persistence = await createInMemoryPersistence()
    const oauthGateway = {
      startAuthorization: vi.fn()
        .mockResolvedValueOnce({
          sessionId: 'oauth-session-open-fail',
          authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-open-fail'
        })
        .mockResolvedValueOnce({
          sessionId: 'oauth-session-open-ok',
          authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-open-ok'
        }),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'pending' as const, message: '等待浏览器授权' })),
      consumeAuthorization: vi.fn(async () => ({ accessToken: 'codex-oauth-access-token', models: [], defaultModelId: 'pi/gpt-5.5' })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const container = createServiceContainer({
      persistence,
      agentMode: 'mock',
      credentialCodec: createMockCredentialCodec(),
      oauthGateway
    })
    const openExternal = vi.fn()
      .mockRejectedValueOnce(new Error('browser unavailable'))
      .mockResolvedValueOnce(undefined)
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, openExternal })

    await expect(handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
      { sender: { id: 1 } },
      { provider: 'openai-codex', connectionName: 'ChatGPT Codex' }
    )).rejects.toThrow('browser unavailable')
    expect(oauthGateway.cancelAuthorization).toHaveBeenCalledWith({ sessionId: 'oauth-session-open-fail' })
    await expect(handles.get(ipcChannels.providersGetOAuthAuthorizationStatus)?.(
      { sender: { id: 1 } },
      { sessionId: 'oauth-session-open-fail' }
    )).resolves.toEqual({
      provider: 'openai-codex',
      sessionId: 'oauth-session-open-fail',
      status: 'failed',
      message: '授权会话不存在'
    })

    await expect(handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
      { sender: { id: 1 } },
      { provider: 'openai-codex', connectionName: 'ChatGPT Codex' }
    )).resolves.toMatchObject({ sessionId: 'oauth-session-open-ok', status: 'pending' })
    expect(openExternal).toHaveBeenLastCalledWith('https://auth.craft.do/oauth/openai-codex?state=oauth-session-open-ok')
  })

  it('cancels Codex OAuth authorization through strict IPC', async () => {
    const persistence = await createInMemoryPersistence()
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-cancel-ipc',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-cancel-ipc'
      })),
      getAuthorizationStatus: vi.fn(async () => ({ status: 'pending' as const, message: '等待浏览器授权' })),
      consumeAuthorization: vi.fn(async () => ({ accessToken: 'codex-oauth-access-token', models: [], defaultModelId: 'pi/gpt-5.5' })),
      cancelAuthorization: vi.fn(async () => {})
    }
    const container = createServiceContainer({
      persistence,
      agentMode: 'mock',
      credentialCodec: createMockCredentialCodec(),
      oauthGateway
    })
    const openExternal = vi.fn(async (_url: string) => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, openExternal })
    await handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
      { sender: { id: 1 } },
      { provider: 'openai-codex', connectionName: 'ChatGPT Codex' }
    )

    await expect(handles.get(ipcChannels.providersCancelOAuthAuthorization)?.(
      { sender: { id: 1 } },
      { sessionId: 'oauth-session-cancel-ipc' }
    )).resolves.toEqual({ cancelled: true, sessionId: 'oauth-session-cancel-ipc' })
    expect(oauthGateway.cancelAuthorization).toHaveBeenCalledWith({ sessionId: 'oauth-session-cancel-ipc' })
    await expect(handles.get(ipcChannels.providersCancelOAuthAuthorization)?.(
      { sender: { id: 1 } },
      { sessionId: 'oauth-session-cancel-ipc', unexpected: true }
    )).rejects.toThrow()
  })

  it('rejects generic custom API edits of persisted Codex OAuth providers through IPC without saving persistence', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.saveProvider({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      enabled: true,
      defaultModelId: 'pi/gpt-5.5'
    })
    const savePersistence = vi.fn(async () => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

    await expect(handles.get(ipcChannels.providersSave)?.({ sender: { id: 1 } }, {
      id: 'chatgpt-codex',
      name: 'Broken',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com'
    })).rejects.toThrow('Codex OAuth providers cannot be edited as custom API providers')
    expect(savePersistence).not.toHaveBeenCalled()
    await expect(container.modelProviderService.getProvider('chatgpt-codex')).resolves.toMatchObject({
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex'
    })
  })

  it('gets and saves Codex OAuth connections through IPC with the container gateway', async () => {
    const persistence = await createInMemoryPersistence()
    const oauthGateway = {
      startAuthorization: vi.fn(async () => ({
        sessionId: 'oauth-session-save',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-save'
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
    const container = createServiceContainer({
      persistence,
      agentMode: 'mock',
      credentialCodec: createMockCredentialCodec(),
      oauthGateway
    })
    const savePersistence = vi.fn(async () => {})
    const openExternal = vi.fn(async (_url: string) => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, openExternal })

    const started = await handles.get(ipcChannels.providersStartOAuthAuthorization)?.(
      { sender: { id: 1 } },
      { provider: 'openai-codex', connectionName: 'ChatGPT Codex' }
    ) as { sessionId: string }
    const status = await handles.get(ipcChannels.providersGetOAuthAuthorizationStatus)?.(
      { sender: { id: 1 } },
      { sessionId: started.sessionId }
    )
    const saved = await handles.get(ipcChannels.providersSaveOAuthConnection)?.(
      { sender: { id: 1 } },
      { sessionId: started.sessionId, connectionName: 'ChatGPT Codex' }
    )

    expect(status).toEqual({
      provider: 'openai-codex',
      sessionId: 'oauth-session-save',
      status: 'authorized',
      message: '授权成功'
    })
    expect(oauthGateway.startAuthorization).toHaveBeenCalledWith({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    expect(oauthGateway.getAuthorizationStatus).toHaveBeenCalledWith({ sessionId: 'oauth-session-save' })
    expect(oauthGateway.consumeAuthorization).toHaveBeenCalledWith({ sessionId: 'oauth-session-save' })
    expect(openExternal).toHaveBeenCalledWith('https://auth.craft.do/oauth/openai-codex?state=oauth-session-save')
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
    await expect(container.modelProviderService.getProvider('chatgpt-codex')).resolves.toMatchObject({
      id: 'chatgpt-codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      hasApiKey: true
    })
    await expect(container.modelProviderService.listModels('chatgpt-codex')).resolves.toEqual([
      expect.objectContaining({ id: 'pi/gpt-5.5', providerId: 'chatgpt-codex' })
    ])
    expect(savePersistence).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown provider/model IPC fields at the boundary', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container })

    await expect(
      handles.get(ipcChannels.providersSave)?.({ sender: { id: 1 } }, { id: 'openai', name: 'OpenAI', kind: 'openai', unexpected: true })
    ).rejects.toThrow()
    await expect(
      handles.get(ipcChannels.providersDisable)?.({ sender: { id: 1 } }, { providerId: 'openai', unexpected: true })
    ).rejects.toThrow()
    await expect(
      handles.get(ipcChannels.providersDelete)?.({ sender: { id: 1 } }, { providerId: 'openai', unexpected: true })
    ).rejects.toThrow()
    await expect(
      handles.get(ipcChannels.modelsSave)?.({ sender: { id: 1 } }, { id: 'm', providerId: 'p', modelName: 'm', displayName: 'M', unexpected: true })
    ).rejects.toThrow()
  })

  it('persists settings updates through IPC for recreated service containers', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

    await expect(
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { defaultModelId: 'deepseek-chat', defaultOutputMode: 'html', themeMode: 'dark', fontSize: 16, soul: '保持中文输出。' })
    ).resolves.toEqual({ defaultModelId: 'deepseek-chat', defaultOutputMode: 'html', themeMode: 'dark', fontSize: 16, soul: '保持中文输出。' })
    expect(savePersistence).toHaveBeenCalled()

    const restoredContainer = createServiceContainer({ persistence, agentMode: 'mock' })
    const restoredHandles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const restoredIpcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        restoredHandles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    registerIpcHandlers({ ipcMain: restoredIpcMain, dialog, container: restoredContainer })

    await expect(restoredHandles.get(ipcChannels.settingsGet)?.({ sender: { id: 1 } })).resolves.toEqual({
      defaultModelId: 'deepseek-chat',
      defaultOutputMode: 'html',
      themeMode: 'dark',
      fontSize: 16,
      soul: '保持中文输出。'
    })
  })

  it('rejects unknown settings:update fields at the IPC boundary', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] }))
    }

    registerIpcHandlers({ ipcMain, dialog, container })

    await expect(
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { themeMode: 'dark', unexpected: true })
    ).rejects.toThrow()

    await expect(
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'html', fontSize: 15 })
    ).resolves.toMatchObject({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'html', fontSize: 15 })
  })
})
