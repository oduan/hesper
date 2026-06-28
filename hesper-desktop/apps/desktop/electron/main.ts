import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { createFilePersistence } from '@hesper/persistence'
import { createAttachmentStorage } from './attachment-storage'
import { createBeforeQuitHandler } from './before-quit'
import { createDatabaseMaintenanceScheduler, type DatabaseMaintenanceScheduler } from './database-maintenance-scheduler'
import { createElectronSafeStorageCredentialCodec } from './credential-codec'
import { registerIpcHandlers } from './ipc-handlers'
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
} else if (!app.isPackaged) {
  const defaultUserDataPath = app.getPath('userData')
  const devUserDataPath = `${defaultUserDataPath}-dev`
  fs.mkdirSync(devUserDataPath, { recursive: true })
  app.setPath('userData', devUserDataPath)
}

let mainWindow: BrowserWindow | null = null
let container: ServiceContainer | null = null
let databaseMaintenanceScheduler: DatabaseMaintenanceScheduler | undefined
let disposeIpcHandlers: (() => void) | undefined

function stopSkillAutoScan(): void {
  (container?.skillService as { stopAutoScan?: () => void } | undefined)?.stopAutoScan?.()
}

function stopDatabaseMaintenance(): void {
  databaseMaintenanceScheduler?.stop()
  databaseMaintenanceScheduler = undefined
}

async function savePersistence(): Promise<void> {
  // Native file-backed SQLite persists repository writes directly.
}

function schedulePersistenceSave(_delayMs = 50): void {
  // Native file-backed SQLite does not need delayed full-snapshot saves.
}

async function flushScheduledPersistence(): Promise<void> {
  // No scheduled full-snapshot saves exist for native file-backed SQLite.
}

async function closePersistence(): Promise<void> {
  stopDatabaseMaintenance()
  const persistence = container?.persistence
  try {
    await persistence?.checkpoint?.()
  } catch (error) {
    console.error('Failed to checkpoint persistence before quit.', error)
  } finally {
    persistence?.close?.()
  }
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
  const persistencePath = path.join(app.getPath('userData'), 'hesper.sqlite')
  const persistence = await createFilePersistence(persistencePath)
  databaseMaintenanceScheduler = createDatabaseMaintenanceScheduler({
    persistence,
    logError: (message, error) => {
      console.error(message, error)
    }
  })
  databaseMaintenanceScheduler.start()
  const skillService = createElectronSkillService()
  await startSkillService(skillService)
  container = createServiceContainer({ persistence, agentMode: resolveAgentMode(), credentialCodec: createElectronSafeStorageCredentialCodec(safeStorage), skillService })
  await container.modelProviderService.ensureBuiltinProviders()
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
  closePersistence,
  disposeIpcHandlers: () => {
    stopSkillAutoScan()
    stopDatabaseMaintenance()
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
