import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createFilePersistence, exportDatabaseBytes } from '@hesper/persistence'
import { registerIpcHandlers } from './ipc-handlers'
import { createServiceContainer, type AgentMode, type ServiceContainer } from './service-container'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rendererIndexPath = path.resolve(__dirname, '../renderer/index.html')
const preloadPath = path.resolve(__dirname, 'preload.js')

let mainWindow: BrowserWindow | null = null
let container: ServiceContainer | null = null
let disposeIpcHandlers: (() => void) | undefined
let persistencePath = ''
let pendingPersistenceWrite: Promise<void> | null = null
let persistenceFlushTimer: NodeJS.Timeout | undefined

async function savePersistence(): Promise<void> {
  if (!container || !persistencePath) return
  fs.mkdirSync(path.dirname(persistencePath), { recursive: true })
  const snapshot = exportDatabaseBytes(container.persistence)
  const writeTask = fs.promises.writeFile(persistencePath, snapshot).then(() => undefined)
  pendingPersistenceWrite = writeTask
  try {
    await writeTask
  } finally {
    if (pendingPersistenceWrite === writeTask) pendingPersistenceWrite = null
  }
}

function schedulePersistenceSave(delayMs = 50): void {
  if (persistenceFlushTimer) clearTimeout(persistenceFlushTimer)
  persistenceFlushTimer = setTimeout(() => {
    persistenceFlushTimer = undefined
    void savePersistence()
  }, delayMs)
}

async function flushScheduledPersistence(): Promise<void> {
  if (persistenceFlushTimer) {
    clearTimeout(persistenceFlushTimer)
    persistenceFlushTimer = undefined
    await savePersistence()
    return
  }
  if (pendingPersistenceWrite) await pendingPersistenceWrite
}

function resolveAgentMode(): AgentMode {
  return process.env.HESPER_AGENT_MODE === 'pi-core' ? 'pi-core' : 'mock'
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    frame: false,
    show: false,
    backgroundColor: '#111827',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())
  return window
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await window.loadURL(devServerUrl)
    return
  }

  await window.loadFile(rendererIndexPath)
}

async function bootstrap(): Promise<void> {
  persistencePath = path.join(app.getPath('userData'), 'hesper.sqlite')
  const persistence = await createFilePersistence(persistencePath)
  container = createServiceContainer({ persistence, agentMode: resolveAgentMode() })
  disposeIpcHandlers = registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave })
  await savePersistence()

  mainWindow = createMainWindow()
  await loadRenderer(mainWindow)
}

app.whenReady().then(async () => {
  await bootstrap()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
      await loadRenderer(mainWindow)
    }
  })
})

app.on('before-quit', async () => {
  await flushScheduledPersistence()
  await savePersistence()
  disposeIpcHandlers?.()
  disposeIpcHandlers = undefined
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
