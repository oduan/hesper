import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, ipcEvents, type AgentEvent, type HesperDesktopApi } from './ipc-contract'

let agentEventListenerCount = 0

function retainAgentEventSubscription() {
  if (agentEventListenerCount === 0) {
    void ipcRenderer.invoke(ipcChannels.agentEventsSubscribe)
  }
  agentEventListenerCount += 1
}

function releaseAgentEventSubscription() {
  if (agentEventListenerCount === 0) {
    return
  }

  agentEventListenerCount -= 1
  if (agentEventListenerCount === 0) {
    void ipcRenderer.invoke(ipcChannels.agentEventsUnsubscribe)
  }
}

const hesperApi: HesperDesktopApi = {
  sessions: {
    list: () => ipcRenderer.invoke(ipcChannels.sessionsList),
    create: (input) => ipcRenderer.invoke(ipcChannels.sessionsCreate, input),
    updateTitle: (input) => ipcRenderer.invoke(ipcChannels.sessionsUpdateTitle, input),
    generateTitle: (input) => ipcRenderer.invoke(ipcChannels.sessionsGenerateTitle, input),
    archive: (id) => ipcRenderer.invoke(ipcChannels.sessionsArchive, id),
    delete: (id) => ipcRenderer.invoke(ipcChannels.sessionsDelete, id),
    setWorkspace: (input) => ipcRenderer.invoke(ipcChannels.sessionsSetWorkspace, input),
    setModel: (input) => ipcRenderer.invoke(ipcChannels.sessionsSetModel, input),
    setOutputMode: (input) => ipcRenderer.invoke(ipcChannels.sessionsSetOutputMode, input),
    markViewed: (id) => ipcRenderer.invoke(ipcChannels.sessionsMarkViewed, id)
  },
  conversation: {
    listMessages: (sessionId) => ipcRenderer.invoke(ipcChannels.conversationListMessages, sessionId),
    listRuns: (sessionId) => ipcRenderer.invoke(ipcChannels.conversationListRuns, sessionId),
    listSteps: (runId) => ipcRenderer.invoke(ipcChannels.conversationListSteps, runId)
  },
  agent: {
    enqueue: (input) => ipcRenderer.invoke(ipcChannels.agentEnqueue, input),
    subscribe: () => ipcRenderer.invoke(ipcChannels.agentEventsSubscribe),
    onEvent: (listener) => {
      const handler = (_event: unknown, runtimeEvent: AgentEvent) => listener(runtimeEvent)
      let disposed = false
      retainAgentEventSubscription()
      ipcRenderer.on(ipcEvents.agentEvent, handler)
      return () => {
        if (disposed) {
          return
        }
        disposed = true
        ipcRenderer.off(ipcEvents.agentEvent, handler)
        releaseAgentEventSubscription()
      }
    }
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke(ipcChannels.dialogSelectDirectory)
  },
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (input) => ipcRenderer.invoke(ipcChannels.settingsUpdate, input)
  },
  credentials: {
    providerStatus: (input) => ipcRenderer.invoke(ipcChannels.credentialsProviderStatus, input),
    saveProviderApiKey: (input) => ipcRenderer.invoke(ipcChannels.credentialsSaveProviderApiKey, input),
    deleteProviderApiKey: (input) => ipcRenderer.invoke(ipcChannels.credentialsDeleteProviderApiKey, input)
  },
  providers: {
    list: () => ipcRenderer.invoke(ipcChannels.providersList),
    save: (input) => ipcRenderer.invoke(ipcChannels.providersSave, input),
    disable: (input) => ipcRenderer.invoke(ipcChannels.providersDisable, input),
    delete: (input) => ipcRenderer.invoke(ipcChannels.providersDelete, input),
    testConnection: (input) => ipcRenderer.invoke(ipcChannels.providersTestConnection, input)
  },
  models: {
    list: (input) => ipcRenderer.invoke(ipcChannels.modelsList, input),
    save: (input) => ipcRenderer.invoke(ipcChannels.modelsSave, input)
  },
  tools: {
    list: () => ipcRenderer.invoke(ipcChannels.toolsList),
    setEnabled: (input) => ipcRenderer.invoke(ipcChannels.toolsSetEnabled, input),
    credentialStatus: (input) => ipcRenderer.invoke(ipcChannels.toolsCredentialStatus, input),
    saveApiKey: (input) => ipcRenderer.invoke(ipcChannels.toolsSaveApiKey, input),
    deleteApiKey: (input) => ipcRenderer.invoke(ipcChannels.toolsDeleteApiKey, input)
  },
  roles: {
    list: () => ipcRenderer.invoke(ipcChannels.rolesList),
    create: (input) => ipcRenderer.invoke(ipcChannels.rolesCreate, input),
    update: (input) => ipcRenderer.invoke(ipcChannels.rolesUpdate, input),
    delete: (id) => ipcRenderer.invoke(ipcChannels.rolesDelete, id)
  },
  window: {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
    close: () => ipcRenderer.invoke(ipcChannels.windowClose)
  }
}

contextBridge.exposeInMainWorld('hesper', hesperApi)
