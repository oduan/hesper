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
  })

  it('seeds builtin providers for an empty desktop persistence store', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec: createMockCredentialCodec() })

    await container.modelProviderService.ensureBuiltinProviders()

    expect((await container.modelProviderService.listProviders()).map((provider) => provider.id)).toEqual(['mock', 'deepseek', 'openai', 'openai-compatible'])
    expect((await container.modelProviderService.listModels('mock')).map((model) => model.id)).toEqual(['mock/hesper-fast'])
  })
})

describe('registerIpcHandlers', () => {
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
    await handles.get(ipcChannels.agentEnqueue)?.({ sender }, { sessionId: session.id, prompt: 'Ping', modelId: 'mock/hesper-fast', messageId: 'message-client-1' })
    await container.agentRuntime.waitForIdle(session.id)

    expect(await persistence.messages.listBySession(session.id)).toEqual([
      expect.objectContaining({
        id: 'message-client-1',
        sessionId: session.id,
        role: 'user',
        content: 'Ping'
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

  it('flushes the persisted user message before surfacing runtime enqueue failures', async () => {
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

    const enqueueSpy = vi.spyOn(container.agentRuntime, 'enqueue').mockRejectedValueOnce(new Error('runtime failed'))

    registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })
    const session = await container.sessionService.createSession({ title: 'IPC failure' })

    await expect(
      handles.get(ipcChannels.agentEnqueue)?.({ sender: { id: 1 } }, { sessionId: session.id, prompt: 'Persist me', modelId: 'mock/hesper-fast', messageId: 'message-failure-1' })
    ).rejects.toThrow('runtime failed')

    expect(enqueueSpy).toHaveBeenCalled()
    expect(schedulePersistenceSave).toHaveBeenCalled()
    expect(savePersistence).toHaveBeenCalled()
    expect(await persistence.messages.listBySession(session.id)).toEqual([
      expect.objectContaining({
        id: 'message-failure-1',
        role: 'user',
        content: 'Persist me'
      })
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
  })

  it('manages providers and models through strict IPC without returning API keys', async () => {
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
      handles.get(ipcChannels.modelsSave)?.({ sender: { id: 1 } }, { id: 'm', providerId: 'p', modelName: 'm', displayName: 'M', unexpected: true })
    ).rejects.toThrow()
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
      handles.get(ipcChannels.settingsUpdate)?.({ sender: { id: 1 } }, { defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'html' })
    ).resolves.toMatchObject({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'html' })
  })
})
