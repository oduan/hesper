import { agentRuntimeEventSchema } from '@hesper/shared'
import type { Dialog, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  agentEnqueueInputSchema,
  appSettingsSchema,
  createSessionInputSchema,
  directorySelectionSchema,
  ipcChannels,
  ipcEvents,
  sessionIdInputSchema,
  setSessionModelInputSchema,
  setSessionOutputModeInputSchema,
  setSessionWorkspaceInputSchema,
  subscribeAgentEventsResultSchema,
  unsubscribeAgentEventsResultSchema,
  updateSessionTitleInputSchema,
  updateSettingsInputSchema
} from './ipc-contract'
import type { ServiceContainer } from './service-container'

export type RegisterIpcHandlersOptions = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  dialog: Pick<Dialog, 'showOpenDialog'>
  container: ServiceContainer
  savePersistence?: () => Promise<void>
  schedulePersistenceSave?: () => void
}

const mutatingChannels = [
  ipcChannels.sessionsCreate,
  ipcChannels.sessionsUpdateTitle,
  ipcChannels.sessionsArchive,
  ipcChannels.sessionsDelete,
  ipcChannels.sessionsSetWorkspace,
  ipcChannels.sessionsSetModel,
  ipcChannels.sessionsSetOutputMode,
  ipcChannels.agentEnqueue,
  ipcChannels.settingsUpdate
] as const

type StripUndefined<T extends Record<string, unknown>> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K]
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
}

function omitUndefined<T extends Record<string, unknown>>(value: T): StripUndefined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined)) as StripUndefined<T>
}

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): () => void {
  const savePersistence = options.savePersistence ?? (async () => {})
  const schedulePersistenceSave = options.schedulePersistenceSave ?? (() => {})
  const subscriptions = new Map<number, () => void>()

  const detachRuntimePersistence = options.container.agentRuntime.subscribe(async () => {
    schedulePersistenceSave()
  })

  const unsubscribeSender = (senderId: number) => {
    subscriptions.get(senderId)?.()
    subscriptions.delete(senderId)
  }

  const validateEvent = (event: unknown) => {
    const parsed = agentRuntimeEventSchema.safeParse(event)
    if (!parsed.success) {
      throw parsed.error
    }
    return parsed.data
  }

  const subscribeSender = (event: IpcMainInvokeEvent) => {
    const senderId = event.sender.id
    unsubscribeSender(senderId)
    event.sender.once('destroyed', () => unsubscribeSender(senderId))
    const unsubscribe = options.container.agentRuntime.subscribe(async (runtimeEvent) => {
      const target = event.sender
      if (target.isDestroyed()) {
        unsubscribeSender(senderId)
        return
      }
      target.send(ipcEvents.agentEvent, validateEvent(runtimeEvent))
    })
    subscriptions.set(senderId, unsubscribe)
  }

  const handlers: Record<string, (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>> = {
    [ipcChannels.sessionsList]: async () => options.container.sessionService.listSessions(),
    [ipcChannels.sessionsCreate]: async (_event, payload) => {
      const session = await options.container.sessionService.createSession(omitUndefined(createSessionInputSchema.parse(payload ?? {})))
      await savePersistence()
      return session
    },
    [ipcChannels.sessionsUpdateTitle]: async (_event, payload) => {
      const input = updateSessionTitleInputSchema.parse(payload)
      const session = await options.container.sessionService.updateTitle(input.id, input.title)
      await savePersistence()
      return session
    },
    [ipcChannels.sessionsArchive]: async (_event, payload) => {
      const session = await options.container.sessionService.archiveSession(sessionIdInputSchema.parse(payload))
      await savePersistence()
      return session
    },
    [ipcChannels.sessionsDelete]: async (_event, payload) => {
      const session = await options.container.sessionService.deleteSession(sessionIdInputSchema.parse(payload))
      await savePersistence()
      return session
    },
    [ipcChannels.sessionsSetWorkspace]: async (_event, payload) => {
      const input = setSessionWorkspaceInputSchema.parse(payload)
      const session = await options.container.sessionService.setWorkspacePath(input.id, input.workspacePath)
      await savePersistence()
      return session
    },
    [ipcChannels.sessionsSetModel]: async (_event, payload) => {
      const input = setSessionModelInputSchema.parse(payload)
      const session = await options.container.sessionService.setDefaultModel(input.id, input.defaultModelId)
      await savePersistence()
      return session
    },
    [ipcChannels.sessionsSetOutputMode]: async (_event, payload) => {
      const input = setSessionOutputModeInputSchema.parse(payload)
      const session = await options.container.sessionService.setOutputMode(input.id, input.outputMode)
      await savePersistence()
      return session
    },
    [ipcChannels.dialogSelectDirectory]: async () => {
      const result = await options.dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      return directorySelectionSchema.parse({
        canceled: result.canceled,
        path: result.canceled ? undefined : result.filePaths[0]
      })
    },
    [ipcChannels.agentEnqueue]: async (_event, payload) => {
      const input = agentEnqueueInputSchema.parse(payload)
      await options.container.conversationService.createUserMessage({
        sessionId: input.sessionId,
        content: input.prompt
      })
      const run = await options.container.agentRuntime.enqueue(omitUndefined(input))
      await savePersistence()
      return { runId: run.id }
    },
    [ipcChannels.agentEventsSubscribe]: async (event) => {
      subscribeSender(event)
      return subscribeAgentEventsResultSchema.parse({ subscribed: true })
    },
    [ipcChannels.agentEventsUnsubscribe]: async (event) => {
      unsubscribeSender(event.sender.id)
      return unsubscribeAgentEventsResultSchema.parse({ unsubscribed: true })
    },
    [ipcChannels.settingsGet]: async () => appSettingsSchema.parse(options.container.settingsService.getSettings()),
    [ipcChannels.settingsUpdate]: async (_event, payload) => {
      const settings = options.container.settingsService.updateSettings(omitUndefined(updateSettingsInputSchema.parse(payload ?? {})))
      await savePersistence()
      return appSettingsSchema.parse(settings)
    }
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    options.ipcMain.handle(channel, handler)
  }

  return () => {
    detachRuntimePersistence()
    for (const senderId of subscriptions.keys()) unsubscribeSender(senderId)
    for (const channel of Object.keys(handlers)) options.ipcMain.removeHandler(channel)
  }
}

export { mutatingChannels }
