import type {
  AgentEnqueueInput,
  AgentRunDto,
  AppSettings,
  CreateSessionInput,
  DirectorySelectionResult,
  HesperDesktopApi,
  MessageDto,
  GenerateSessionTitleInput,
  ManagedRoleDto,
  ModelDto,
  ModelProviderDto,
  RunStepDto,
  SessionDto,
  WorkerAgentInvocationDto,
  SetSessionModelInput,
  SetSessionOutputModeInput,
  SetSessionWorkspaceInput,
  SetToolEnabledInput,
  ToolDto,
  UpdateSessionTitleInput,
  UpdateSettingsInput
} from '../../electron/ipc-contract'
import { createId } from '@hesper/shared'

const defaultSettings: AppSettings = {
  defaultModelId: 'mock/hesper-fast',
  defaultOutputMode: 'markdown',
  themeMode: 'dark',
  fontSize: 14
}

const fallbackBuiltinTools: ToolDto[] = [
  { id: 'filesystem.read-file', name: 'Read File', description: 'Read a text file from the selected workspace.', category: 'filesystem', icon: '📖', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }, enabled: true },
  { id: 'filesystem.write-file', name: 'Write File', description: 'Write a text file in the selected workspace.', category: 'filesystem', icon: '✍️', inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } }, enabled: true },
  { id: 'filesystem.edit-file', name: 'Edit File', description: 'Edit specific 1-based inclusive line ranges in an existing text file from the selected workspace.', category: 'filesystem', icon: '📝', inputSchema: { type: 'object', required: ['path', 'edits'], properties: { path: { type: 'string' }, edits: { type: 'array', items: { type: 'object', required: ['startLine', 'content'], properties: { startLine: { type: 'number' }, endLine: { type: 'number' }, content: { type: 'string' } } } } } }, enabled: true },
  { id: 'filesystem.delete-file', name: 'Delete File', description: 'Delete a file inside the selected workspace.', category: 'filesystem', icon: '🗑️', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }, enabled: true },
  { id: 'filesystem.delete-directory', name: 'Delete Directory', description: 'Delete a directory inside the selected workspace.', category: 'filesystem', icon: '🧹', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, recursive: { type: 'boolean' } } }, enabled: true },
  { id: 'filesystem.list-directory', name: 'List Directory', description: 'List direct child files and directories under a workspace-relative directory.', category: 'filesystem', icon: '📂', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, enabled: true },
  { id: 'filesystem.find', name: 'Find Files', description: 'Recursively find file or directory names using a regular expression.', category: 'filesystem', icon: '🔎', inputSchema: { type: 'object', required: ['pattern'], properties: { path: { type: 'string' }, pattern: { type: 'string' } } }, enabled: true },
  { id: 'filesystem.search', name: 'Search Files', description: 'Search files using composable name/content conditions.', category: 'filesystem', icon: '🔍', inputSchema: { type: 'object', required: ['condition'], properties: { path: { type: 'string' }, condition: { type: 'object' } } }, enabled: true },
  { id: 'git.status', name: 'Git Status', description: 'Read git working tree status.', category: 'git', icon: '🌿', inputSchema: { type: 'object', properties: {} }, enabled: true },
  { id: 'git.run', name: 'Git Command', description: 'Run git in the selected workspace. Pass only arguments after git.', category: 'git', icon: '🌿', inputSchema: { type: 'object', required: ['args'], properties: { args: { type: 'array', items: { type: 'string' } } } }, enabled: true },
  { id: 'web.fetch-url', name: 'Fetch URL', description: 'Fetch and extract clean page content with the TinyFish Fetch API. Requires a saved TinyFish API key.', category: 'web', icon: '🌐', requiresApiKey: true, hasApiKey: false, inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, format: { type: 'string' }, links: { type: 'boolean' }, imageLinks: { type: 'boolean' }, ttl: { type: 'number' }, perUrlTimeoutMs: { type: 'number' } } }, enabled: false },
  { id: 'web.search', name: 'Web Search', description: 'Search the web with TinyFish Search API. Requires a saved TinyFish API key.', category: 'web', icon: '🌐', requiresApiKey: true, hasApiKey: false, inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }, enabled: false },
  { id: 'roles.list', name: 'List Roles', description: 'List all user-defined roles with their id, name, description, full prompt, and default tools.', category: 'agent', icon: '🎭', inputSchema: { type: 'object', properties: {} }, enabled: true },
  { id: 'roles.find', name: 'Find Roles', description: 'Fuzzy search user-defined roles by id, name, description, prompt text, or default tool IDs.', category: 'agent', icon: '🎭', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'number' } } }, enabled: true },
  { id: 'roles.create', name: 'Create Role', description: 'Create a user-defined role with a name, description, full prompt, and default tools.', category: 'agent', icon: '🎭', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, systemPrompt: { type: 'string' }, defaultToolIds: { type: 'array', items: { type: 'string' } } } }, enabled: true },
  { id: 'roles.update', name: 'Update Role', description: 'Update an existing user-defined role. This tool cannot delete roles.', category: 'agent', icon: '🎭', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, systemPrompt: { type: 'string' }, defaultToolIds: { type: 'array', items: { type: 'string' } } } }, enabled: true },
  { id: 'time.current', name: 'Current Time', description: 'Get the current date, time, timezone, and UTC offset for this desktop runtime.', category: 'system', icon: '🕒', inputSchema: { type: 'object', properties: {} }, enabled: true },
  { id: 'time.sleep', name: 'Sleep', description: 'Pause the Agent for a specified number of seconds before continuing.', category: 'system', icon: '💤', inputSchema: { type: 'object', required: ['seconds'], properties: { seconds: { type: 'number' } } }, enabled: true },
  { id: 'time.wait-until', name: 'Wait Until Time', description: 'Pause the Agent until a specific wake-up time, then return success.', category: 'system', icon: '⏰', inputSchema: { type: 'object', required: ['wakeAt'], properties: { wakeAt: { type: 'string' } } }, enabled: true },
  { id: 'system.execute-command', name: 'Execute Command', description: 'Execute one complete shell command from the selected workspace.', category: 'system', icon: '🖥️', inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } }, enabled: true },
  { id: 'system.show-notification', name: 'Show Notification', description: 'Show a desktop notification.', category: 'system', icon: '🔔', inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, enabled: true }
]

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
  let tools: ToolDto[] = fallbackBuiltinTools.map((tool) => ({ ...tool }))
  let roles: ManagedRoleDto[] = []
  const messagesBySession: Record<string, MessageDto[]> = {}
  const runsBySession: Record<string, AgentRunDto[]> = {}
  const stepsByRun: Record<string, RunStepDto[]> = {}
  const replaceSession = (id: string, updater: (session: SessionDto) => SessionDto): SessionDto => {
    const existing = sessions.find((session) => session.id === id) ?? createMockSession({ title: 'New chat' }, id)
    const updated = updater(existing)
    sessions = [updated, ...sessions.filter((session) => session.id !== id)]
    return updated
  }
  const cloneRole = (role: ManagedRoleDto): ManagedRoleDto => ({ ...role, defaultToolIds: [...role.defaultToolIds] })
  const normalizeRoleName = (name: string): string => {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error('Role name is required')
    }
    return trimmed
  }
  const normalizeRoleText = (value: string | undefined): string => value?.trim() ?? ''
  const validateRoleToolIds = (toolIds: string[] | undefined): string[] => {
    const ids = toolIds ?? []
    for (const id of ids) {
      if (!tools.some((tool) => tool.id === id)) {
        throw new Error(`Unknown tool id: ${id}`)
      }
    }
    return [...ids]
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
      setOutputMode: async (input: SetSessionOutputModeInput) => replaceSession(input.id, (session) => updateMockSession(session, { outputMode: input.outputMode })),
      markViewed: async (id: string) => replaceSession(id, (session) => {
        const { unreadCompletedAt: _unreadCompletedAt, ...viewed } = session
        return viewed
      })
    },
    conversation: {
      listMessages: async (sessionId: string) => messagesBySession[sessionId] ?? [],
      listMessagesByRun: async (input: { sessionId: string; runId: string }) => Object.values(messagesBySession).flat().filter((message) => message.runId === input.runId),
      listRuns: async (sessionId: string) => runsBySession[sessionId] ?? [],
      listSteps: async (runId: string) => stepsByRun[runId] ?? []
    },
    workerAgents: {
      listByParentRun: async (_input: { sessionId: string; parentRunId: string }) => [] as WorkerAgentInvocationDto[]
    },
    agent: {
      enqueue: async (_input: AgentEnqueueInput) => ({ runId: `run-fallback-${nextRunNumber++}` }),
      stop: async (_runId: string) => undefined,
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
        themeMode: input.themeMode ?? defaultSettings.themeMode,
        fontSize: input.fontSize ?? defaultSettings.fontSize
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
      },
      startOAuthAuthorization: async () => {
        throw new Error('Codex OAuth is only available in the desktop shell')
      },
      getOAuthAuthorizationStatus: async (input) => ({
        provider: 'openai-codex',
        sessionId: input.sessionId,
        status: 'failed',
        message: 'Codex OAuth is only available in the desktop shell'
      }),
      saveOAuthConnection: async () => {
        throw new Error('Codex OAuth is only available in the desktop shell')
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
    tools: {
      list: async () => tools.map((tool) => ({ ...tool })),
      setEnabled: async (input: SetToolEnabledInput): Promise<ToolDto> => {
        const existing = tools.find((tool) => tool.id === input.id)
        if (!existing) {
          throw new Error(`Unknown builtin tool: ${input.id}`)
        }
        if (existing.requiresApiKey && !existing.hasApiKey && input.enabled) {
          throw new Error(`API key is required before enabling tool: ${input.id}`)
        }
        const updated = { ...existing, enabled: input.enabled }
        tools = tools.map((tool) => tool.id === input.id ? updated : tool)
        return { ...updated }
      },
      credentialStatus: async (input) => {
        const tool = tools.find((candidate) => candidate.id === input.toolId)
        return {
          toolId: input.toolId,
          apiKeyRef: `tool:${input.toolId}:api-key`,
          hasApiKey: tool?.hasApiKey === true,
          encryptionAvailable: false,
          warning: 'Secure credential storage is unavailable in renderer fallback mode.'
        }
      },
      saveApiKey: async (input) => {
        tools = tools.map((tool) => tool.id === input.toolId ? { ...tool, hasApiKey: true, enabled: true } : tool)
        return {
          toolId: input.toolId,
          apiKeyRef: `tool:${input.toolId}:api-key`,
          hasApiKey: true,
          encryptionAvailable: false,
          warning: 'Secure credential storage is unavailable in renderer fallback mode.'
        }
      },
      deleteApiKey: async (input) => {
        tools = tools.map((tool) => tool.id === input.toolId ? { ...tool, hasApiKey: false, enabled: false } : tool)
        return {
          toolId: input.toolId,
          apiKeyRef: `tool:${input.toolId}:api-key`,
          hasApiKey: false,
          encryptionAvailable: false,
          warning: 'Secure credential storage is unavailable in renderer fallback mode.'
        }
      }
    },
    roles: {
      list: async () => roles.map(cloneRole),
      create: async (input) => {
        const role: ManagedRoleDto = {
          id: createId('role'),
          name: normalizeRoleName(input.name),
          description: normalizeRoleText(input.description),
          systemPrompt: normalizeRoleText(input.systemPrompt),
          defaultToolIds: validateRoleToolIds(input.defaultToolIds)
        }
        roles = [...roles, role]
        return cloneRole(role)
      },
      update: async (input) => {
        const existing = roles.find((role) => role.id === input.id)
        if (!existing) {
          throw new Error(`Role not found: ${input.id}`)
        }
        const updated: ManagedRoleDto = {
          ...existing,
          ...(input.name !== undefined ? { name: normalizeRoleName(input.name) } : {}),
          ...(input.description !== undefined ? { description: normalizeRoleText(input.description) } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: normalizeRoleText(input.systemPrompt) } : {}),
          ...(input.defaultToolIds !== undefined ? { defaultToolIds: validateRoleToolIds(input.defaultToolIds) } : {})
        }
        roles = roles.map((role) => role.id === updated.id ? updated : role)
        return cloneRole(updated)
      },
      delete: async (id) => {
        const existing = roles.find((role) => role.id === id)
        if (!existing) {
          throw new Error(`Role not found: ${id}`)
        }
        roles = roles.filter((role) => role.id !== id)
        return { deleted: true as const, id }
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
