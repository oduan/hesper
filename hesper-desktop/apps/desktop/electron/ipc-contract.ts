import { agentRunSchema, agentRuntimeEventSchema, appThemeIds, localFilePreviewSchema, messageSchema, modelConfigSchema, modelProviderConfigSchema, modelRefSchema, modelThinkingLevelSchema, runStepSchema, sessionSchema, skillSchema, sshKeySchema, sshServerSchema, themeModeValues, toolDefinitionBaseSchema, workerAgentInvocationSchema } from '@hesper/shared'
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
  attachmentsReadDataUrl: 'attachments:readDataUrl',
  filesPreview: 'files:preview',
  gitGetState: 'git:getState',
  gitListLog: 'git:listLog',
  gitGetCommit: 'git:getCommit',
  gitCreateBranch: 'git:createBranch',
  gitCreateTag: 'git:createTag',
  gitCheckout: 'git:checkout',
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
  skillsList: 'skills:list',
  skillsGet: 'skills:get',
  skillsRefresh: 'skills:refresh',
  sshKeysList: 'sshKeys:list',
  sshKeysCreate: 'sshKeys:create',
  sshKeysDelete: 'sshKeys:delete',
  sshServersList: 'sshServers:list',
  sshServersCreate: 'sshServers:create',
  sshServersUpdate: 'sshServers:update',
  sshServersDelete: 'sshServers:delete',
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
export const localFilePreviewInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  path: nonEmptyStringSchema
}).strict()
export const localFilePreviewResultSchema = localFilePreviewSchema

export const gitRefSchema = z.object({
  name: nonEmptyStringSchema,
  shortName: nonEmptyStringSchema,
  type: z.enum(['local-branch', 'remote-branch', 'tag', 'head']),
  targetCommit: nonEmptyStringSchema.optional()
}).strict()

export const gitGraphLaneSchema = z.object({
  id: nonEmptyStringSchema,
  color: nonEmptyStringSchema,
  active: z.boolean()
}).strict()

export const gitGraphEdgeSchema = z.object({
  fromLaneId: nonEmptyStringSchema,
  toLaneId: nonEmptyStringSchema
}).strict()

export const gitGraphRowSchema = z.object({
  commitHash: nonEmptyStringSchema,
  shortHash: nonEmptyStringSchema,
  parents: z.array(nonEmptyStringSchema),
  subject: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.string().datetime(),
  refs: z.array(gitRefSchema),
  graph: z.object({
    lanes: z.array(gitGraphLaneSchema),
    nodeLaneId: nonEmptyStringSchema.optional(),
    edges: z.array(gitGraphEdgeSchema).optional()
  }).strict()
}).strict()

export const gitRepositoryStateSchema = z.object({
  sessionId: nonEmptyStringSchema,
  workspacePath: nonEmptyStringSchema.optional(),
  isGitRepository: z.boolean(),
  currentBranch: nonEmptyStringSchema.optional(),
  headCommit: nonEmptyStringSchema.optional(),
  dirty: z.boolean(),
  changedFiles: z.number().int().nonnegative(),
  refs: z.array(gitRefSchema)
}).strict()

export const gitCommitFileChangeSchema = z.object({
  path: nonEmptyStringSchema,
  oldPath: nonEmptyStringSchema.optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'type-change', 'unmerged', 'unknown']),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional()
}).strict()

export const gitLogResultSchema = z.object({
  rows: z.array(gitGraphRowSchema),
  limit: z.number().int().positive(),
  hasMore: z.boolean()
}).strict()

export const gitCommitDetailSchema = z.object({
  commitHash: nonEmptyStringSchema,
  shortHash: nonEmptyStringSchema,
  parents: z.array(nonEmptyStringSchema),
  subject: z.string(),
  body: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.string().datetime(),
  committerName: z.string(),
  committerEmail: z.string(),
  committedAt: z.string().datetime(),
  refs: z.array(gitRefSchema),
  files: z.array(gitCommitFileChangeSchema)
}).strict()

export const gitActionResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  state: gitRepositoryStateSchema.optional()
}).strict()

export const gitSessionInputSchema = z.object({
  sessionId: nonEmptyStringSchema
}).strict()

export const gitLogInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  limit: z.number().int().min(1).max(500).optional()
}).strict()

export const gitCommitInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  commit: nonEmptyStringSchema
}).strict()

export const gitCreateBranchInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  commit: nonEmptyStringSchema,
  branchName: nonEmptyStringSchema,
  checkout: z.boolean().optional()
}).strict()

export const gitCreateTagInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  commit: nonEmptyStringSchema,
  tagName: nonEmptyStringSchema
}).strict()

