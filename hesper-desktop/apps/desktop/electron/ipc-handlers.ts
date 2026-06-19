import { agentRuntimeEventSchema, modelConfigSchema, modelProviderConfigSchema } from '@hesper/shared'
import { BrowserWindow, type Dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  agentEnqueueInputSchema,
  appSettingsSchema,
  conversationMessagesResultSchema,
  conversationRunsResultSchema,
  conversationStepsResultSchema,
  createRoleInputSchema,
  createSessionInputSchema,
  directorySelectionSchema,
  generateSessionTitleInputSchema,
  ipcChannels,
  ipcEvents,
  listModelsInputSchema,
  managedRoleDtoSchema,
  providerConnectionTestInputSchema,
  providerConnectionTestResultSchema,
  providerCredentialInputSchema,
  providerCredentialStatusSchema,
  providerIdInputSchema,
  saveModelInputSchema,
  saveModelProviderInputSchema,
  saveProviderApiKeyInputSchema,
  runIdInputSchema,
  sessionIdInputSchema,
  setSessionModelInputSchema,
  setSessionOutputModeInputSchema,
  setSessionWorkspaceInputSchema,
  setToolEnabledInputSchema,
  saveToolApiKeyInputSchema,
  subscribeAgentEventsResultSchema,
  toolCredentialInputSchema,
  toolCredentialStatusSchema,
  toolDtoSchema,
  unsubscribeAgentEventsResultSchema,
  updateRoleInputSchema,
  updateSessionTitleInputSchema,
  updateSettingsInputSchema
} from './ipc-contract'
import type { ServiceContainer } from './service-container'

type WindowControlTarget = Pick<BrowserWindow, 'minimize' | 'maximize' | 'unmaximize' | 'isMaximized' | 'close'>

export type RegisterIpcHandlersOptions = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  dialog: Pick<Dialog, 'showOpenDialog'>
  container: ServiceContainer
  savePersistence?: () => Promise<void>
  schedulePersistenceSave?: () => void
  getWindowForEvent?: (event: IpcMainInvokeEvent) => WindowControlTarget | undefined
}

const mutatingChannels = [
  ipcChannels.sessionsCreate,
  ipcChannels.sessionsUpdateTitle,
  ipcChannels.sessionsGenerateTitle,
  ipcChannels.sessionsArchive,
  ipcChannels.sessionsDelete,
  ipcChannels.sessionsSetWorkspace,
  ipcChannels.sessionsSetModel,
  ipcChannels.sessionsSetOutputMode,
  ipcChannels.sessionsMarkViewed,
  ipcChannels.agentEnqueue,
  ipcChannels.settingsUpdate,
  ipcChannels.credentialsSaveProviderApiKey,
  ipcChannels.credentialsDeleteProviderApiKey,
  ipcChannels.providersSave,
  ipcChannels.providersDisable,
  ipcChannels.providersDelete,
  ipcChannels.modelsSave,
  ipcChannels.toolsSetEnabled,
  ipcChannels.toolsSaveApiKey,
  ipcChannels.toolsDeleteApiKey,
  ipcChannels.rolesCreate,
  ipcChannels.rolesUpdate,
  ipcChannels.rolesDelete
] as const

type StripUndefined<T extends Record<string, unknown>> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K]
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
}

