const { contextBridge, ipcRenderer } = require('electron')

const ipcChannels = {
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsUpdateTitle: 'sessions:updateTitle',
  sessionsArchive: 'sessions:archive',
  sessionsDelete: 'sessions:delete',
  sessionsSetWorkspace: 'sessions:setWorkspace',
  sessionsSetModel: 'sessions:setModel',
  sessionsSetOutputMode: 'sessions:setOutputMode',
  dialogSelectDirectory: 'dialog:selectDirectory',
  agentEnqueue: 'agent:enqueue',
  agentEventsSubscribe: 'agent:events:subscribe',
  agentEventsUnsubscribe: 'agent:events:unsubscribe',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  credentialsProviderStatus: 'credentials:providerStatus',
  credentialsSaveProviderApiKey: 'credentials:saveProviderApiKey',
  credentialsDeleteProviderApiKey: 'credentials:deleteProviderApiKey',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close'
}

const ipcEvents = {
  agentEvent: 'agent:event'
}

const hesperApi = {
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
      const handler = (_event, runtimeEvent) => listener(runtimeEvent)
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
  window: {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
    close: () => ipcRenderer.invoke(ipcChannels.windowClose)
  }
}

contextBridge.exposeInMainWorld('hesper', hesperApi)
