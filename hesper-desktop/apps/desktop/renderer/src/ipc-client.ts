import type {
  AgentEnqueueInput,
  AgentRunDto,
  AppSettings,
  CreateSessionInput,
  CreateSshKeyInput,
  CreateSshServerInput,
  DirectorySelectionResult,
  HesperDesktopApi,
  MessageDto,
  GenerateSessionTitleInput,
  ManagedRoleDto,
  ModelDto,
  ModelProviderDto,
  RunStepDto,
  SessionDto,
  SkillDto,
  SshKeyDto,
  SshServerDto,
  WorkerAgentInvocationDto,
  SetSessionModelInput,
  SetSessionOutputModeInput,
  SetSessionWorkspaceInput,
  SetToolEnabledInput,
  ToolDto,
  UpdateSessionTitleInput,
  UpdateSettingsInput,
  UpdateSshServerInput
} from '../../electron/ipc-contract'
import { createId } from '@hesper/shared'

const defaultSettings: AppSettings = {
  defaultModelId: 'mock/hesper-fast',
  defaultOutputMode: 'markdown',
  themeMode: 'dark',
  themeId: 'catppuccin',
  fontSize: 14,
  soul: ''
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
  { id: 'roles.create', name: 'Create Role', description: 'Create a user-defined role with a name, description, full prompt, and default tools.', category: 'agent', icon: '🎭', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, systemPrompt: { type: 'string' }, defaultToolIds: { type: 'array', items: { type: 'string' } }, defaultModelId: { type: 'string', description: 'Default model id for this role. Empty string means inherit the caller/parent model.' }, defaultModelRef: { type: 'object', required: ['providerId', 'modelId'], description: 'Provider-aware model reference. Only used with a non-empty defaultModelId whose value matches defaultModelRef.modelId.', properties: { providerId: { type: 'string' }, modelId: { type: 'string' } } } } }, enabled: true },
  { id: 'roles.update', name: 'Update Role', description: 'Update an existing user-defined role. This tool cannot delete roles.', category: 'agent', icon: '🎭', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, systemPrompt: { type: 'string' }, defaultToolIds: { type: 'array', items: { type: 'string' }, }, defaultModelId: { type: 'string', description: 'Default model id for this role. Empty string means inherit the caller/parent model.' }, defaultModelRef: { type: 'object', required: ['providerId', 'modelId'], description: 'Provider-aware model reference. Only used with a non-empty defaultModelId whose value matches defaultModelRef.modelId.', properties: { providerId: { type: 'string' }, modelId: { type: 'string' } } } } }, enabled: true },
  { id: 'soul.get', name: 'Get SOUL', description: 'Get the current saved SOUL text for this desktop runtime.', category: 'agent', icon: '🪶', inputSchema: { type: 'object', properties: {} }, enabled: true },
  { id: 'soul.update', name: 'Update SOUL', description: 'Update the saved SOUL text for this desktop runtime. Provide soul: "" to clear it.', category: 'agent', icon: '🪶', inputSchema: { type: 'object', required: ['soul'], properties: { soul: { type: 'string' } } }, enabled: true },
  { id: 'ssh.list-servers', name: 'List SSH Servers', description: 'List SSH servers configured for agent use. Sensitive connection details such as hostnames, usernames, and credentials are not returned.', category: 'system', icon: '🔐', inputSchema: { type: 'object', properties: {} }, enabled: true },
  { id: 'ssh.run-commands', name: 'Run SSH Commands', description: 'Run one or more shell commands on a configured SSH server using stored credentials. Commands run sequentially and may stop after the first failure.', category: 'system', icon: '🔐', inputSchema: { type: 'object', required: ['serverId', 'commands'], properties: { serverId: { type: 'string', description: 'SSH server id returned by ssh.list-servers.' }, commands: { type: 'array', items: { type: 'string' }, description: 'Shell commands to run sequentially on the selected SSH server.' }, stopOnError: { type: 'boolean', description: 'When true, skip remaining commands after the first failed command. Defaults to true.' }, timeoutMs: { type: 'number', description: 'Whole execution timeout in milliseconds. Defaults to 0, which means no timeout.' }, wait: { type: 'boolean', description: 'When true, wait for command execution to finish before returning. Defaults to true.' } } }, enabled: true },
  { id: 'ssh.list-executions', name: 'List SSH Executions', description: 'List SSH command executions for the current session, optionally filtered by status.', category: 'system', icon: '🔐', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Optional execution status filter: queued, running, succeeded, failed, or cancelled.' } } }, enabled: true },
  { id: 'ssh.get-execution-output', name: 'Get SSH Execution Output', description: 'Get stdout, stderr, status, and result metadata for a previous SSH command execution in the current session.', category: 'system', icon: '🔐', inputSchema: { type: 'object', required: ['executionId'], properties: { executionId: { type: 'string', description: 'SSH execution id returned by ssh.run-commands or ssh.list-executions.' } } }, enabled: true },
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
  const skills: SkillDto[] = [
    { id: 'Install Skills', name: 'Install Skills', description: 'Install reusable skills into the user skill directory.', source: 'builtin' },
    { id: 'Notes', name: 'Notes', source: 'builtin' },
    { id: 'Workspace Notes', name: 'Workspace Notes', source: 'workspace' },
    { id: 'Project Notes', name: 'Project Notes', source: 'project' }
  ]
  let roles: ManagedRoleDto[] = []
  let sshKeys: SshKeyDto[] = []
  let sshServers: SshServerDto[] = []
  const messagesBySession: Record<string, MessageDto[]> = {}
  const runsBySession: Record<string, AgentRunDto[]> = {}
  const stepsByRun: Record<string, RunStepDto[]> = {}
  const replaceSession = (id: string, updater: (session: SessionDto) => SessionDto): SessionDto => {
    const existing = sessions.find((session) => session.id === id) ?? createMockSession({ title: 'New chat' }, id)
    const updated = updater(existing)
    sessions = [updated, ...sessions.filter((session) => session.id !== id)]
    return updated
  }
  const cloneModelRef = (modelRef: ManagedRoleDto['defaultModelRef']): ManagedRoleDto['defaultModelRef'] => modelRef ? { ...modelRef } : undefined
  const cloneRole = (role: ManagedRoleDto): ManagedRoleDto => ({
    ...role,
    defaultToolIds: [...role.defaultToolIds],
    defaultModelId: role.defaultModelId ?? role.defaultModelRef?.modelId ?? '',
    ...(role.defaultModelRef ? { defaultModelRef: cloneModelRef(role.defaultModelRef) } : {})
  })
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
  const cloneSshKey = (key: SshKeyDto): SshKeyDto => ({ ...key })
  const cloneSshServer = (server: SshServerDto): SshServerDto => ({ ...server })
  const normalizeSshText = (value: string | undefined, field: string): string => {
    const trimmed = value?.trim() ?? ''
    if (!trimmed) {
      throw new Error(`SSH ${field} is required`)
    }
    return trimmed
  }
  const normalizeSshNote = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim() ?? ''
    return trimmed || undefined
  }
  const normalizeSshPort = (value: number): number => {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error('SSH port must be between 1 and 65535')
    }
    return value
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
    files: {
      preview: async (_input) => {
        throw new Error('本地文件预览在 renderer fallback 模式不可用')
      }
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
        themeId: input.themeId ?? defaultSettings.themeId,
        fontSize: input.fontSize ?? defaultSettings.fontSize,
        soul: input.soul ?? defaultSettings.soul
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
      cancelOAuthAuthorization: async (input) => ({ cancelled: true as const, sessionId: input.sessionId }),
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
    skills: {
      list: async () => skills.map((skill) => ({ ...skill })),
      get: async (id: string) => {
        const skill = skills.find((candidate) => candidate.id === id)
        return skill ? { ...skill } : undefined
      },
      refresh: async () => skills.map((skill) => ({ ...skill }))
    },
    sshKeys: {
      list: async () => sshKeys.map(cloneSshKey),
      create: async (input: CreateSshKeyInput): Promise<SshKeyDto> => {
        normalizeSshText(input.publicKey, 'publicKey')
        normalizeSshText(input.privateKey, 'privateKey')
        const timestamp = new Date().toISOString()
        const key = withDefined({
          id: `ssh-key-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
          name: normalizeSshText(input.name, 'name'),
          publicKey: normalizeSshText(input.publicKey, 'publicKey'),
          note: normalizeSshNote(input.note),
          hasPassphrase: Boolean(input.passphrase?.trim()),
          createdAt: timestamp,
          updatedAt: timestamp
        }) as SshKeyDto
        sshKeys = [key, ...sshKeys]
        return cloneSshKey(key)
      },
      delete: async (id: string) => {
        const serverCount = sshServers.filter((server) => server.keyId === id).length
        if (serverCount > 0) {
          throw new Error(`SSH key is used by ${serverCount} server(s)`)
        }
        sshKeys = sshKeys.filter((key) => key.id !== id)
        return { deleted: true as const, id }
      }
    },
    sshServers: {
      list: async () => sshServers.map(cloneSshServer),
      create: async (input: CreateSshServerInput): Promise<SshServerDto> => {
        if (!sshKeys.some((key) => key.id === input.keyId)) {
          throw new Error('SSH key not found')
        }
        const timestamp = new Date().toISOString()
        const server = withDefined({
          id: `ssh-server-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
          name: normalizeSshText(input.name, 'name'),
          host: normalizeSshText(input.host, 'host'),
          port: normalizeSshPort(input.port),
          username: normalizeSshText(input.username, 'username'),
          keyId: input.keyId,
          note: normalizeSshNote(input.note),
          createdAt: timestamp,
          updatedAt: timestamp
        }) as SshServerDto
        sshServers = [server, ...sshServers]
        return cloneSshServer(server)
      },
      update: async (input: UpdateSshServerInput): Promise<SshServerDto> => {
        const existing = sshServers.find((server) => server.id === input.id)
        if (!existing) {
          throw new Error(`SSH server not found: ${input.id}`)
        }
        const keyId = input.keyId ?? existing.keyId
        if (!sshKeys.some((key) => key.id === keyId)) {
          throw new Error('SSH key not found')
        }
        const updated = withDefined({
          ...existing,
          ...(input.name !== undefined ? { name: normalizeSshText(input.name, 'name') } : {}),
          ...(input.host !== undefined ? { host: normalizeSshText(input.host, 'host') } : {}),
          ...(input.port !== undefined ? { port: normalizeSshPort(input.port) } : {}),
          ...(input.username !== undefined ? { username: normalizeSshText(input.username, 'username') } : {}),
          keyId,
          ...(Object.prototype.hasOwnProperty.call(input, 'note') ? { note: normalizeSshNote(input.note) } : {}),
          updatedAt: new Date().toISOString()
        }) as SshServerDto
        sshServers = sshServers.map((server) => server.id === updated.id ? updated : server)
        return cloneSshServer(updated)
      },
      delete: async (id: string) => {
        sshServers = sshServers.filter((server) => server.id !== id)
        return { deleted: true as const, id }
      }
    },
    roles: {
      list: async () => roles.map(cloneRole),
      create: async (input) => {
        const defaultModelId = input.defaultModelId?.trim() ?? ''
        const role: ManagedRoleDto = {
          id: createId('role'),
          name: normalizeRoleName(input.name),
          description: normalizeRoleText(input.description),
          systemPrompt: normalizeRoleText(input.systemPrompt),
          defaultToolIds: validateRoleToolIds(input.defaultToolIds),
          defaultModelId,
          ...(defaultModelId && input.defaultModelRef ? { defaultModelRef: cloneModelRef(input.defaultModelRef) } : {})
        }
        roles = [...roles, role]
        return cloneRole(role)
      },
      update: async (input) => {
        const existing = roles.find((role) => role.id === input.id)
        if (!existing) {
          throw new Error(`Role not found: ${input.id}`)
        }

        const defaultModelId = input.defaultModelId?.trim()
        const currentDefaultModelId = existing.defaultModelId ?? existing.defaultModelRef?.modelId ?? ''
        const updated: ManagedRoleDto = {
          ...existing,
          ...(input.name !== undefined ? { name: normalizeRoleName(input.name) } : {}),
          ...(input.description !== undefined ? { description: normalizeRoleText(input.description) } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: normalizeRoleText(input.systemPrompt) } : {}),
          ...(input.defaultToolIds !== undefined ? { defaultToolIds: validateRoleToolIds(input.defaultToolIds) } : {})
        }

        if (defaultModelId === '') {
          updated.defaultModelId = ''
          delete updated.defaultModelRef
        } else if (defaultModelId !== undefined) {
          updated.defaultModelId = defaultModelId
          if (input.defaultModelRef !== undefined) {
            updated.defaultModelRef = cloneModelRef(input.defaultModelRef)
          } else if (currentDefaultModelId !== defaultModelId && updated.defaultModelRef !== undefined) {
            delete updated.defaultModelRef
          }
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