export const gitCheckoutInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  ref: nonEmptyStringSchema
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

export const draftAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    name: nonEmptyStringSchema,
    mimeType: nonEmptyStringSchema.refine((mimeType) => mimeType.toLowerCase().startsWith('image/'), { message: 'Image attachments require an image MIME type' }),
    bytes: z.number().int().nonnegative(),
    dataUrl: nonEmptyStringSchema
  }).strict(),
  z.object({
    kind: z.literal('text'),
    name: nonEmptyStringSchema,
    mimeType: nonEmptyStringSchema,
    bytes: z.number().int().nonnegative(),
    content: z.string()
  }).strict()
])

export const agentEnqueueInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  prompt: z.string(),
  displayPrompt: nonEmptyStringSchema.optional(),
  modelId: nonEmptyStringSchema,
  thinkingLevel: modelThinkingLevelSchema.optional(),
  workspacePath: z.string().optional(),
  enabledToolIds: z.array(nonEmptyStringSchema).optional(),
  parentRunId: nonEmptyStringSchema.optional(),
  messageId: nonEmptyStringSchema.optional(),
  messageCreatedAt: z.string().datetime().optional(),
  draftAttachments: z.array(draftAttachmentSchema).optional()
}).superRefine((input, ctx) => {
  const hasPromptContent = input.prompt.trim().length > 0
  const hasDraftAttachments = (input.draftAttachments?.length ?? 0) > 0
  if (!hasPromptContent && !hasDraftAttachments) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['prompt'],
      message: 'prompt or draftAttachments is required'
    })
  }
})

export const attachmentReadDataUrlInputSchema = z.object({
  relativePath: nonEmptyStringSchema,
  mimeType: nonEmptyStringSchema
}).strict()

export const attachmentDataUrlResultSchema = z.object({
  dataUrl: nonEmptyStringSchema
}).strict()

export const appFontSizeSchema = z.number().int().min(12).max(18)

export const appSettingsSchema = z.object({
  defaultModelId: z.string().min(1),
  defaultOutputMode: z.enum(['markdown', 'html']),
  themeMode: z.enum(themeModeValues),
  themeId: z.enum(appThemeIds),
  fontSize: appFontSizeSchema,
  soul: z.string()
}).strict()

export const updateSettingsInputSchema = z.object({
  defaultModelId: z.string().min(1).optional(),
  defaultOutputMode: z.enum(['markdown', 'html']).optional(),
  themeMode: z.enum(themeModeValues).optional(),
  themeId: z.enum(appThemeIds).optional(),
  fontSize: appFontSizeSchema.optional(),
  soul: z.string().optional()
}).strict()

export const managedRoleDtoSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: z.string(),
  systemPrompt: z.string(),
  defaultToolIds: z.array(nonEmptyStringSchema),
  defaultModelId: z.string(),
  defaultModelRef: modelRefSchema.optional()
}).strict()

export const createRoleInputSchema = z.object({
  name: nonEmptyStringSchema,
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultToolIds: z.array(nonEmptyStringSchema).optional(),
  defaultModelId: z.string().optional(),
  defaultModelRef: modelRefSchema.optional()
}).strict()

export const updateRoleInputSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema.optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultToolIds: z.array(nonEmptyStringSchema).optional(),
  defaultModelId: z.string().optional(),
  defaultModelRef: modelRefSchema.optional()
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
  capabilities: z.array(z.enum(['streaming', 'toolCalls', 'jsonOutput', 'reasoning', 'imageInput'])).optional(),
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
  ...(value.display !== undefined ? { display: value.display } : {}),
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

export const createSshKeyInputSchema = z.object({
  name: nonEmptyStringSchema,
  publicKey: nonEmptyStringSchema,
  privateKey: nonEmptyStringSchema,
  passphrase: z.string().optional(),
  note: z.string().optional()
}).strict()

export const createSshServerInputSchema = z.object({
  name: nonEmptyStringSchema,
  host: nonEmptyStringSchema,
  port: z.number().int().min(1).max(65535),
  username: nonEmptyStringSchema,
  keyId: nonEmptyStringSchema,
  note: z.string().optional()
}).strict()

export const updateSshServerInputSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema.optional(),
  host: nonEmptyStringSchema.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: nonEmptyStringSchema.optional(),
  keyId: nonEmptyStringSchema.optional(),
  note: z.string().optional()
}).strict()

