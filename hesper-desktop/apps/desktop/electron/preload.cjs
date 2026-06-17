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
  conversationListMessages: 'conversation:listMessages',
  conversationListRuns: 'conversation:listRuns',
  conversationListSteps: 'conversation:listSteps',
  dialogSelectDirectory: 'dialog:selectDirectory',
  agentEnqueue: 'agent:enqueue',
  agentEventsSubscribe: 'agent:events:subscribe',
  agentEventsUnsubscribe: 'agent:events:unsubscribe',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  credentialsProviderStatus: 'credentials:providerStatus',
  credentialsSaveProviderApiKey: 'credentials:saveProviderApiKey',
  credentialsDeleteProviderApiKey: 'credentials:deleteProviderApiKey',
  providersList: 'providers:list',
  providersSave: 'providers:save',
  providersDisable: 'providers:disable',
  providersDelete: 'providers:delete',
  providersTestConnection: 'providers:testConnection',
  modelsList: 'models:list',
  modelsSave: 'models:save',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close'
}

const ipcEvents = {
  agentEvent: 'agent:event'
}

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
  conversation: {
    listMessages: (sessionId) => ipcRenderer.invoke(ipcChannels.conversationListMessages, sessionId),
    listRuns: (sessionId) => ipcRenderer.invoke(ipcChannels.conversationListRuns, sessionId),
    listSteps: (runId) => ipcRenderer.invoke(ipcChannels.conversationListSteps, runId)
  },
  agent: {
    enqueue: (input) => ipcRenderer.invoke(ipcChannels.agentEnqueue, input),
    subscribe: () => ipcRenderer.invoke(ipcChannels.agentEventsSubscribe),
    onEvent: (listener) => {
      const handler = (_event, runtimeEvent) => listener(runtimeEvent)
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
  window: {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
    close: () => ipcRenderer.invoke(ipcChannels.windowClose)
  }
}

contextBridge.exposeInMainWorld('hesper', hesperApi)
