import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { createFilePersistence, exportDatabaseBytes } from '@hesper/persistence'
import { createBeforeQuitHandler } from './before-quit'
import { createElectronSafeStorageCredentialCodec } from './credential-codec'
import { registerIpcHandlers } from './ipc-handlers'
import { createPersistenceSaveQueue } from './persistence-save-queue'
import { createServiceContainer, type AgentMode, type ServiceContainer } from './service-container'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rendererIndexPath = path.resolve(__dirname, '../renderer/index.html')
const preloadPath = path.resolve(__dirname, 'preload.cjs')

const configuredUserDataPath = process.env.HESPER_USER_DATA_DIR
if (configuredUserDataPath) {
  app.setPath('userData', configuredUserDataPath)
}

let mainWindow: BrowserWindow | null = null
let container: ServiceContainer | null = null
let disposeIpcHandlers: (() => void) | undefined
let persistencePath = ''
let persistenceFlushTimer: NodeJS.Timeout | undefined

const persistenceSaveQueue = createPersistenceSaveQueue({
  exportBytes: () => {
    if (!container) throw new Error('Cannot export persistence before the service container is initialized.')
    return exportDatabaseBytes(container.persistence)
  },
  writeFile: (filePath, snapshot) => fs.promises.writeFile(filePath, snapshot).then(() => undefined),
  mkdir: (dirPath) => fs.promises.mkdir(dirPath, { recursive: true }).then(() => undefined),
  dirname: path.dirname
})

async function savePersistence(): Promise<void> {
  if (!container || !persistencePath) return
  await persistenceSaveQueue.save(persistencePath)
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
  await persistenceSaveQueue.flush()
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
  container = createServiceContainer({ persistence, agentMode: resolveAgentMode(), credentialCodec: createElectronSafeStorageCredentialCodec(safeStorage) })
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

const beforeQuitHandler = createBeforeQuitHandler({
  flushScheduledPersistence,
  savePersistence,
  disposeIpcHandlers: () => {
    disposeIpcHandlers?.()
    disposeIpcHandlers = undefined
  },
  quit: () => app.quit(),
  logError: (message, error) => {
    console.error(message, error)
  }
})

app.on('before-quit', beforeQuitHandler)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
