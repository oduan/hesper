import type {
  AgentEnqueueInput,
  AppSettings,
  CreateSessionInput,
  DirectorySelectionResult,
  HesperDesktopApi,
  SessionDto,
  SetSessionModelInput,
  SetSessionOutputModeInput,
  SetSessionWorkspaceInput,
  UpdateSessionTitleInput,
  UpdateSettingsInput
} from '../../electron/ipc-contract'

const defaultSettings: AppSettings = {
  defaultModelId: 'mock/hesper-fast',
  defaultOutputMode: 'markdown',
  themeMode: 'dark'
}

function withDefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function createMockSession(input: CreateSessionInput = {}): SessionDto {
  const timestamp = new Date().toISOString()
  return withDefined({
    id: 'session-test',
    title: input.title ?? 'New chat',
    status: 'active',
    workspacePath: input.workspacePath,
    defaultModelId: input.defaultModelId,
    outputMode: input.outputMode ?? 'markdown',
    createdAt: timestamp,
    updatedAt: timestamp
  }) as SessionDto
}

function updateMockSession(id: string, overrides: Partial<SessionDto> = {}): SessionDto {
  return withDefined({
    ...createMockSession(),
    id,
    ...overrides,
    updatedAt: new Date().toISOString()
  }) as SessionDto
}

export function createFallbackHesperApi(): HesperDesktopApi {
  return {
    sessions: {
      list: async () => [],
      create: async (input) => createMockSession(input),
      updateTitle: async (input: UpdateSessionTitleInput) => updateMockSession(input.id, { title: input.title }),
      archive: async (id: string) => updateMockSession(id, { status: 'archived' }),
      delete: async (id: string) => updateMockSession(id, { status: 'deleted' }),
      setWorkspace: async (input: SetSessionWorkspaceInput) =>
        updateMockSession(input.id, input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      setModel: async (input: SetSessionModelInput) =>
        updateMockSession(input.id, input.defaultModelId ? { defaultModelId: input.defaultModelId } : {}),
      setOutputMode: async (input: SetSessionOutputModeInput) => updateMockSession(input.id, { outputMode: input.outputMode })
    },
    agent: {
      enqueue: async (_input: AgentEnqueueInput) => ({ runId: 'run-test' }),
      subscribe: async () => ({ subscribed: true }),
      onEvent: () => () => undefined
    },
    dialog: {
      selectDirectory: async (): Promise<DirectorySelectionResult> => ({ canceled: true })
    },
    settings: {
      get: async () => defaultSettings,
      update: async (input: UpdateSettingsInput) => ({
        defaultModelId: input.defaultModelId ?? defaultSettings.defaultModelId,
        defaultOutputMode: input.defaultOutputMode ?? defaultSettings.defaultOutputMode,
        themeMode: input.themeMode ?? defaultSettings.themeMode
      })
    },
    window: {
      platform: 'win32',
      minimize: async () => ({ minimized: true }),
      toggleMaximize: async () => ({ isMaximized: false }),
      close: async () => ({ closed: true })
    }
  }
}

export function createHesperApi(options?: {
  windowObject?: Window & typeof globalThis
  allowFallback?: boolean
}): HesperDesktopApi {
  const windowObject = options?.windowObject ?? globalThis.window
  const allowFallback = options?.allowFallback ?? (typeof process !== 'undefined' && process.env.VITEST === 'true')

  if (windowObject?.hesper) {
    return windowObject.hesper
  }

  if (allowFallback) {
    return createFallbackHesperApi()
  }

  throw new Error('window.hesper preload API is unavailable')
}

export const hesperApi: HesperDesktopApi = createHesperApi()
