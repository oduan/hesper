import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CredentialVaultCodec, SkillService } from '@hesper/app-core'
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import { registerIpcHandlers, type RegisterIpcHandlersOptions } from '../electron/ipc-handlers'
import { ipcChannels, ipcEvents } from '../electron/ipc-contract'
import { createServiceContainer } from '../electron/service-container'
import { createAttachmentStorage } from '../electron/attachment-storage'

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

async function withTempWorkspace<T>(run: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-preview-'))
  try {
    return await run(workspacePath)
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true })
  }
}

function registerTestIpcHandlers(container: ReturnType<typeof createServiceContainer>, options: Partial<Omit<RegisterIpcHandlersOptions, 'ipcMain' | 'dialog' | 'container'>> = {}) {
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

  registerIpcHandlers({ ipcMain, dialog, container, ...options })
  return { handles, ipcMain }
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
    }).systemPrompt).toContain('Hesper Agent')
  })

  it('manages session categories and moves sessions through ipc', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const { handles, ipcMain } = registerTestIpcHandlers(container)

    const createdCategory = await handles.get(ipcChannels.sessionCategoriesCreate)?.({ sender: { id: 1 } }, { name: '产品图' }) as { id: string; name: string }
    expect(createdCategory.name).toBe('产品图')

    await expect(handles.get(ipcChannels.sessionCategoriesList)?.({ sender: { id: 1 } })).resolves.toEqual([
      expect.objectContaining({ id: createdCategory.id, name: '产品图' })
    ])

    await expect(handles.get(ipcChannels.sessionsCreate)?.({ sender: { id: 1 } }, { title: 'Missing', categoryId: 'missing-category' })).rejects.toThrow('Session category not found')

    const session = await handles.get(ipcChannels.sessionsCreate)?.({ sender: { id: 1 } }, { title: 'Prompt', categoryId: createdCategory.id }) as { id: string; categoryId?: string }
    expect(session.categoryId).toBe(createdCategory.id)

    await expect(handles.get(ipcChannels.sessionsSetCategory)?.({ sender: { id: 1 } }, { ids: [session.id], categoryId: 'missing-category' })).rejects.toThrow('Session category not found')

    const moved = await handles.get(ipcChannels.sessionsSetCategory)?.({ sender: { id: 1 } }, { ids: [session.id], categoryId: undefined }) as Array<{ id: string; categoryId?: string }>
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ id: session.id })
    expect(moved[0]).not.toHaveProperty('categoryId')

    const deleted = await handles.get(ipcChannels.sessionCategoriesDelete)?.({ sender: { id: 1 } }, createdCategory.id) as { deletedSessionIds: string[] }
    expect(deleted.deletedSessionIds).toEqual([])
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.sessionCategoriesList, expect.any(Function))
  })

  it('creates sessions through ipc without a category when categoryId is blank', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const { handles } = registerTestIpcHandlers(container)

    const session = await handles.get(ipcChannels.sessionsCreate)?.({ sender: { id: 1 } }, { title: 'Blank category', categoryId: '' }) as { id: string; categoryId?: string }

    expect(session).toMatchObject({ title: 'Blank category' })
    expect(session).not.toHaveProperty('categoryId')
  })

  it('clears session category through ipc when categoryId is blank', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const { handles } = registerTestIpcHandlers(container)

    const category = await handles.get(ipcChannels.sessionCategoriesCreate)?.({ sender: { id: 1 } }, { name: 'To clear' }) as { id: string }
    const session = await handles.get(ipcChannels.sessionsCreate)?.({ sender: { id: 1 } }, { title: 'Categorized', categoryId: category.id }) as { id: string; categoryId?: string }
    expect(session.categoryId).toBe(category.id)

    const moved = await handles.get(ipcChannels.sessionsSetCategory)?.({ sender: { id: 1 } }, { ids: [session.id], categoryId: '' }) as Array<{ id: string; categoryId?: string }>

    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ id: session.id })
    expect(moved[0]).not.toHaveProperty('categoryId')
  })

  it('marks and restores sessions through ipc', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const savePersistence = vi.fn(async () => {})
    const { handles } = registerTestIpcHandlers(container, { savePersistence })

    const session = await handles.get(ipcChannels.sessionsCreate)?.({ sender: { id: 1 } }, { title: 'IPC mark' }) as { id: string }
    const marked = await handles.get(ipcChannels.sessionsSetMarked)?.({ sender: { id: 1 } }, { ids: [session.id], isMarked: true }) as Array<{ id: string; isMarked?: boolean }>
    expect(marked[0]).toMatchObject({ id: session.id, isMarked: true })
    await expect(persistence.sessions.get(session.id)).resolves.toMatchObject({ isMarked: true })

    const unmarked = await handles.get(ipcChannels.sessionsSetMarked)?.({ sender: { id: 1 } }, { ids: [session.id], isMarked: false }) as Array<{ id: string; isMarked?: boolean }>
    expect(unmarked[0]?.isMarked).toBeUndefined()
    await expect(persistence.sessions.get(session.id)).resolves.not.toHaveProperty('isMarked')

    const archived = await handles.get(ipcChannels.sessionsArchive)?.({ sender: { id: 1 } }, session.id) as { id: string; status: string }
    expect(archived.status).toBe('archived')
    const restored = await handles.get(ipcChannels.sessionsRestore)?.({ sender: { id: 1 } }, session.id) as { id: string; status: string }
    expect(restored.status).toBe('active')
    expect(savePersistence).toHaveBeenCalled()
  })

  it('supports injecting a skill service for desktop runtime and tools', async () => {
    const persistence = await createInMemoryPersistence()
    const researchSkill = { id: 'Research', name: 'Research', description: 'Find references', source: 'user' as const, prompt: 'Research carefully.' }
    const skillService: SkillService = {
      listSkills: vi.fn(() => [researchSkill]),
      getSkill: vi.fn((id) => id === 'Research' ? researchSkill : undefined)
    }
    const container = createServiceContainer({ persistence, agentMode: 'mock', skillService })

    expect(container.skillService).toBe(skillService)

    const listResult = await container.toolRunner.run(container.toolCatalogService.get('skills.list')!, {}, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['skills.list']
    })
    expect(JSON.parse(listResult.content)).toEqual([expect.objectContaining({ id: 'Research', name: 'Research' })])

    const getResult = await container.toolRunner.run(container.toolCatalogService.get('skills.get')!, { id: 'Research' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['skills.get']
    })
    expect(JSON.parse(getResult.content)).toMatchObject({ id: 'Research', prompt: 'Research carefully.' })
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

  it('injects SOUL tools into the production tool runner', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })

    const initial = await container.toolRunner.run(container.toolCatalogService.get('soul.get')!, {}, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['soul.get']
    })

    expect(initial.isError).not.toBe(true)
    expect(JSON.parse(initial.content)).toEqual({ soul: '' })

    const updated = await container.toolRunner.run(container.toolCatalogService.get('soul.update')!, { soul: 'Softly curious and steady.' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['soul.update']
    })

    expect(updated.isError).not.toBe(true)
    expect(JSON.parse(updated.content)).toEqual({ soul: 'Softly curious and steady.' })
    await expect(container.settingsService.getSettings()).resolves.toMatchObject({ soul: 'Softly curious and steady.' })
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

  it('does not seed providers for an empty desktop persistence store', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })

    await container.modelProviderService.ensureBuiltinProviders()

    expect(await container.modelProviderService.listProviders()).toEqual([])
    expect(await container.modelProviderService.listModels()).toEqual([])
  })

  it('injects model listing tools into the production tool runner without exposing credentials', async () => {
    const secret = 'sk-live-secret-never-return'
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })
    await container.modelProviderService.saveProvider({ id: 'mock', name: 'Mock', kind: 'mock', enabled: true, defaultModelId: 'mock/hesper-fast' })
    await container.modelProviderService.saveModel({ id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await container.modelProviderService.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat' })
    await container.modelProviderService.saveModel({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await container.modelProviderService.saveProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, defaultModelId: 'gpt-4o' })
    await container.modelProviderService.saveModel({ id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['streaming', 'toolCalls', 'jsonOutput', 'imageInput'], enabled: true })
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
    await container.modelProviderService.saveProvider({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat' })
    await container.modelProviderService.saveModel({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true })
    await container.modelProviderService.saveProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, defaultModelId: 'gpt-4o' })
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
    await container.modelProviderService.saveProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, defaultModelId: 'gpt-4o' })
    await container.modelProviderService.saveModel({ id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['streaming', 'toolCalls', 'jsonOutput', 'imageInput'], enabled: true })
    const session = await container.sessionService.createSession({ title: 'Pi core resolver', defaultModelId: 'gpt-4o' })

    const run = await container.agentRuntime.enqueue({ sessionId: session.id, prompt: 'needs credentials', modelId: 'gpt-4o' })
    await container.agentRuntime.waitForIdle(session.id)

    const storedRun = await persistence.runs.get(run.id)
    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error?.message).toContain('Model provider needs an API key: openai')
  })
})

