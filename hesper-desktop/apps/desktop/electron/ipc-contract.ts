import { agentRunSchema, agentRuntimeEventSchema, messageSchema, modelConfigSchema, modelProviderConfigSchema, runStepSchema, sessionSchema, toolDefinitionBaseSchema, workerAgentInvocationSchema } from '@hesper/shared'
import { z } from 'zod'

export const ipcChannels = {
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsUpdateTitle: 'sessions:updateTitle',
  sessionsGenerateTitle: 'sessions:generateTitle',
  sessionsArchive: 'sessions:archive',
  sessionsDelete: 'sessions:delete',
  sessionsSetWorkspace: 'sessions:setWorkspace',
  sessionsSetModel: 'sessions:setModel',
  sessionsSetOutputMode: 'sessions:setOutputMode',
  sessionsMarkViewed: 'sessions:markViewed',
  conversationListMessages: 'conversation:listMessages',
  conversationListMessagesByRun: 'conversation:listMessagesByRun',
  conversationListRuns: 'conversation:listRuns',
  conversationListSteps: 'conversation:listSteps',
  workerInvocationsListByParentRun: 'workerInvocations:listByParentRun',
  dialogSelectDirectory: 'dialog:selectDirectory',
  agentEnqueue: 'agent:enqueue',
  agentStop: 'agent:stop',
  agentEventsSubscribe: 'agent:events:subscribe',
  agentEventsUnsubscribe: 'agent:events:unsubscribe',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  credentialsProviderStatus: 'credentials:providerStatus',
  credentialsSaveProviderApiKey: 'credentials:saveProviderApiKey',
  credentialsDeleteProviderApiKey: 'credentials:deleteProviderApiKey',
  providersList: 'providers:list',
  providersSave: 'providers:save',
  providersDisable: 'providers:disable',
  providersDelete: 'providers:delete',
  providersTestConnection: 'providers:testConnection',
  providersStartOAuthAuthorization: 'providers:startOAuthAuthorization',
  providersGetOAuthAuthorizationStatus: 'providers:getOAuthAuthorizationStatus',
  providersCancelOAuthAuthorization: 'providers:cancelOAuthAuthorization',
  providersSaveOAuthConnection: 'providers:saveOAuthConnection',
  modelsList: 'models:list',
  modelsSave: 'models:save',
  toolsList: 'tools:list',
  toolsSetEnabled: 'tools:setEnabled',
  toolsCredentialStatus: 'tools:credentialStatus',
  toolsSaveApiKey: 'tools:saveApiKey',
  toolsDeleteApiKey: 'tools:deleteApiKey',
  rolesList: 'roles:list',
  rolesCreate: 'roles:create',
  rolesUpdate: 'roles:update',
  rolesDelete: 'roles:delete',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close'
} as const

export const ipcEvents = {
  agentEvent: 'agent:event'
} as const

export const createSessionInputSchema = z.object({
  title: z.string().optional(),
  workspacePath: z.string().optional(),
  defaultModelId: z.string().optional(),
  outputMode: z.enum(['markdown', 'html']).optional()
})

export const nonEmptyStringSchema = z.string().min(1)

export const updateSessionTitleInputSchema = z.object({
  id: nonEmptyStringSchema,
  title: z.string()
})

export const generateSessionTitleInputSchema = z.object({
  id: nonEmptyStringSchema,
  modelId: nonEmptyStringSchema,
  userPrompt: nonEmptyStringSchema,
  assistantOutput: z.string().optional()
})

export const sessionIdInputSchema = nonEmptyStringSchema
export const runIdInputSchema = nonEmptyStringSchema
export const conversationMessagesByRunInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema
}).strict()
export const workerInvocationsListByParentRunInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  parentRunId: nonEmptyStringSchema
}).strict()
export const conversationMessagesResultSchema = z.array(messageSchema)
export const conversationMessagesByRunResultSchema = z.array(messageSchema)
export const conversationRunsResultSchema = z.array(agentRunSchema)
export const conversationStepsResultSchema = z.array(runStepSchema)
export const workerInvocationsResultSchema = z.array(workerAgentInvocationSchema)

