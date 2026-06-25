import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { createFilePersistence, exportDatabaseBytes } from '@hesper/persistence'
import { createAttachmentStorage } from './attachment-storage'
import { createBeforeQuitHandler } from './before-quit'
import { createElectronSafeStorageCredentialCodec } from './credential-codec'
import { registerIpcHandlers } from './ipc-handlers'
import { createPersistenceSaveQueue } from './persistence-save-queue'
import { createPersistenceSaveScheduler } from './persistence-save-scheduler'
import { installNavigationGuards, resolveRendererLoadTarget } from './renderer-security'
import { resolveAgentMode } from './agent-mode'
import { createServiceContainer, type ServiceContainer } from './service-container'
import { createElectronSkillService, startSkillService } from './skill-service-lifecycle'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rendererIndexPath = path.resolve(__dirname, '../renderer/index.html')
const preloadPath = path.resolve(__dirname, 'preload.cjs')
const windowsIconPath = path.resolve(__dirname, '../assets/hesper-icon.ico')
const fallbackIconPath = path.resolve(__dirname, '../assets/hesper-icon.png')

app.setName('Hesper')

function resolveAppIconPath(): string | undefined {
  const iconPath = process.platform === 'win32' ? windowsIconPath : fallbackIconPath
  return fs.existsSync(iconPath) ? iconPath : undefined
}

const configuredUserDataPath = process.env.HESPER_USER_DATA_DIR
if (configuredUserDataPath) {
  app.setPath('userData', configuredUserDataPath)
}

let mainWindow: BrowserWindow | null = null
let container: ServiceContainer | null = null
let disposeIpcHandlers: (() => void) | undefined
let persistencePath = ''

function stopSkillAutoScan(): void {
  (container?.skillService as { stopAutoScan?: () => void } | undefined)?.stopAutoScan?.()
}

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

const persistenceSaveScheduler = createPersistenceSaveScheduler({
  savePersistence,
  flushPersistenceQueue: () => persistenceSaveQueue.flush(),
  logError: (message, error) => {
    console.error(message, error)
  }
})

function schedulePersistenceSave(delayMs = 50): void {
  persistenceSaveScheduler.schedule(delayMs)
}

async function flushScheduledPersistence(): Promise<void> {
  await persistenceSaveScheduler.flushScheduled()
}

function createMainWindow(): BrowserWindow {
  const appIconPath = resolveAppIconPath()
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    frame: false,
    show: false,
    // Bootstrap fallback shown before renderer theme variables are available.
    backgroundColor: '#111827',
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  return window
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  const target = resolveRendererLoadTarget({ devServerUrl: process.env.VITE_DEV_SERVER_URL, isPackaged: app.isPackaged })
  installNavigationGuards(window, target.kind === 'url' ? [target.origin] : [])

  if (target.kind === 'url') {
    await window.loadURL(target.url)
    return
  }

  await window.loadFile(rendererIndexPath)
}

async function bootstrap(): Promise<void> {
  persistencePath = path.join(app.getPath('userData'), 'hesper.sqlite')
  const persistence = await createFilePersistence(persistencePath)
  const skillService = createElectronSkillService()
  await startSkillService(skillService)
  container = createServiceContainer({ persistence, agentMode: resolveAgentMode(), credentialCodec: createElectronSafeStorageCredentialCodec(safeStorage), skillService })
  const attachmentStorage = createAttachmentStorage(app.getPath('userData'))
  disposeIpcHandlers = registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave, openExternal: (url) => shell.openExternal(url), attachmentStorage })
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
    stopSkillAutoScan()
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