describe('registerIpcHandlers', () => {
  it('previews workspace markdown, formatted JSON, and image files through IPC', async () => {
    await withTempWorkspace(async (workspacePath) => {
      const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
      await fs.mkdir(path.join(workspacePath, 'docs'))
      await fs.writeFile(path.join(workspacePath, 'docs', 'note.md'), '# Preview\n\nHello workspace.\n')
      await fs.writeFile(path.join(workspacePath, 'data.json'), '{"b":1,"a":{"c":2}}')
      await fs.writeFile(path.join(workspacePath, 'pixel.png'), imageBytes)

      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const session = await container.sessionService.createSession({ title: 'Preview session', workspacePath })
      const { handles, ipcMain } = registerTestIpcHandlers(container)

      expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.filesPreview, expect.any(Function))

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: 'docs/note.md'
      })).resolves.toMatchObject({
        path: 'docs/note.md',
        name: 'note.md',
        kind: 'markdown',
        mimeType: 'text/markdown',
        bytes: 28,
        content: '# Preview\n\nHello workspace.\n'
      })

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: 'data.json'
      })).resolves.toMatchObject({
        path: 'data.json',
        name: 'data.json',
        kind: 'json',
        mimeType: 'application/json',
        content: '{\n  "b": 1,\n  "a": {\n    "c": 2\n  }\n}'
      })

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: 'pixel.png'
      })).resolves.toMatchObject({
        path: 'pixel.png',
        name: 'pixel.png',
        kind: 'image',
        mimeType: 'image/png',
        bytes: imageBytes.byteLength,
        dataUrl: `data:image/png;base64,${imageBytes.toString('base64')}`
      })
    })
  })

  it('previews workspace files whose names start with two dots', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await fs.writeFile(path.join(workspacePath, '..foo.md'), '# Boundary\n')

      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const session = await container.sessionService.createSession({ title: 'Preview boundary path', workspacePath })
      const { handles } = registerTestIpcHandlers(container)

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: '..foo.md'
      })).resolves.toMatchObject({
        path: '..foo.md',
        name: '..foo.md',
        kind: 'markdown',
        content: '# Boundary\n'
      })
    })
  })

  it('rejects local file preview when the session has no selected workspace', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const session = await container.sessionService.createSession({ title: 'No workspace' })
    const { handles } = registerTestIpcHandlers(container)

    await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
      sessionId: session.id,
      path: 'README.md'
    })).rejects.toThrow(/workspace/i)
  })

  it('rejects local file preview paths that are absolute, escape the workspace, or point at directories', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await fs.mkdir(path.join(workspacePath, 'folder'))
      await fs.writeFile(path.join(workspacePath, 'inside.txt'), 'inside')

      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const session = await container.sessionService.createSession({ title: 'Preview session', workspacePath })
      const { handles } = registerTestIpcHandlers(container)

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: '../outside.txt'
      })).rejects.toThrow(/workspace|escape|relative/i)

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: path.join(workspacePath, 'inside.txt')
      })).rejects.toThrow(/relative|absolute/i)

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: 'folder'
      })).rejects.toThrow(/file|directory/i)
    })
  })

  it('rejects local file preview through symlinks or junctions that resolve outside the workspace', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-preview-link-'))
    try {
      const workspacePath = path.join(rootPath, 'workspace')
      const outsidePath = path.join(rootPath, 'outside')
      await fs.mkdir(workspacePath)
      await fs.mkdir(outsidePath)
      await fs.writeFile(path.join(outsidePath, 'secret.txt'), 'secret')

      try {
        await fs.symlink(outsidePath, path.join(workspacePath, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
          return
        }
        throw error
      }

      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const session = await container.sessionService.createSession({ title: 'Preview session', workspacePath })
      const { handles } = registerTestIpcHandlers(container)

      await expect(handles.get(ipcChannels.filesPreview)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        path: 'escape/secret.txt'
      })).rejects.toThrow(/workspace|outside|escape/i)
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('wires git IPC handlers through the container git service with schema parsing', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const { handles, ipcMain } = registerTestIpcHandlers(container)
    const event = { sender: { id: 1 } }
    const sessionId = 'session-git'
    const commitHash = '1111111111111111111111111111111111111111'
    const parentHash = '0000000000000000000000000000000000000000'
    const gitState = {
      sessionId,
      workspacePath: '/workspace/project',
      isGitRepository: true,
      currentBranch: 'main',
      headCommit: commitHash,
      dirty: false,
      changedFiles: 0,
      refs: [
        { name: 'HEAD', shortName: 'HEAD', type: 'head' as const, targetCommit: commitHash },
        { name: 'refs/heads/main', shortName: 'main', type: 'local-branch' as const, targetCommit: commitHash }
      ]
    }
    const gitLog = {
      rows: [
        {
          commitHash,
          shortHash: '1111111',
          parents: [parentHash],
          subject: 'Wire git IPC',
          authorName: 'Hesper',
          authorEmail: 'hesper@example.com',
          authoredAt: '2026-06-26T04:00:00.000Z',
          refs: gitState.refs,
          graph: { lanes: [{ id: 'lane-0', color: '#89b4fa', active: true }], nodeLaneId: 'lane-0', edges: [] }
        }
      ],
      limit: 25,
      hasMore: false
    }
    const gitCommit = {
      commitHash,
      shortHash: '1111111',
      parents: [parentHash],
      subject: 'Wire git IPC',
      body: 'Wire git IPC\n\nDetailed body.',
      authorName: 'Hesper',
      authorEmail: 'hesper@example.com',
      authoredAt: '2026-06-26T04:00:00.000Z',
      committerName: 'Hesper',
      committerEmail: 'hesper@example.com',
      committedAt: '2026-06-26T04:01:00.000Z',
      refs: gitState.refs,
      files: [{ path: 'apps/desktop/electron/ipc-handlers.ts', status: 'modified' as const, additions: 12, deletions: 1 }]
    }
    const actionResult = { success: true, message: 'ok', state: gitState }

    const getStateSpy = vi.spyOn(container.gitService, 'getState').mockResolvedValue(gitState)
    const listLogSpy = vi.spyOn(container.gitService, 'listLog').mockResolvedValue(gitLog)
    const getCommitSpy = vi.spyOn(container.gitService, 'getCommit').mockResolvedValue(gitCommit)
    const createBranchSpy = vi.spyOn(container.gitService, 'createBranch').mockResolvedValue(actionResult)
    const createTagSpy = vi.spyOn(container.gitService, 'createTag').mockResolvedValue(actionResult)
    const checkoutSpy = vi.spyOn(container.gitService, 'checkout').mockResolvedValue(actionResult)

    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.gitGetState, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.gitListLog, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.gitGetCommit, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.gitCreateBranch, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.gitCreateTag, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.gitCheckout, expect.any(Function))

    await expect(handles.get(ipcChannels.gitGetState)?.(event, { sessionId })).resolves.toEqual(gitState)
    expect(getStateSpy).toHaveBeenCalledWith({ sessionId })

    await expect(handles.get(ipcChannels.gitListLog)?.(event, { sessionId, limit: 25 })).resolves.toEqual(gitLog)
    expect(listLogSpy).toHaveBeenCalledWith({ sessionId, limit: 25 })

    await expect(handles.get(ipcChannels.gitGetCommit)?.(event, { sessionId, commit: commitHash })).resolves.toEqual(gitCommit)
    expect(getCommitSpy).toHaveBeenCalledWith({ sessionId, commit: commitHash })

    await expect(handles.get(ipcChannels.gitCreateBranch)?.(event, { sessionId, commit: commitHash, branchName: 'feature/git-panel', checkout: true })).resolves.toEqual(actionResult)
    expect(createBranchSpy).toHaveBeenCalledWith({ sessionId, commit: commitHash, branchName: 'feature/git-panel', checkout: true })

    await expect(handles.get(ipcChannels.gitCreateTag)?.(event, { sessionId, commit: commitHash, tagName: 'v1.2.3' })).resolves.toEqual(actionResult)
    expect(createTagSpy).toHaveBeenCalledWith({ sessionId, commit: commitHash, tagName: 'v1.2.3' })

    await expect(handles.get(ipcChannels.gitCheckout)?.(event, { sessionId, ref: 'main' })).resolves.toEqual(actionResult)
    expect(checkoutSpy).toHaveBeenCalledWith({ sessionId, ref: 'main' })
  })

  it('rejects invalid git IPC input and output with zod schemas', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const { handles } = registerTestIpcHandlers(container)
    const event = { sender: { id: 1 } }

    await expect(handles.get(ipcChannels.gitListLog)?.(event, { sessionId: 'session-git', limit: 0 })).rejects.toThrow()
    await expect(handles.get(ipcChannels.gitGetCommit)?.(event, { sessionId: 'session-git' })).rejects.toThrow()
    await expect(handles.get(ipcChannels.gitCreateBranch)?.(event, {
      sessionId: 'session-git',
      commit: '1111111111111111111111111111111111111111',
      branchName: '',
      unexpected: true
    })).rejects.toThrow()

    vi.spyOn(container.gitService, 'getState').mockResolvedValue({ sessionId: 'session-git' } as Awaited<ReturnType<typeof container.gitService.getState>>)
    await expect(handles.get(ipcChannels.gitGetState)?.(event, { sessionId: 'session-git' })).rejects.toThrow()

    vi.spyOn(container.gitService, 'createBranch').mockResolvedValue({ success: 'yes' } as unknown as Awaited<ReturnType<typeof container.gitService.createBranch>>)
    await expect(handles.get(ipcChannels.gitCreateBranch)?.(event, {
      sessionId: 'session-git',
      commit: '1111111111111111111111111111111111111111',
      branchName: 'feature/schema-output'
    })).rejects.toThrow()
  })

  it('schedules persistence for high-frequency session and role deletes without awaiting full saves', async () => {
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

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })

    const createdSession = await handles.get(ipcChannels.sessionsCreate)?.({ sender: { id: 1 } }, { title: 'Fast path session' }) as { id: string; status: string; title: string }
    expect(createdSession).toMatchObject({ title: 'Fast path session', status: 'active' })
    expect(schedulePersistenceSave).toHaveBeenCalledTimes(1)
    expect(savePersistence).not.toHaveBeenCalled()

    const deletedSession = await handles.get(ipcChannels.sessionsDelete)?.({ sender: { id: 1 } }, createdSession.id) as { id: string; status: string }
    expect(deletedSession).toMatchObject({ id: createdSession.id, status: 'deleted' })
    expect(schedulePersistenceSave).toHaveBeenCalledTimes(2)
    expect(savePersistence).not.toHaveBeenCalled()

    const role = await container.roleManagementService.createRole({
      name: 'Fast path role',
      systemPrompt: 'You are a fast path role.'
    })
    await expect(handles.get(ipcChannels.rolesDelete)?.({ sender: { id: 1 } }, role.id)).resolves.toEqual({ deleted: true, id: role.id })
    expect(schedulePersistenceSave).toHaveBeenCalledTimes(3)
    expect(savePersistence).not.toHaveBeenCalled()
  })

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

  it('exposes skills through typed IPC handlers and refreshes async services', async () => {
    const persistence = await createInMemoryPersistence()
    const skills = [
      { id: 'Install Skills', name: 'Install Skills', description: 'Install reusable skills.', source: 'builtin' as const },
      { id: 'Research', name: 'Research', source: 'user' as const, prompt: 'Research carefully.' }
    ]
    const refreshedSkills = [...skills, { id: 'Writer', name: 'Writer', source: 'user' as const }]
    const skillService: SkillService & { refreshSkills: ReturnType<typeof vi.fn> } = {
      listSkills: vi.fn(() => skills),
      getSkill: vi.fn((id: string) => skills.find((skill) => skill.id === id)),
      refreshSkills: vi.fn(async () => refreshedSkills)
    }
    const container = createServiceContainer({ persistence, agentMode: 'mock', skillService })
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

    await expect(handles.get(ipcChannels.skillsList)?.({ sender: { id: 1 } })).resolves.toEqual(skills)
    await expect(handles.get(ipcChannels.skillsGet)?.({ sender: { id: 1 } }, 'Research')).resolves.toMatchObject({ id: 'Research', prompt: 'Research carefully.' })
    await expect(handles.get(ipcChannels.skillsGet)?.({ sender: { id: 1 } }, 'Missing')).resolves.toBeUndefined()
    await expect(handles.get(ipcChannels.skillsRefresh)?.({ sender: { id: 1 } })).resolves.toEqual(refreshedSkills)
    expect(skillService.refreshSkills).toHaveBeenCalledTimes(1)
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

    await container.settingsService.updateSettings({ soul: 'Softly curious and steady.' })
    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })
    const session = await container.sessionService.createSession({ title: 'Prompt assembly IPC', workspacePath: 'C:/workspace' })
    await container.roleManagementService.createRole({ name: 'Custom Worker', defaultToolIds: ['filesystem.read-file'] })

    await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: session.id, prompt: 'Use assembled prompt\n\n<skill>Injected instructions</skill>', displayPrompt: 'Use assembled prompt', modelId: 'mock/hesper-fast', thinkingLevel: 'xhigh', messageId: 'message-client-1', messageCreatedAt: '2026-06-10T03:00:02.000Z' })).resolves.toEqual({ runId: 'run-assembled' })

    const expectedDefaultEnabledTools = ['filesystem.read-file', 'filesystem.write-file', 'filesystem.edit-file', 'filesystem.delete-file', 'filesystem.delete-directory', 'filesystem.list-directory', 'filesystem.find', 'filesystem.search', 'git.status', 'git.run', 'roles.list', 'roles.find', 'roles.create', 'roles.update', 'skills.list', 'skills.get', 'models.list-available', 'soul.get', 'soul.update', 'agent.spawn-worker-agent', 'agent.list-worker-agents', 'agent.get-worker-agent', 'agent.wait-worker-agent', 'agent.cancel-worker-agent', 'ssh.list-servers', 'ssh.run-commands', 'ssh.list-executions', 'ssh.get-execution-output', 'time.current', 'time.sleep', 'time.wait-until', 'system.execute-command', 'system.show-notification']
    expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        id: session.id,
        workspacePath: 'C:/workspace',
        enabledToolIds: expectedDefaultEnabledTools
      }),
      soul: 'Softly curious and steady.',
      role: expect.objectContaining({ id: 'main-agent' }),
      skills: expect.any(Array),
      tools: expect.any(Array)
    }))
    const promptInput = promptSpy.mock.calls[0]![0]
    expect(promptInput.session).not.toHaveProperty('allowedWorkerAgentRoleIds')
    expect(promptInput).not.toHaveProperty('assignableWorkerAgentRoles')
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      prompt: 'Use assembled prompt\n\n<skill>Injected instructions</skill>',
      modelId: 'mock/hesper-fast',
      systemPrompt: 'assembled system prompt',
      enabledToolIds: expectedDefaultEnabledTools,
      thinkingLevel: 'xhigh',
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

  it('passes discovered project context files into prompt assembly before enqueueing', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '# root agents')
      await fs.mkdir(path.join(workspacePath, 'apps', 'web'), { recursive: true })
      await fs.writeFile(path.join(workspacePath, 'apps', 'web', 'CLAUDE.md'), '# web context')

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
        showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [workspacePath] }))
      }
      const promptSpy = vi.spyOn(container.promptAssemblyService, 'assembleMainPrompt')
      const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce({ id: 'run-project-context' } as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)

      registerIpcHandlers({ ipcMain, dialog, container })
      const session = await container.sessionService.createSession({ title: 'Project context IPC', workspacePath })

      await expect(handles.get(ipcChannels.agentEnqueue)?.(
        { sender: { id: 1 } },
        { sessionId: session.id, prompt: 'Use project context', modelId: 'mock/hesper-fast' }
      )).resolves.toEqual({ runId: 'run-project-context' })

      expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({
        projectContextFiles: ['AGENTS.md', 'apps/web/CLAUDE.md']
      }))
      expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.id,
        workspacePath
      }))
    })
  })

  it('continues enqueueing without project context files when discovery fails', async () => {
    const missingWorkspacePath = path.join(os.tmpdir(), `hesper-missing-context-${Date.now()}`)
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
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [missingWorkspacePath] }))
    }
    const promptSpy = vi.spyOn(container.promptAssemblyService, 'assembleMainPrompt')
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce({ id: 'run-context-fallback' } as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)

    registerIpcHandlers({ ipcMain, dialog, container })
    const session = await container.sessionService.createSession({ title: 'Project context fallback', workspacePath: missingWorkspacePath })

    await expect(handles.get(ipcChannels.agentEnqueue)?.(
      { sender: { id: 1 } },
      { sessionId: session.id, prompt: 'Discovery should not fail enqueue', modelId: 'mock/hesper-fast' }
    )).resolves.toEqual({ runId: 'run-context-fallback' })

    const promptInput = promptSpy.mock.calls[0]![0]
    expect(promptInput).not.toHaveProperty('projectContextFiles')
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      workspacePath: missingWorkspacePath
    }))
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

    const expectedEnabledTools = ['filesystem.read-file', 'filesystem.write-file', 'filesystem.edit-file', 'filesystem.delete-file', 'filesystem.delete-directory', 'filesystem.list-directory', 'filesystem.find', 'filesystem.search', 'git.status', 'git.run', 'roles.list', 'roles.find', 'roles.create', 'roles.update', 'skills.list', 'skills.get', 'models.list-available', 'soul.get', 'soul.update', 'agent.spawn-worker-agent', 'agent.list-worker-agents', 'agent.get-worker-agent', 'agent.wait-worker-agent', 'agent.cancel-worker-agent', 'ssh.list-servers', 'ssh.run-commands', 'ssh.list-executions', 'ssh.get-execution-output', 'time.current', 'time.sleep', 'time.wait-until', 'system.execute-command']
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
    const schedulePersistenceSave = vi.fn()
    const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
        handles.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })

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
    expect(schedulePersistenceSave).toHaveBeenCalledTimes(1)
    expect(savePersistence).toHaveBeenCalledTimes(2)
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

  it('enqueues and persists text draft attachments when the prompt is empty', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-ipc-attachments-'))
    try {
      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const storage = createAttachmentStorage(userDataPath)
      const session = await container.sessionService.createSession({ title: 'Attachment-only IPC' })
      const run = {
        id: 'run-attachment-only',
        sessionId: session.id,
        status: 'running',
        modelId: 'mock/hesper-fast',
        retryCount: 0,
        maxRetries: 2,
        startedAt: '2026-06-26T00:00:00.000Z'
      } as const
      await persistence.runs.save(run)
      const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce(run as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)
      const { handles } = registerTestIpcHandlers(container, { attachmentStorage: storage })

      await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        prompt: '',
        modelId: 'mock/hesper-fast',
        messageId: 'message-attachment-only',
        draftAttachments: [
          { kind: 'text', name: 'notes.md', mimeType: 'text/markdown', bytes: 7, content: '# Notes' }
        ]
      })).resolves.toEqual({ runId: run.id })

      expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({
        prompt: '',
        attachments: [expect.objectContaining({ kind: 'text', name: 'notes.md', bytes: 7 })]
      }))
      const [message] = await persistence.messages.listBySession(session.id)
      expect(message).toEqual(expect.objectContaining({
        id: 'message-attachment-only',
        content: '',
        attachments: [expect.objectContaining({ kind: 'text', name: 'notes.md', bytes: 7 })]
      }))
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('stores draft image and text attachments as file-backed message metadata', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-ipc-attachments-'))
    try {
      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const storage = createAttachmentStorage(userDataPath)
      const session = await container.sessionService.createSession({ title: 'Attachment IPC' })
      const run = {
        id: 'run-attachments-1',
        sessionId: session.id,
        status: 'running',
        modelId: 'mock/hesper-fast',
        retryCount: 0,
        maxRetries: 2,
        startedAt: '2026-06-26T00:00:00.000Z'
      } as const
      await persistence.runs.save(run)
      const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce(run as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)
      const { handles } = registerTestIpcHandlers(container, { attachmentStorage: storage })

      await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        prompt: 'See attachments',
        modelId: 'mock/hesper-fast',
        messageId: 'message-attachments-1',
        draftAttachments: [
          { kind: 'image', name: 'pixel.png', mimeType: 'image/png', bytes: 5, dataUrl: 'data:image/png;base64,aW1n' },
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, content: 'hello' }
        ]
      })).resolves.toEqual({ runId: run.id })

      expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({
        attachments: [
          expect.objectContaining({ kind: 'image', name: 'pixel.png', mimeType: 'image/png', bytes: 3, relativePath: expect.stringContaining('attachments/') }),
          expect.objectContaining({ kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, relativePath: expect.stringContaining('attachments/') })
        ],
        attachmentReader: expect.objectContaining({
          readImageAttachment: expect.any(Function),
          readTextAttachment: expect.any(Function)
        })
      }))
      expect(enqueueSpy).toHaveBeenCalledWith(expect.not.objectContaining({ draftAttachments: expect.anything() }))

      const enqueueInput = enqueueSpy.mock.calls[0]![0]
      expect(JSON.stringify(enqueueInput.attachments)).not.toContain('dataUrl')
      expect(JSON.stringify(enqueueInput.attachments)).not.toContain('content')
      const [message] = await persistence.messages.listBySession(session.id)
      const expectedRelativePathPrefix = new RegExp(`^attachments/${session.id}/message-attachments-1/`)
      expect(message?.attachments).toEqual([
        expect.objectContaining({ kind: 'image', name: 'pixel.png', mimeType: 'image/png', bytes: 3, relativePath: expect.stringMatching(expectedRelativePathPrefix) }),
        expect.objectContaining({ kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, relativePath: expect.stringMatching(expectedRelativePathPrefix) })
      ])
      expect(message?.attachments).toEqual(enqueueInput.attachments)
      expect(JSON.stringify(message?.attachments)).not.toContain('dataUrl')
      expect(JSON.stringify(message?.attachments)).not.toContain('content')

      const imageAttachment = message!.attachments!.find((attachment) => attachment.kind === 'image')!
      const textAttachment = message!.attachments!.find((attachment) => attachment.kind === 'text')!
      await expect(fs.readFile(path.join(userDataPath, ...imageAttachment.relativePath.split('/')), 'utf8')).resolves.toBe('img')
      await expect(fs.readFile(path.join(userDataPath, ...textAttachment.relativePath.split('/')), 'utf8')).resolves.toBe('hello')
      const reader = enqueueInput.attachmentReader!
      expect(reader).not.toHaveProperty('saveDraftAttachments')
      expect(reader).not.toHaveProperty('readAttachmentDataUrl')
      expect(reader).not.toHaveProperty('deleteMessageAttachments')
      await expect(reader.readImageAttachment(imageAttachment.relativePath)).resolves.toEqual(Buffer.from('img'))
      await expect(reader.readTextAttachment(textAttachment.relativePath)).resolves.toBe('hello')
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('deletes stored draft attachments when runtime enqueue fails', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-ipc-attachments-'))
    try {
      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const storage = createAttachmentStorage(userDataPath)
      const session = await container.sessionService.createSession({ title: 'Attachment failure' })
      vi.spyOn(container.agentRuntime, 'enqueue').mockRejectedValueOnce(new Error('runtime failed'))
      const { handles } = registerTestIpcHandlers(container, { attachmentStorage: storage })

      await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        prompt: 'Will fail',
        modelId: 'mock/hesper-fast',
        messageId: 'message-attachments-failure',
        draftAttachments: [
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, content: 'hello' }
        ]
      })).rejects.toThrow('runtime failed')

      await expect(fs.access(path.join(userDataPath, 'attachments', session.id, 'message-attachments-failure'))).rejects.toThrow()
      expect(await persistence.messages.listBySession(session.id)).toEqual([])
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('deletes stored draft attachments when run context assembly fails after attachment save', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-ipc-attachments-'))
    try {
      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const storage = createAttachmentStorage(userDataPath)
      const session = await container.sessionService.createSession({ title: 'Attachment context failure' })
      const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue')
      vi.spyOn(container.sessionService, 'getSession').mockRejectedValueOnce(new Error('context assembly failed'))
      const { handles } = registerTestIpcHandlers(container, { attachmentStorage: storage })

      await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        prompt: 'Will fail before enqueue',
        modelId: 'mock/hesper-fast',
        messageId: 'message-attachments-context-failure',
        draftAttachments: [
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, content: 'hello' }
        ]
      })).rejects.toThrow('context assembly failed')

      await expect(fs.access(path.join(userDataPath, 'attachments', session.id, 'message-attachments-context-failure'))).rejects.toThrow()
      expect(enqueueSpy).not.toHaveBeenCalled()
      expect(await persistence.messages.listBySession(session.id)).toEqual([])
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('deletes stored draft attachments and fails the run when user message persistence fails', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-ipc-attachments-'))
    try {
      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const storage = createAttachmentStorage(userDataPath)
      const session = await container.sessionService.createSession({ title: 'Attachment message failure' })
      const run = {
        id: 'run-attachment-message-failure',
        sessionId: session.id,
        status: 'running',
        modelId: 'mock/hesper-fast',
        retryCount: 0,
        maxRetries: 2,
        startedAt: '2026-06-26T00:00:00.000Z'
      } as const
      await persistence.runs.save(run)
      vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce(run as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)
      vi.spyOn(container.conversationService, 'createUserMessage').mockRejectedValueOnce(new Error('message write failed'))
      const failRunSpy = vi.spyOn(container.agentRuntime, 'failRun')
      const { handles } = registerTestIpcHandlers(container, { attachmentStorage: storage })

      await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, {
        sessionId: session.id,
        prompt: 'Will fail after storing attachment',
        modelId: 'mock/hesper-fast',
        messageId: 'message-attachments-message-failure',
        draftAttachments: [
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, content: 'hello' }
        ]
      })).rejects.toThrow('message write failed')

      await expect(fs.access(path.join(userDataPath, 'attachments', session.id, 'message-attachments-message-failure'))).rejects.toThrow()
      expect(failRunSpy).toHaveBeenCalledWith(run.id, expect.any(Error))
      expect(await persistence.messages.listBySession(session.id)).toEqual([])
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
  })

  it('requires attachment storage when enqueueing draft attachments', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const session = await container.sessionService.createSession({ title: 'Missing attachment storage' })
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue')
    const { handles } = registerTestIpcHandlers(container)

    await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, {
      sessionId: session.id,
      prompt: 'Needs storage',
      modelId: 'mock/hesper-fast',
      messageId: 'message-missing-storage',
      draftAttachments: [
        { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', bytes: 5, content: 'hello' }
      ]
    })).rejects.toThrow('Attachment storage is required to enqueue draft attachments')

    expect(enqueueSpy).not.toHaveBeenCalled()
    expect(await persistence.messages.listBySession(session.id)).toEqual([])
  })

  it('rejects path traversal for attachment data URL reads', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-ipc-attachments-'))
    try {
      const persistence = await createInMemoryPersistence()
      const container = createServiceContainer({ persistence, agentMode: 'mock' })
      const { handles } = registerTestIpcHandlers(container, { attachmentStorage: createAttachmentStorage(userDataPath) })

      await expect(handles.get(ipcChannels.attachmentsReadDataUrl)?.({ sender: { id: 1 } }, {
        relativePath: '../secret.png',
        mimeType: 'image/png'
      })).rejects.toThrow(/attachments|path|traversal|relative/i)
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true })
    }
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
    const session = await container.sessionService.createSession({ title: 'Validation' })
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue')

    await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: '', prompt: '', modelId: '' })).rejects.toThrow()
    await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: session.id, prompt: '', modelId: 'mock/hesper-fast' })).rejects.toThrow()
    expect(enqueueSpy).not.toHaveBeenCalled()
    expect(await persistence.messages.listBySession('')).toEqual([])
    expect(await persistence.messages.listBySession(session.id)).toEqual([])
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
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { defaultModelId: 'deepseek-chat', defaultOutputMode: 'html', themeMode: 'dark', themeId: 'tokyo-night', fontSize: 16, soul: '保持中文输出。' })
    ).resolves.toEqual({ defaultModelId: 'deepseek-chat', defaultOutputMode: 'html', themeMode: 'dark', themeId: 'tokyo-night', fontSize: 16, soul: '保持中文输出。' })
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
      themeId: 'tokyo-night',
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
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { themeId: 'solarized' })
    ).rejects.toThrow()

    await expect(
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'html', themeId: 'dracula', fontSize: 15 })
    ).resolves.toMatchObject({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'html', themeId: 'dracula', fontSize: 15 })
  })
})