export const setSessionWorkspaceInputSchema = z.object({
  id: nonEmptyStringSchema,
  workspacePath: z.string().optional()
})

export const setSessionModelInputSchema = z.object({
  id: nonEmptyStringSchema,
  defaultModelId: z.string().optional()
})

export const setSessionOutputModeInputSchema = z.object({
  id: nonEmptyStringSchema,
  outputMode: z.enum(['markdown', 'html'])
})

export const agentEnqueueInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  prompt: nonEmptyStringSchema,
  modelId: nonEmptyStringSchema,
  workspacePath: z.string().optional(),
  enabledToolIds: z.array(nonEmptyStringSchema).optional(),
  parentRunId: nonEmptyStringSchema.optional(),
  messageId: nonEmptyStringSchema.optional(),
  messageCreatedAt: z.string().datetime().optional()
})

export const appFontSizeSchema = z.number().int().min(12).max(18)

export const appSettingsSchema = z.object({
  defaultModelId: z.string().min(1),
  defaultOutputMode: z.enum(['markdown', 'html']),
  themeMode: z.enum(['system', 'light', 'dark']),
  fontSize: appFontSizeSchema
}).strict()

export const updateSettingsInputSchema = z.object({
  defaultModelId: z.string().min(1).optional(),
  defaultOutputMode: z.enum(['markdown', 'html']).optional(),
  themeMode: z.enum(['system', 'light', 'dark']).optional(),
  fontSize: appFontSizeSchema.optional()
}).strict()

export const managedRoleDtoSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: z.string(),
  systemPrompt: z.string(),
  defaultToolIds: z.array(nonEmptyStringSchema)
}).strict()

export const createRoleInputSchema = z.object({
  name: nonEmptyStringSchema,
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultToolIds: z.array(nonEmptyStringSchema).optional()
}).strict()

export const updateRoleInputSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema.optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultToolIds: z.array(nonEmptyStringSchema).optional()
}).strict()

export const directorySelectionSchema = z.object({
  canceled: z.boolean(),
  path: z.string().optional()
})

export const providerCredentialInputSchema = z.object({
  providerId: nonEmptyStringSchema
}).strict()

export const saveProviderApiKeyInputSchema = z.object({
  providerId: nonEmptyStringSchema,
  apiKey: z.string().min(1)
}).strict()

export const providerCredentialStatusSchema = z.object({
  providerId: nonEmptyStringSchema,
  apiKeyRef: nonEmptyStringSchema,
  hasApiKey: z.boolean(),
  encryptionAvailable: z.boolean(),
  warning: z.string().optional(),
  updatedAt: z.string().datetime().optional()
}).strict()

export const piAuthProviderSchema = z.enum(['openai-codex'])
export const providerOAuthStatusSchema = z.enum(['pending', 'authorized', 'failed'])

export const saveModelProviderInputSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: z.enum(['mock', 'openai', 'deepseek', 'openai-compatible', 'anthropic', 'custom', 'pi']),
  authType: z.enum(['api_key', 'oauth', 'none']).optional(),
  piAuthProvider: piAuthProviderSchema.optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  defaultModelId: z.string().min(1).optional()
}).strict().superRefine((provider, ctx) => {
  if (provider.piAuthProvider && provider.kind !== 'pi') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['piAuthProvider'], message: 'piAuthProvider requires kind pi' })
  }
  if (provider.authType === 'oauth' && provider.piAuthProvider !== 'openai-codex') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['piAuthProvider'], message: 'Codex OAuth requires openai-codex' })
  }
  if (provider.piAuthProvider && provider.authType !== 'oauth') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['authType'], message: 'piAuthProvider requires oauth authType' })
  }
})

export const providerIdInputSchema = z.object({
  providerId: nonEmptyStringSchema
}).strict()

