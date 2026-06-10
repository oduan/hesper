import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import { registerIpcHandlers } from '../electron/ipc-handlers'
import { ipcChannels, ipcEvents } from '../electron/ipc-contract'
import { createServiceContainer } from '../electron/service-container'

describe('desktop service container', () => {
  it('creates a session through app-core services', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })
    const session = await container.sessionService.createSession({ title: 'Desktop test' })

    expect(session.title).toBe('Desktop test')
    expect(await container.sessionService.listSessions()).toHaveLength(1)
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
    await handles.get(ipcChannels.agentEnqueue)?.({ sender }, { sessionId: session.id, prompt: 'Ping', modelId: 'mock/hesper-fast' })
    await container.agentRuntime.waitForIdle(session.id)

    expect(await persistence.messages.listBySession(session.id)).toEqual([
      expect.objectContaining({
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
})
