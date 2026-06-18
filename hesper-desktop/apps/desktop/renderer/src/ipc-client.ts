import type {
  AgentEnqueueInput,
  AgentRunDto,
  AppSettings,
  CreateSessionInput,
  DirectorySelectionResult,
  HesperDesktopApi,
  MessageDto,
  GenerateSessionTitleInput,
  ModelDto,
  ModelProviderDto,
  RunStepDto,
  SessionDto,
  SetSessionModelInput,
  SetSessionOutputModeInput,
  SetSessionWorkspaceInput,
  UpdateSessionTitleInput,
  UpdateSettingsInput
} from '../../electron/ipc-contract'
import { createId } from '@hesper/shared'

const defaultSettings: AppSettings = {
  defaultModelId: 'mock/hesper-fast',
  defaultOutputMode: 'markdown',
  themeMode: 'dark'
}

function withDefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function createMockSession(input: CreateSessionInput = {}, id = createId('session')): SessionDto {
  const timestamp = new Date().toISOString()
  return withDefined({
    id,
    title: input.title ?? 'New chat',
    status: 'active',
    workspacePath: input.workspacePath,
    defaultModelId: input.defaultModelId,
    outputMode: input.outputMode ?? 'markdown',
    createdAt: timestamp,
    updatedAt: timestamp
  }) as SessionDto
}

function updateMockSession(session: SessionDto, overrides: Partial<SessionDto> = {}): SessionDto {
  return withDefined({
    ...session,
    ...overrides,
    updatedAt: new Date().toISOString()
  }) as SessionDto
}

export function createFallbackHesperApi(): HesperDesktopApi {
  let nextRunNumber = 1
  let sessions: SessionDto[] = []
  const messagesBySession: Record<string, MessageDto[]> = {}
  const runsBySession: Record<string, AgentRunDto[]> = {}
  const stepsByRun: Record<string, RunStepDto[]> = {}
  const replaceSession = (id: string, updater: (session: SessionDto) => SessionDto): SessionDto => {
    const existing = sessions.find((session) => session.id === id) ?? createMockSession({ title: 'New chat' }, id)
    const updated = updater(existing)
    sessions = [updated, ...sessions.filter((session) => session.id !== id)]
    return updated
  }

  return {
    sessions: {
      list: async () => sessions.filter((session) => session.status !== 'deleted'),
      create: async (input) => {
        const session = createMockSession(input)
        sessions = [session, ...sessions]
        messagesBySession[session.id] = []
        runsBySession[session.id] = []
        return session
      },
      updateTitle: async (input: UpdateSessionTitleInput) => replaceSession(input.id, (session) => updateMockSession(session, { title: input.title })),
      generateTitle: async (input: GenerateSessionTitleInput) => {
        const words = input.userPrompt.replace(/\s+/g, ' ').trim().slice(0, 18)
        return replaceSession(input.id, (session) => updateMockSession(session, { title: words || '新会话' }))
      },
      archive: async (id: string) => replaceSession(id, (session) => updateMockSession(session, { status: 'archived' })),
      delete: async (id: string) => replaceSession(id, (session) => updateMockSession(session, { status: 'deleted' })),
      setWorkspace: async (input: SetSessionWorkspaceInput) =>
        replaceSession(input.id, (session) => updateMockSession(session, input.workspacePath ? { workspacePath: input.workspacePath } : {})),
      setModel: async (input: SetSessionModelInput) =>
        replaceSession(input.id, (session) => updateMockSession(session, input.defaultModelId ? { defaultModelId: input.defaultModelId } : {})),
      setOutputMode: async (input: SetSessionOutputModeInput) => replaceSession(input.id, (session) => updateMockSession(session, { outputMode: input.outputMode }))
    },
    conversation: {
      listMessages: async (sessionId: string) => messagesBySession[sessionId] ?? [],
      listRuns: async (sessionId: string) => runsBySession[sessionId] ?? [],
      listSteps: async (runId: string) => stepsByRun[runId] ?? []
    },
    agent: {
      enqueue: async (_input: AgentEnqueueInput) => ({ runId: `run-fallback-${nextRunNumber++}` }),
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
      list: async (): Promise<ModelProviderDto[]> => {
        const timestamp = new Date().toISOString()
        return [
          { id: 'mock', name: 'Mock', kind: 'mock', enabled: true, defaultModelId: 'mock/hesper-fast', apiKeyRef: 'provider:mock:api-key', hasApiKey: false, createdAt: timestamp, updatedAt: timestamp },
          { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, defaultModelId: 'deepseek-chat', apiKeyRef: 'provider:deepseek:api-key', hasApiKey: false, createdAt: timestamp, updatedAt: timestamp },
          { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true, defaultModelId: 'gpt-4o', apiKeyRef: 'provider:openai:api-key', hasApiKey: false, createdAt: timestamp, updatedAt: timestamp },
          { id: 'openai-compatible', name: 'OpenAI Compatible', kind: 'openai-compatible', enabled: false, defaultModelId: 'openai-compatible/default', apiKeyRef: 'provider:openai-compatible:api-key', hasApiKey: false, createdAt: timestamp, updatedAt: timestamp }
        ]
      },
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
      delete: async (input) => ({ deleted: true as const, providerId: input.providerId }),
      testConnection: async (input) => {
        const providerId = input.providerId ?? 'temporary-provider'
        return {
          providerId,
          status: providerId === 'mock' ? 'ok' : 'needs_api_key',
          hasApiKey: false,
          message: providerId === 'mock' ? 'Mock provider is available.' : 'Provider needs an API key.'
        }
      }
    },
    models: {
      list: async (input = {}): Promise<ModelDto[]> => {
        const timestamp = new Date().toISOString()
        const models: ModelDto[] = [
          { id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming', 'toolCalls'], enabled: true, createdAt: timestamp, updatedAt: timestamp },
          { id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true, createdAt: timestamp, updatedAt: timestamp },
          { id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['streaming', 'toolCalls', 'jsonOutput'], enabled: true, createdAt: timestamp, updatedAt: timestamp },
          { id: 'openai-compatible/default', providerId: 'openai-compatible', modelName: 'model-name', displayName: 'Custom model', capabilities: ['streaming', 'toolCalls'], enabled: false, createdAt: timestamp, updatedAt: timestamp }
        ]
        return input.providerId ? models.filter((model) => model.providerId === input.providerId) : models
      },
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