export const skillDtoSchema = skillSchema
export const skillsResultSchema = z.array(skillDtoSchema)
export const sshKeysResultSchema = z.array(sshKeySchema)
export const sshServersResultSchema = z.array(sshServerSchema)

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
export type DraftAttachment = z.infer<typeof draftAttachmentSchema>
export type AgentEnqueueInput = z.infer<typeof agentEnqueueInputSchema>
export type AttachmentReadDataUrlInput = z.infer<typeof attachmentReadDataUrlInputSchema>
export type AttachmentDataUrlResult = z.infer<typeof attachmentDataUrlResultSchema>
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
export type SkillDto = z.infer<typeof skillDtoSchema>
export type SetToolEnabledInput = z.infer<typeof setToolEnabledInputSchema>
export type ToolCredentialInput = z.infer<typeof toolCredentialInputSchema>
export type SaveToolApiKeyInput = z.infer<typeof saveToolApiKeyInputSchema>
export type ToolCredentialStatus = z.infer<typeof toolCredentialStatusSchema>
export type CreateSshKeyInput = z.infer<typeof createSshKeyInputSchema>
export type CreateSshServerInput = z.infer<typeof createSshServerInputSchema>
export type UpdateSshServerInput = z.infer<typeof updateSshServerInputSchema>
export type SshKeyDto = z.infer<typeof sshKeySchema>
export type SshServerDto = z.infer<typeof sshServerSchema>
export type ProviderConnectionTestResult = z.infer<typeof providerConnectionTestResultSchema>
export type AgentEvent = z.infer<typeof agentRuntimeEventSchema>
export type SessionDto = z.infer<typeof sessionSchema>
export type MessageDto = z.infer<typeof messageSchema>
export type AgentRunDto = z.infer<typeof agentRunSchema>
export type RunStepDto = z.infer<typeof runStepSchema>
export type WorkerAgentInvocationDto = z.infer<typeof workerAgentInvocationSchema>
export type ConversationMessagesByRunInput = z.infer<typeof conversationMessagesByRunInputSchema>
export type WorkerInvocationsListByParentRunInput = z.infer<typeof workerInvocationsListByParentRunInputSchema>
export type LocalFilePreviewInput = z.infer<typeof localFilePreviewInputSchema>
export type LocalFilePreviewDto = z.infer<typeof localFilePreviewResultSchema>
export type GitRefDto = z.infer<typeof gitRefSchema>
export type GitGraphLaneDto = z.infer<typeof gitGraphLaneSchema>
export type GitGraphEdgeDto = z.infer<typeof gitGraphEdgeSchema>
export type GitGraphRowDto = z.infer<typeof gitGraphRowSchema>
export type GitRepositoryStateDto = z.infer<typeof gitRepositoryStateSchema>
export type GitCommitFileChangeDto = z.infer<typeof gitCommitFileChangeSchema>
export type GitLogResultDto = z.infer<typeof gitLogResultSchema>
export type GitCommitDetailDto = z.infer<typeof gitCommitDetailSchema>
export type GitActionResultDto = z.infer<typeof gitActionResultSchema>
export type GitSessionInput = z.infer<typeof gitSessionInputSchema>
export type GitLogInput = z.infer<typeof gitLogInputSchema>
export type GitCommitInput = z.infer<typeof gitCommitInputSchema>
export type GitCreateBranchInput = z.infer<typeof gitCreateBranchInputSchema>
export type GitCreateTagInput = z.infer<typeof gitCreateTagInputSchema>
export type GitCheckoutInput = z.infer<typeof gitCheckoutInputSchema>
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
  files: {
    preview(input: LocalFilePreviewInput): Promise<LocalFilePreviewDto>
  }
  git: {
    getState(input: GitSessionInput): Promise<GitRepositoryStateDto>
    listLog(input: GitLogInput): Promise<GitLogResultDto>
    getCommit(input: GitCommitInput): Promise<GitCommitDetailDto>
    createBranch(input: GitCreateBranchInput): Promise<GitActionResultDto>
    createTag(input: GitCreateTagInput): Promise<GitActionResultDto>
    checkout(input: GitCheckoutInput): Promise<GitActionResultDto>
  }
  attachments?: {
    readDataUrl(input: AttachmentReadDataUrlInput): Promise<AttachmentDataUrlResult>
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
  skills: {
    list(): Promise<SkillDto[]>
    get(id: string): Promise<SkillDto | undefined>
    refresh(): Promise<SkillDto[]>
  }
  sshKeys: {
    list(): Promise<SshKeyDto[]>
    create(input: CreateSshKeyInput): Promise<SshKeyDto>
    delete(id: string): Promise<{ deleted: true; id: string }>
  }
  sshServers: {
    list(): Promise<SshServerDto[]>
    create(input: CreateSshServerInput): Promise<SshServerDto>
    update(input: UpdateSshServerInput): Promise<SshServerDto>
    delete(id: string): Promise<{ deleted: true; id: string }>
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
