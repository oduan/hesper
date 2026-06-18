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

describe('desktop service container', () => {
  it('creates a session through app-core services', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const session = await container.sessionService.createSession({ title: 'Desktop test' })

    expect(session.title).toBe('Desktop test')
    expect(await container.sessionService.listSessions()).toHaveLength(1)
    expect(container.promptAssemblyService.assembleMainPrompt({
      session,
      role: container.roleService.getRole('main-agent')!,
      skills: container.skillService.listSkills(),
      tools: container.toolCatalogService.list(),
      assignableSubagentRoles: container.roleService.listRoles()
    }).systemPrompt).toContain('hesper desktop Agent')
  })

  it('seeds builtin providers for an empty desktop persistence store', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })

    await container.modelProviderService.ensureBuiltinProviders()

    expect((await container.modelProviderService.listProviders()).map((provider) => provider.id)).toEqual(['mock', 'deepseek', 'openai', 'openai-compatible'])
    expect((await container.modelProviderService.listModels('mock')).map((model) => model.id)).toEqual(['mock/hesper-fast'])
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

    const dispose = registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })

    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.sessionsList, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.agentEventsSubscribe, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.agentEventsUnsubscribe, expect.any(Function))

    await handles.get(ipcChannels.agentEventsSubscribe)?.({ sender })
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
      subagentRules: 'rules'
    }
    const promptSpy = vi.spyOn(container.promptAssemblyService, 'assembleMainPrompt').mockReturnValueOnce(assembled)
    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockResolvedValueOnce({ id: 'run-assembled' } as Awaited<ReturnType<typeof container.agentRuntime.enqueue>>)
    const createUserMessageSpy = vi.spyOn(container.conversationService, 'createUserMessage')

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })
    const session = await container.sessionService.createSession({ title: 'Prompt assembly IPC', workspacePath: 'C:/workspace' })

    await expect(handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: session.id, prompt: 'Use assembled prompt', modelId: 'mock/hesper-fast', messageId: 'message-client-1', messageCreatedAt: '2026-06-10T03:00:02.000Z' })).resolves.toEqual({ runId: 'run-assembled' })

    expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        id: session.id,
        workspacePath: 'C:/workspace',
        enabledToolIds: ['filesystem.read-file', 'git.status', 'web.fetch-url', 'system.show-notification']
      }),
      role: expect.objectContaining({ id: 'main-agent' }),
      skills: expect.any(Array),
      tools: expect.any(Array),
      assignableSubagentRoles: expect.any(Array)
    }))
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      prompt: 'Use assembled prompt',
      modelId: 'mock/hesper-fast',
      systemPrompt: 'assembled system prompt',
      enabledToolIds: ['filesystem.read-file', 'git.status', 'web.fetch-url', 'system.show-notification']
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
      session: expect.objectContaining({ enabledToolIds: ['filesystem.read-file'] })
    }))
    expect(enqueueSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      enabledToolIds: ['filesystem.read-file']
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

    registerIpcHandlers({ ipcMain, dialog, container })

    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.conversationListMessages, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.conversationListRuns, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(ipcChannels.conversationListSteps, expect.any(Function))

    await expect(handles.get(ipcChannels.conversationListMessages)?.({ sender: { id: 1 } }, session.id)).resolves.toEqual([
      expect.objectContaining({ id: 'message-restored-user', content: 'persisted question' })
    ])
    await expect(handles.get(ipcChannels.conversationListRuns)?.({ sender: { id: 1 } }, session.id)).resolves.toEqual([
      expect.objectContaining({ id: 'run-restored', sessionId: session.id })
    ])
    await expect(handles.get(ipcChannels.conversationListSteps)?.({ sender: { id: 1 } }, 'run-restored')).resolves.toEqual([
      expect.objectContaining({ id: 'step-restored', runId: 'run-restored' })
    ])
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
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { defaultModelId: 'deepseek-chat', defaultOutputMode: 'html', themeMode: 'dark', fontSize: 16 })
    ).resolves.toEqual({ defaultModelId: 'deepseek-chat', defaultOutputMode: 'html', themeMode: 'dark', fontSize: 16 })
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
      fontSize: 16
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
