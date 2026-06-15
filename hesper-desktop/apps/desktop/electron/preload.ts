import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, ipcEvents, type AgentEvent, type HesperDesktopApi } from './ipc-contract'

const hesperApi: HesperDesktopApi = {
  sessions: {
    list: () => ipcRenderer.invoke(ipcChannels.sessionsList),
    create: (input) => ipcRenderer.invoke(ipcChannels.sessionsCreate, input),
    updateTitle: (input) => ipcRenderer.invoke(ipcChannels.sessionsUpdateTitle, input),
    archive: (id) => ipcRenderer.invoke(ipcChannels.sessionsArchive, id),
    delete: (id) => ipcRenderer.invoke(ipcChannels.sessionsDelete, id),
    setWorkspace: (input) => ipcRenderer.invoke(ipcChannels.sessionsSetWorkspace, input),
    setModel: (input) => ipcRenderer.invoke(ipcChannels.sessionsSetModel, input),
    setOutputMode: (input) => ipcRenderer.invoke(ipcChannels.sessionsSetOutputMode, input)
  },
  agent: {
    enqueue: (input) => ipcRenderer.invoke(ipcChannels.agentEnqueue, input),
    subscribe: () => ipcRenderer.invoke(ipcChannels.agentEventsSubscribe),
    onEvent: (listener) => {
      const handler = (_event: unknown, runtimeEvent: AgentEvent) => listener(runtimeEvent)
      void ipcRenderer.invoke(ipcChannels.agentEventsSubscribe)
      ipcRenderer.on(ipcEvents.agentEvent, handler)
      return () => {
        ipcRenderer.off(ipcEvents.agentEvent, handler)
        void ipcRenderer.invoke(ipcChannels.agentEventsUnsubscribe)
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
  window: {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
    close: () => ipcRenderer.invoke(ipcChannels.windowClose)
  }
}

contextBridge.exposeInMainWorld('hesper', hesperApi)