export const providerConnectionTestInputSchema = z.object({
  providerId: nonEmptyStringSchema.optional(),
  kind: z.enum(['mock', 'openai', 'deepseek', 'openai-compatible', 'anthropic', 'custom', 'pi']).optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  modelId: z.string().optional()
}).strict().refine((input) => input.providerId !== undefined || input.kind !== undefined, {
  message: 'providerId or kind is required'
})

export const providerOAuthStartInputSchema = z.object({
  provider: piAuthProviderSchema,
  connectionName: nonEmptyStringSchema
}).strict()

export const providerOAuthStartResultSchema = z.object({
  provider: piAuthProviderSchema,
  sessionId: nonEmptyStringSchema,
  authorizationUrl: z.string().url(),
  status: providerOAuthStatusSchema,
  message: z.string().min(1)
}).strict()

export const providerOAuthStatusInputSchema = z.object({
  sessionId: nonEmptyStringSchema
}).strict()

export const providerOAuthStatusResultSchema = z.object({
  provider: piAuthProviderSchema,
  sessionId: nonEmptyStringSchema,
  status: providerOAuthStatusSchema,
  message: z.string().min(1)
}).strict()

export const providerOAuthCancelInputSchema = z.object({
  sessionId: nonEmptyStringSchema
}).strict()

export const providerOAuthCancelResultSchema = z.object({
  cancelled: z.literal(true),
  sessionId: nonEmptyStringSchema
}).strict()

export const providerOAuthSaveInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  connectionName: nonEmptyStringSchema
}).strict()

export const listModelsInputSchema = z.object({
  providerId: nonEmptyStringSchema.optional()
}).strict()

export const saveModelInputSchema = z.object({
  id: nonEmptyStringSchema,
  providerId: nonEmptyStringSchema,
  modelName: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema,
  capabilities: z.array(z.enum(['streaming', 'toolCalls', 'jsonOutput', 'reasoning'])).optional(),
  contextWindow: z.number().int().positive().optional(),
  enabled: z.boolean().optional()
}).strict()

export const toolDtoSchema = toolDefinitionBaseSchema.extend({
  enabled: z.boolean(),
  hasApiKey: z.boolean().optional()
}).transform((value) => ({
  id: value.id,
  name: value.name,
  description: value.description,
  inputSchema: value.inputSchema,
  category: value.category,
  enabled: value.enabled,
  ...(value.icon !== undefined ? { icon: value.icon } : {}),
  ...(value.requiresApiKey !== undefined ? { requiresApiKey: value.requiresApiKey } : {}),
  ...(value.hasApiKey !== undefined ? { hasApiKey: value.hasApiKey } : {})
}))

export const setToolEnabledInputSchema = z.object({
  id: nonEmptyStringSchema,
  enabled: z.boolean()
}).strict()

export const toolCredentialInputSchema = z.object({
  toolId: nonEmptyStringSchema
}).strict()

export const saveToolApiKeyInputSchema = z.object({
  toolId: nonEmptyStringSchema,
  apiKey: z.string().min(1)
}).strict()

export const toolCredentialStatusSchema = z.object({
  toolId: nonEmptyStringSchema,
  apiKeyRef: nonEmptyStringSchema,
  hasApiKey: z.boolean(),
  encryptionAvailable: z.boolean(),
  warning: z.string().optional(),
  updatedAt: z.string().datetime().optional()
}).strict()

export const providerConnectionTestResultSchema = z.object({
  providerId: nonEmptyStringSchema,
  status: z.enum(['ok', 'disabled', 'needs_api_key', 'not_found', 'failed']),
  hasApiKey: z.boolean(),
  message: z.string().min(1)
}).strict()

export const subscribeAgentEventsResultSchema = z.object({
  subscribed: z.literal(true)
})

export const unsubscribeAgentEventsResultSchema = z.object({
  unsubscribed: z.literal(true)
})

