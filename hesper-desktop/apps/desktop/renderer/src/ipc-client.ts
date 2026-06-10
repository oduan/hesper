import type {
  AgentEnqueueInput,
  AppSettings,
  CreateSessionInput,
  DirectorySelectionResult,
  HesperDesktopApi,
  ModelDto,
  ModelProviderDto,
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
    credentials: {
      providerStatus: async (input) => ({
        providerId: input.providerId,
        apiKeyRef: `provider:${input.providerId}:api-key`,
        hasApiKey: false,
        encryptionAvailable: false,
        warning: 'Secure credential storage is unavailable in renderer fallback mode.'
      }),
      saveProviderApiKey: async (input) => {
        throw new Error(`Secure credential storage is unavailable for provider ${input.providerId} in renderer fallback mode.`)
      },
      deleteProviderApiKey: async (input) => ({
        providerId: input.providerId,
        apiKeyRef: `provider:${input.providerId}:api-key`,
        hasApiKey: false,
        encryptionAvailable: false,
        warning: 'Secure credential storage is unavailable in renderer fallback mode.'
      })
    },
    providers: {
      list: async () => [{
        id: 'mock',
        name: 'Mock',
        kind: 'mock',
        enabled: true,
        defaultModelId: 'mock/hesper-fast',
        apiKeyRef: 'provider:mock:api-key',
        hasApiKey: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      save: async (input): Promise<ModelProviderDto> => {
        const timestamp = new Date().toISOString()
        return withDefined({
          id: input.id,
          name: input.name,
          kind: input.kind,
          apiKeyRef: `provider:${input.id}:api-key`,
          hasApiKey: false,
          enabled: input.enabled ?? true,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
          ...(input.defaultModelId !== undefined ? { defaultModelId: input.defaultModelId } : {})
        }) as ModelProviderDto
      },
      disable: async (input) => ({
        id: input.providerId,
        name: input.providerId,
        kind: 'custom',
        apiKeyRef: `provider:${input.providerId}:api-key`,
        hasApiKey: false,
        enabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      testConnection: async (input) => ({
        providerId: input.providerId,
        status: input.providerId === 'mock' ? 'ok' : 'needs_api_key',
        hasApiKey: false,
        message: input.providerId === 'mock' ? 'Mock provider is available.' : 'Provider needs an API key.'
      })
    },
    models: {
      list: async (input = {}) => [{
        id: 'mock/hesper-fast',
        providerId: input.providerId ?? 'mock',
        modelName: 'mock/hesper-fast',
        displayName: 'Hesper Mock Fast',
        capabilities: ['streaming', 'toolCalls'],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      save: async (input): Promise<ModelDto> => {
        const timestamp = new Date().toISOString()
        return withDefined({
          id: input.id,
          providerId: input.providerId,
          modelName: input.modelName,
          displayName: input.displayName,
          capabilities: input.capabilities ?? ['streaming'],
          enabled: input.enabled ?? true,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {})
        }) as ModelDto
      }
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