function omitUndefined<T extends Record<string, unknown>>(value: T): StripUndefined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined)) as StripUndefined<T>
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): () => void {
  const savePersistence = options.savePersistence ?? (async () => {})
  const schedulePersistenceSave = options.schedulePersistenceSave ?? (() => {})
  const subscriptions = new Map<number, () => void>()
  const getWindowForEvent = options.getWindowForEvent ?? ((event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender) ?? undefined)

  const validateEvent = (event: unknown) => {
    const parsed = agentRuntimeEventSchema.safeParse(event)
    if (!parsed.success) {
      throw parsed.error
    }
    return parsed.data
  }

  const markRuntimeCompletionUnread = async (runtimeEvent: unknown) => {
    const event = validateEvent(runtimeEvent)
    if (event.type === 'message.completed' && event.message.role === 'assistant') {
      await options.container.sessionService.markUnreadCompleted(event.message.sessionId, event.message.createdAt)
      return
    }

    if (event.type === 'run.failed') {
      const run = await options.container.persistence.runs.get(event.runId)
      if (run) {
        await options.container.sessionService.markUnreadCompleted(run.sessionId, run.endedAt)
      }
    }
  }

  const detachRuntimePersistence = options.container.agentRuntime.subscribe(async (runtimeEvent) => {
    try {
      await markRuntimeCompletionUnread(runtimeEvent)
    } finally {
      schedulePersistenceSave()
    }
  })

  const unsubscribeSender = (senderId: number) => {
    subscriptions.get(senderId)?.()
    subscriptions.delete(senderId)
  }

  const assembleRunContext = async (sessionId: string, workspacePath?: string, requestedEnabledToolIds?: string[]): Promise<{ systemPrompt: string; enabledToolIds: string[]; workspacePath?: string }> => {
    const session = await options.container.sessionService.getSession(sessionId)
    const resolvedWorkspacePath = workspacePath ?? session.workspacePath
    const roles = options.container.roleService.listRoles()
    const role = options.container.roleService.getRole(session.roleId ?? 'main-agent')
    const assignableWorkerAgentRoles = roles.filter((candidate) => candidate.canBeAssignedToWorkerAgent ?? candidate.canBeWorkerAgent)
    const configuredToolIds = session.enabledToolIds?.length ? session.enabledToolIds : role?.defaultToolIds ?? []
    const requestedToolIdSet = requestedEnabledToolIds === undefined ? undefined : new Set(requestedEnabledToolIds)
    const enabledToolIdsBeforeGlobalFilter = requestedToolIdSet ? configuredToolIds.filter((toolId) => requestedToolIdSet.has(toolId)) : configuredToolIds
    const enabledToolIds = await options.container.toolSettingsService.filterEnabledToolIds(enabledToolIdsBeforeGlobalFilter)
    const sessionForPrompt = {
      ...session,
      ...(resolvedWorkspacePath !== undefined ? { workspacePath: resolvedWorkspacePath } : {}),
      enabledSkillIds: session.enabledSkillIds?.length ? session.enabledSkillIds : role?.defaultSkillIds ?? role?.allowedSkillIds ?? [],
      enabledToolIds,
      allowedWorkerAgentRoleIds: session.allowedWorkerAgentRoleIds?.length ? session.allowedWorkerAgentRoleIds : assignableWorkerAgentRoles.map((candidate) => candidate.id),
      maxWorkerAgentDepth: session.maxWorkerAgentDepth ?? 1,
      maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun ?? 3
    }

    const prompt = options.container.promptAssemblyService.assembleMainPrompt({
      session: sessionForPrompt,
      role,
      skills: options.container.skillService.listSkills(),
      tools: options.container.toolCatalogService.list(),
      assignableWorkerAgentRoles
    })

    return omitUndefined({ systemPrompt: prompt.systemPrompt, enabledToolIds: sessionForPrompt.enabledToolIds, workspacePath: resolvedWorkspacePath })
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

  const getRequiredWindow = (event: IpcMainInvokeEvent) => {
    const window = getWindowForEvent(event)
    if (!window) {
      throw new Error('Unable to resolve BrowserWindow for renderer event')
    }
    return window
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
    [ipcChannels.sessionsGenerateTitle]: async (_event, payload) => {
      const input = generateSessionTitleInputSchema.parse(payload)
      const result = await options.container.sessionTitleGenerator.generateTitle({
        usedModelId: input.modelId,
        userPrompt: input.userPrompt,
        ...(input.assistantOutput ? { assistantOutput: input.assistantOutput } : {})
      })
      if (!result) {
        return options.container.sessionService.getSession(input.id)
      }

      const session = await options.container.sessionService.updateTitle(input.id, result.title)
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
    [ipcChannels.sessionsMarkViewed]: async (_event, payload) => {
      const sessionId = sessionIdInputSchema.parse(payload)
      const session = await options.container.sessionService.markViewed(sessionId)
      await savePersistence()
      return session
    },
    [ipcChannels.conversationListMessages]: async (_event, payload) => {
      const sessionId = sessionIdInputSchema.parse(payload)
      return conversationMessagesResultSchema.parse(await options.container.conversationService.listMessages(sessionId))
    },
    [ipcChannels.conversationListRuns]: async (_event, payload) => {
      const sessionId = sessionIdInputSchema.parse(payload)
      return conversationRunsResultSchema.parse(await options.container.conversationService.listRuns(sessionId))
    },
    [ipcChannels.conversationListSteps]: async (_event, payload) => {
      const runId = runIdInputSchema.parse(payload)
      return conversationStepsResultSchema.parse(await options.container.conversationService.listSteps(runId))
    },
    [ipcChannels.dialogSelectDirectory]: async () => {
      const result = await options.dialog.showOpenDialog({ properties: ['openDirectory'] })
      return directorySelectionSchema.parse({
        canceled: result.canceled,
        path: result.canceled ? undefined : result.filePaths[0]
      })
    },
    [ipcChannels.agentEnqueue]: async (_event, payload) => {
      const input = agentEnqueueInputSchema.parse(payload)
      const { messageId, messageCreatedAt, ...runtimeInput } = input
      const runContext = await assembleRunContext(input.sessionId, input.workspacePath, input.enabledToolIds)
      const run = await options.container.agentRuntime.enqueue(omitUndefined({ ...runtimeInput, ...runContext }))
      try {
        await options.container.conversationService.createUserMessage({
          sessionId: input.sessionId,
          content: input.prompt,
          runId: run.id,
          ...(messageId ? { id: messageId } : {}),
          ...(messageCreatedAt ? { now: messageCreatedAt } : {})
        })
      } catch (error) {
        const normalizedError = toError(error)
        await options.container.agentRuntime.failRun(run.id, normalizedError)
        throw normalizedError
      }
      schedulePersistenceSave()
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
    [ipcChannels.settingsGet]: async () => appSettingsSchema.parse(await options.container.settingsService.getSettings()),
    [ipcChannels.settingsUpdate]: async (_event, payload) => {
      const settings = await options.container.settingsService.updateSettings(omitUndefined(updateSettingsInputSchema.parse(payload ?? {})))
      await savePersistence()
      return appSettingsSchema.parse(settings)
    },
    [ipcChannels.rolesList]: async () => z.array(managedRoleDtoSchema).parse(await options.container.roleManagementService.listRoles()),
    [ipcChannels.rolesCreate]: async (_event, payload) => {
      const role = await options.container.roleManagementService.createRole(omitUndefined(createRoleInputSchema.parse(payload)))
      await savePersistence()
      return managedRoleDtoSchema.parse(role)
    },
    [ipcChannels.rolesUpdate]: async (_event, payload) => {
      const role = await options.container.roleManagementService.updateRole(omitUndefined(updateRoleInputSchema.parse(payload)))
      await savePersistence()
      return managedRoleDtoSchema.parse(role)
    },
    [ipcChannels.rolesDelete]: async (_event, payload) => {
      const result = await options.container.roleManagementService.deleteRole(sessionIdInputSchema.parse(payload))
      await savePersistence()
      return result
    },
    [ipcChannels.toolsList]: async () => z.array(toolDtoSchema).parse(await options.container.toolSettingsService.listTools()),
    [ipcChannels.toolsSetEnabled]: async (_event, payload) => {
      const input = setToolEnabledInputSchema.parse(payload)
      const tool = await options.container.toolSettingsService.setToolEnabled(input.id, input.enabled)
      await savePersistence()
      return toolDtoSchema.parse(tool)
    },
    [ipcChannels.toolsCredentialStatus]: async (_event, payload) => {
      const status = await options.container.credentialVaultService.getToolApiKeyStatus(toolCredentialInputSchema.parse(payload))
      return toolCredentialStatusSchema.parse(status)
    },
    [ipcChannels.toolsSaveApiKey]: async (_event, payload) => {
      const status = await options.container.credentialVaultService.saveToolApiKey(saveToolApiKeyInputSchema.parse(payload))
      await savePersistence()
      return toolCredentialStatusSchema.parse(status)
    },
    [ipcChannels.toolsDeleteApiKey]: async (_event, payload) => {
      const status = await options.container.credentialVaultService.deleteToolApiKey(toolCredentialInputSchema.parse(payload))
      await savePersistence()
      return toolCredentialStatusSchema.parse(status)
    },
    [ipcChannels.credentialsProviderStatus]: async (_event, payload) => {
      const status = await options.container.credentialVaultService.getProviderApiKeyStatus(providerCredentialInputSchema.parse(payload))
      return providerCredentialStatusSchema.parse(status)
    },
    [ipcChannels.credentialsSaveProviderApiKey]: async (_event, payload) => {
      const status = await options.container.credentialVaultService.saveProviderApiKey(saveProviderApiKeyInputSchema.parse(payload))
      await savePersistence()
      return providerCredentialStatusSchema.parse(status)
    },
    [ipcChannels.credentialsDeleteProviderApiKey]: async (_event, payload) => {
      const status = await options.container.credentialVaultService.deleteProviderApiKey(providerCredentialInputSchema.parse(payload))
      await savePersistence()
      return providerCredentialStatusSchema.parse(status)
    },
    [ipcChannels.providersList]: async () => z.array(modelProviderConfigSchema).parse(await options.container.modelProviderService.listProviders()),
    [ipcChannels.providersSave]: async (_event, payload) => {
      const provider = await options.container.modelProviderService.saveProvider(omitUndefined(saveModelProviderInputSchema.parse(payload)))
      await savePersistence()
      return modelProviderConfigSchema.parse(provider)
    },
    [ipcChannels.providersDisable]: async (_event, payload) => {
      const provider = await options.container.modelProviderService.disableProvider(providerIdInputSchema.parse(payload).providerId)
      await savePersistence()
      return modelProviderConfigSchema.parse(provider)
    },
    [ipcChannels.providersDelete]: async (_event, payload) => {
      const providerId = providerIdInputSchema.parse(payload).providerId
      const provider = await options.container.modelProviderService.deleteProvider(providerId)
      await savePersistence()
      return provider ? { deleted: true as const, providerId, provider: modelProviderConfigSchema.parse(provider) } : { deleted: true as const, providerId }
    },
    [ipcChannels.providersTestConnection]: async (_event, payload) => {
      const result = await options.container.modelProviderService.testProviderConnection(providerConnectionTestInputSchema.parse(payload))
      return providerConnectionTestResultSchema.parse(result)
    },
    [ipcChannels.modelsList]: async (_event, payload) => {
      const input = listModelsInputSchema.parse(payload ?? {})
      return z.array(modelConfigSchema).parse(await options.container.modelProviderService.listModels(input.providerId))
    },
    [ipcChannels.modelsSave]: async (_event, payload) => {
      const model = await options.container.modelProviderService.saveModel(omitUndefined(saveModelInputSchema.parse(payload)))
      await savePersistence()
      return modelConfigSchema.parse(model)
    },
    [ipcChannels.windowMinimize]: async (event) => {
      getRequiredWindow(event).minimize()
      return { minimized: true }
    },
    [ipcChannels.windowToggleMaximize]: async (event) => {
      const window = getRequiredWindow(event)
      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
      return { isMaximized: window.isMaximized() }
    },
    [ipcChannels.windowClose]: async (event) => {
      getRequiredWindow(event).close()
      return { closed: true }
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