export const agentStopResultSchema = agentRunSchema.optional()

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>
export type UpdateSessionTitleInput = z.infer<typeof updateSessionTitleInputSchema>
export type GenerateSessionTitleInput = z.infer<typeof generateSessionTitleInputSchema>
export type SetSessionWorkspaceInput = z.infer<typeof setSessionWorkspaceInputSchema>
export type SetSessionModelInput = z.infer<typeof setSessionModelInputSchema>
export type SetSessionOutputModeInput = z.infer<typeof setSessionOutputModeInputSchema>
export type AgentEnqueueInput = z.infer<typeof agentEnqueueInputSchema>
export type AgentStopResult = z.infer<typeof agentStopResultSchema>
export type AppSettings = z.infer<typeof appSettingsSchema>
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>
export type ManagedRoleDto = z.infer<typeof managedRoleDtoSchema>
export type CreateRoleInput = z.infer<typeof createRoleInputSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>
export type DirectorySelectionResult = z.infer<typeof directorySelectionSchema>
export type ProviderCredentialInput = z.infer<typeof providerCredentialInputSchema>
export type SaveProviderApiKeyInput = z.infer<typeof saveProviderApiKeyInputSchema>
export type ProviderCredentialStatus = z.infer<typeof providerCredentialStatusSchema>
export type SaveModelProviderInput = z.infer<typeof saveModelProviderInputSchema>
export type ProviderIdInput = z.infer<typeof providerIdInputSchema>
export type ProviderConnectionTestInput = z.infer<typeof providerConnectionTestInputSchema>
export type PiAuthProvider = z.infer<typeof piAuthProviderSchema>
export type ProviderOAuthStatus = z.infer<typeof providerOAuthStatusSchema>
export type ProviderOAuthStartInput = z.infer<typeof providerOAuthStartInputSchema>
export type ProviderOAuthStartResult = z.infer<typeof providerOAuthStartResultSchema>
export type ProviderOAuthStatusInput = z.infer<typeof providerOAuthStatusInputSchema>
export type ProviderOAuthStatusResult = z.infer<typeof providerOAuthStatusResultSchema>
export type ProviderOAuthCancelInput = z.infer<typeof providerOAuthCancelInputSchema>
export type ProviderOAuthCancelResult = z.infer<typeof providerOAuthCancelResultSchema>
export type ProviderOAuthSaveInput = z.infer<typeof providerOAuthSaveInputSchema>
export type ListModelsInput = z.infer<typeof listModelsInputSchema>
export type SaveModelInput = z.infer<typeof saveModelInputSchema>
export type ToolDto = z.infer<typeof toolDtoSchema>
export type SetToolEnabledInput = z.infer<typeof setToolEnabledInputSchema>
export type ToolCredentialInput = z.infer<typeof toolCredentialInputSchema>
export type SaveToolApiKeyInput = z.infer<typeof saveToolApiKeyInputSchema>
export type ToolCredentialStatus = z.infer<typeof toolCredentialStatusSchema>
export type ProviderConnectionTestResult = z.infer<typeof providerConnectionTestResultSchema>
export type AgentEvent = z.infer<typeof agentRuntimeEventSchema>
export type SessionDto = z.infer<typeof sessionSchema>
export type MessageDto = z.infer<typeof messageSchema>
export type AgentRunDto = z.infer<typeof agentRunSchema>
export type RunStepDto = z.infer<typeof runStepSchema>
export type WorkerAgentInvocationDto = z.infer<typeof workerAgentInvocationSchema>
export type ConversationMessagesByRunInput = z.infer<typeof conversationMessagesByRunInputSchema>
export type WorkerInvocationsListByParentRunInput = z.infer<typeof workerInvocationsListByParentRunInputSchema>
export type ModelProviderDto = z.infer<typeof modelProviderConfigSchema>
export type ModelDto = z.infer<typeof modelConfigSchema>

