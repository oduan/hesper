import { agentRuntimeEventSchema, modelConfigSchema, modelProviderConfigSchema, sessionSchema } from '@hesper/shared'
import { z } from 'zod'

export const ipcChannels = {
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsUpdateTitle: 'sessions:updateTitle',
  sessionsArchive: 'sessions:archive',
  sessionsDelete: 'sessions:delete',
  sessionsSetWorkspace: 'sessions:setWorkspace',
  sessionsSetModel: 'sessions:setModel',
  sessionsSetOutputMode: 'sessions:setOutputMode',
  dialogSelectDirectory: 'dialog:selectDirectory',
  agentEnqueue: 'agent:enqueue',
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
  providersTestConnection: 'providers:testConnection',
  modelsList: 'models:list',
  modelsSave: 'models:save',
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

export const sessionIdInputSchema = nonEmptyStringSchema

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
  messageId: nonEmptyStringSchema.optional()
})

export const appSettingsSchema = z.object({
  defaultModelId: z.string().min(1),
  defaultOutputMode: z.enum(['markdown', 'html']),
  themeMode: z.enum(['system', 'light', 'dark'])
}).strict()

export const updateSettingsInputSchema = z.object({
  defaultModelId: z.string().min(1).optional(),
  defaultOutputMode: z.enum(['markdown', 'html']).optional(),
  themeMode: z.enum(['system', 'light', 'dark']).optional()
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

export const saveModelProviderInputSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: z.enum(['mock', 'openai', 'deepseek', 'openai-compatible', 'anthropic', 'custom']),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  defaultModelId: z.string().min(1).optional()
}).strict()

export const providerIdInputSchema = z.object({
  providerId: nonEmptyStringSchema
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

export const providerConnectionTestResultSchema = z.object({
  providerId: nonEmptyStringSchema,
  status: z.enum(['ok', 'disabled', 'needs_api_key', 'not_found']),
  hasApiKey: z.boolean(),
  message: z.string().min(1)
}).strict()

export const subscribeAgentEventsResultSchema = z.object({
  subscribed: z.literal(true)
})

export const unsubscribeAgentEventsResultSchema = z.object({
  unsubscribed: z.literal(true)
})

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>
export type UpdateSessionTitleInput = z.infer<typeof updateSessionTitleInputSchema>
export type SetSessionWorkspaceInput = z.infer<typeof setSessionWorkspaceInputSchema>
export type SetSessionModelInput = z.infer<typeof setSessionModelInputSchema>
export type SetSessionOutputModeInput = z.infer<typeof setSessionOutputModeInputSchema>
export type AgentEnqueueInput = z.infer<typeof agentEnqueueInputSchema>
export type AppSettings = z.infer<typeof appSettingsSchema>
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>
export type DirectorySelectionResult = z.infer<typeof directorySelectionSchema>
export type ProviderCredentialInput = z.infer<typeof providerCredentialInputSchema>
export type SaveProviderApiKeyInput = z.infer<typeof saveProviderApiKeyInputSchema>
export type ProviderCredentialStatus = z.infer<typeof providerCredentialStatusSchema>
export type SaveModelProviderInput = z.infer<typeof saveModelProviderInputSchema>
export type ProviderIdInput = z.infer<typeof providerIdInputSchema>
export type ListModelsInput = z.infer<typeof listModelsInputSchema>
export type SaveModelInput = z.infer<typeof saveModelInputSchema>
export type ProviderConnectionTestResult = z.infer<typeof providerConnectionTestResultSchema>
export type AgentEvent = z.infer<typeof agentRuntimeEventSchema>
export type SessionDto = z.infer<typeof sessionSchema>
export type ModelProviderDto = z.infer<typeof modelProviderConfigSchema>
export type ModelDto = z.infer<typeof modelConfigSchema>

export type HesperDesktopApi = {
  sessions: {
    list(): Promise<SessionDto[]>
    create(input: CreateSessionInput): Promise<SessionDto>
    updateTitle(input: UpdateSessionTitleInput): Promise<SessionDto>
    archive(id: string): Promise<SessionDto>
    delete(id: string): Promise<SessionDto>
    setWorkspace(input: SetSessionWorkspaceInput): Promise<SessionDto>
    setModel(input: SetSessionModelInput): Promise<SessionDto>
    setOutputMode(input: SetSessionOutputModeInput): Promise<SessionDto>
  }
  agent: {
    enqueue(input: AgentEnqueueInput): Promise<{ runId: string }>
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
    testConnection(input: ProviderIdInput): Promise<ProviderConnectionTestResult>
  }
  models: {
    list(input?: ListModelsInput): Promise<ModelDto[]>
    save(input: SaveModelInput): Promise<ModelDto>
  }
  window: {
    platform: NodeJS.Platform
    minimize(): Promise<{ minimized: true }>
    toggleMaximize(): Promise<{ isMaximized: boolean }>
    close(): Promise<{ closed: true }>
  }
}
