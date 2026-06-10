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
      return () => ipcRenderer.off(ipcEvents.agentEvent, handler)
    }
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke(ipcChannels.dialogSelectDirectory)
  },
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (input) => ipcRenderer.invoke(ipcChannels.settingsUpdate, input)
  }
}

contextBridge.exposeInMainWorld('hesper', hesperApi)
