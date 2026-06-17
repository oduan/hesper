import fs from 'node:fs'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import desktopPackage from '../package.json'

const appRoot = path.resolve(import.meta.dirname, '..')
const ipcContractPath = path.join(appRoot, 'electron', 'ipc-contract.ts')
const preloadPath = path.join(appRoot, 'electron', 'preload.cjs')
const startElectronDevPath = path.join(appRoot, 'scripts', 'start-electron-dev.mjs')
const verifyPreloadContractScriptUrl = pathToFileURL(path.join(appRoot, 'scripts', 'verify-preload-contract.mjs')).href
const require = createRequire(import.meta.url)

type MockIpcRenderer = {
  invoke: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

function loadPreloadApiWithMockedElectron() {
  const exposed: Record<string, any> = {}
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const ipcRenderer: MockIpcRenderer = {
    invoke: vi.fn(() => Promise.resolve({})),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set<(...args: unknown[]) => void>()
      channelListeners.add(handler)
      listeners.set(channel, channelListeners)
      return ipcRenderer
    }),
    off: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(handler)
      return ipcRenderer
    })
  }
  const electronMock = {
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, api: unknown) => {
        exposed[key] = api
      })
    },
    ipcRenderer
  }
  const moduleLoader = Module as unknown as {
    _load(request: string, parent: unknown, isMain: boolean): unknown
  }
  const originalLoad = moduleLoader._load

  moduleLoader._load = function mockedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === 'electron') {
      return electronMock
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    delete require.cache[require.resolve(preloadPath)]
    require(preloadPath)
  } finally {
    moduleLoader._load = originalLoad
  }

  return { api: exposed.hesper, ipcRenderer, listeners }
}

function readObjectLiteral(source: string, declarationPattern: RegExp, label: string) {
  const match = source.match(declarationPattern)
  if (!match?.[1]) {
    throw new Error(`Unable to locate ${label}`)
  }

  return Function(`"use strict"; return (${match[1]})`)() as Record<string, string>
}

describe('desktop runtime tooling', () => {
  it('keeps one main-process agent event subscription until every preload listener unsubscribes', () => {
    const { api, ipcRenderer } = loadPreloadApiWithMockedElectron()

    const stopFirst = api.agent.onEvent(() => undefined)
    const stopSecond = api.agent.onEvent(() => undefined)

    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, 'agent:events:subscribe')

    stopFirst()
    expect(ipcRenderer.invoke.mock.calls.filter(([channel]) => channel === 'agent:events:unsubscribe')).toHaveLength(0)

    stopSecond()
    expect(ipcRenderer.invoke.mock.calls.filter(([channel]) => channel === 'agent:events:unsubscribe')).toHaveLength(1)
  })

  it('detects preload API namespace and method drift between TypeScript and CommonJS preload files', async () => {
    const { assertPreloadApiMethodsAligned } = await import(verifyPreloadContractScriptUrl)
    const tsSource = `
      const hesperApi = {
        agent: {
          enqueue: () => undefined,
          onEvent: () => undefined
        },
        settings: {
          get: () => undefined
        }
      }
    `
    const cjsSource = `
      const hesperApi = {
        agent: {
          enqueue: () => undefined
        },
        settings: {
          get: () => undefined
        }
      }
    `

    expect(() => assertPreloadApiMethodsAligned(tsSource, cjsSource)).toThrow(/preload API methods drifted/)
  })

  it('keeps preload.cjs channels and events aligned with ipc-contract.ts', () => {
    const ipcContractSource = fs.readFileSync(ipcContractPath, 'utf8')
    const preloadSource = fs.readFileSync(preloadPath, 'utf8')

    const expectedChannels = readObjectLiteral(ipcContractSource, /export const ipcChannels = (\{[\s\S]*?\}) as const/, 'ipcChannels in ipc-contract.ts')
    const expectedEvents = readObjectLiteral(ipcContractSource, /export const ipcEvents = (\{[\s\S]*?\}) as const/, 'ipcEvents in ipc-contract.ts')
    const preloadChannels = readObjectLiteral(preloadSource, /const ipcChannels = (\{[\s\S]*?\})\r?\n/, 'ipcChannels in preload.cjs')
    const preloadEvents = readObjectLiteral(preloadSource, /const ipcEvents = (\{[\s\S]*?\})\r?\n/, 'ipcEvents in preload.cjs')

    expect(preloadChannels).toEqual(expectedChannels)
    expect(preloadEvents).toEqual(expectedEvents)
  })

  it('keeps dev script self-contained for workspace runtime startup', () => {
    const devPrepareScript = desktopPackage.scripts['dev:prepare']
    const devScript = desktopPackage.scripts.dev
    const verifyDevRuntimeScript = desktopPackage.scripts['verify-dev-runtime']

    expect(devPrepareScript).toContain('pnpm --filter @hesper/persistence build')
    expect(devPrepareScript).toContain('pnpm --filter @hesper/tools build')
    expect(devPrepareScript).toContain('node scripts/fix-esm-imports.mjs')
    expect(devPrepareScript).toContain('node scripts/verify-dev-runtime.mjs')
    expect(devScript).toContain('pnpm dev:prepare')
    expect(devScript).toContain('node scripts/copy-preload.mjs --watch')
    expect(devScript).toContain('node scripts/fix-esm-imports.mjs --watch')
    expect(devScript).toContain('dist/electron/preload.cjs')
    expect(devScript).toContain('node scripts/start-electron-dev.mjs')
    expect(verifyDevRuntimeScript).toContain('node scripts/clean-dev-runtime.mjs')
    expect(verifyDevRuntimeScript).toContain('pnpm dev:prepare')
  })

  it('starts the dev Electron window against the Vite renderer server instead of stale dist output', () => {
    const startElectronDevSource = fs.readFileSync(startElectronDevPath, 'utf8')

    expect(startElectronDevSource).toContain('VITE_DEV_SERVER_URL')
    expect(startElectronDevSource).toContain('http://127.0.0.1:5173')
    expect(startElectronDevSource).toContain('electron')
  })
})