export type HesperDesktopApi = {
  sessions: {
    list(): Promise<SessionDto[]>
    create(input: CreateSessionInput): Promise<SessionDto>
    updateTitle(input: UpdateSessionTitleInput): Promise<SessionDto>
    generateTitle(input: GenerateSessionTitleInput): Promise<SessionDto>
    archive(id: string): Promise<SessionDto>
    delete(id: string): Promise<SessionDto>
    setWorkspace(input: SetSessionWorkspaceInput): Promise<SessionDto>
    setModel(input: SetSessionModelInput): Promise<SessionDto>
    setOutputMode(input: SetSessionOutputModeInput): Promise<SessionDto>
    markViewed(id: string): Promise<SessionDto>
  }
  conversation: {
    listMessages(sessionId: string): Promise<MessageDto[]>
    listMessagesByRun(input: ConversationMessagesByRunInput): Promise<MessageDto[]>
    listRuns(sessionId: string): Promise<AgentRunDto[]>
    listSteps(runId: string): Promise<RunStepDto[]>
  }
  workerAgents: {
    listByParentRun(input: WorkerInvocationsListByParentRunInput): Promise<WorkerAgentInvocationDto[]>
  }
  agent: {
    enqueue(input: AgentEnqueueInput): Promise<{ runId: string }>
    stop(runId: string): Promise<AgentStopResult>
    subscribe(): Promise<{ subscribed: true }>
    onEvent(listener: (event: AgentEvent) => void): () => void
  }
  dialog: {
    selectDirectory(): Promise<DirectorySelectionResult>
  }
  settings: {
    get(): Promise<AppSettings>
    update(input: UpdateSettingsInput): Promise<AppSettings>
  }
  credentials: {
    providerStatus(input: ProviderCredentialInput): Promise<ProviderCredentialStatus>
    saveProviderApiKey(input: SaveProviderApiKeyInput): Promise<ProviderCredentialStatus>
    deleteProviderApiKey(input: ProviderCredentialInput): Promise<ProviderCredentialStatus>
  }
  providers: {
    list(): Promise<ModelProviderDto[]>
    save(input: SaveModelProviderInput): Promise<ModelProviderDto>
    disable(input: ProviderIdInput): Promise<ModelProviderDto>
    delete(input: ProviderIdInput): Promise<{ deleted: true; providerId: string; provider?: ModelProviderDto }>
    testConnection(input: ProviderConnectionTestInput): Promise<ProviderConnectionTestResult>
    startOAuthAuthorization(input: ProviderOAuthStartInput): Promise<ProviderOAuthStartResult>
    getOAuthAuthorizationStatus(input: ProviderOAuthStatusInput): Promise<ProviderOAuthStatusResult>
    cancelOAuthAuthorization(input: ProviderOAuthCancelInput): Promise<ProviderOAuthCancelResult>
    saveOAuthConnection(input: ProviderOAuthSaveInput): Promise<ModelProviderDto>
  }
  models: {
    list(input?: ListModelsInput): Promise<ModelDto[]>
    save(input: SaveModelInput): Promise<ModelDto>
  }
  tools: {
    list(): Promise<ToolDto[]>
    setEnabled(input: SetToolEnabledInput): Promise<ToolDto>
    credentialStatus(input: ToolCredentialInput): Promise<ToolCredentialStatus>
    saveApiKey(input: SaveToolApiKeyInput): Promise<ToolCredentialStatus>
    deleteApiKey(input: ToolCredentialInput): Promise<ToolCredentialStatus>
  }
  roles: {
    list(): Promise<ManagedRoleDto[]>
    create(input: CreateRoleInput): Promise<ManagedRoleDto>
    update(input: UpdateRoleInput): Promise<ManagedRoleDto>
    delete(id: string): Promise<{ deleted: true; id: string }>
  }
  window: {
    platform: NodeJS.Platform
    minimize(): Promise<{ minimized: true }>
    toggleMaximize(): Promise<{ isMaximized: boolean }>
    close(): Promise<{ closed: true }>
  }
}
