export type SessionStatus = 'active' | 'archived' | 'deleted'
export type OutputMode = 'markdown' | 'html'
export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageContentType = 'markdown' | 'html' | 'plain'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type RunStepType = 'thought' | 'tool_call' | 'tool_result' | 'model_call' | 'retry' | 'warning'
export type RunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export type RunError = {
  code: 'network_error' | 'timeout' | 'rate_limit_transient' | 'stream_interrupted' | 'tool_error' | 'unknown'
  message: string
  retryable: boolean
}

export type ModelProviderKind = 'mock' | 'openai' | 'deepseek' | 'openai-compatible' | 'anthropic' | 'custom' | 'pi'
export type ModelProviderAuthType = 'api_key' | 'oauth' | 'none'
export type PiAuthProvider = 'openai-codex'
export type ModelCapability = 'streaming' | 'toolCalls' | 'jsonOutput' | 'reasoning'
export type ToolPermissionMode = 'allow' | 'deny' | 'ask'
export type ToolPermissionScope = 'global' | 'session' | 'role' | 'worker-agent'
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type WorkerAgentInvocationStatus = RunStatus

export type ModelRef = {
  providerId: string
  modelId: string
}

export type ModelProviderConfig = {
  id: string
  name: string
  kind: ModelProviderKind
  authType?: ModelProviderAuthType
  piAuthProvider?: PiAuthProvider
  baseUrl?: string
  apiKeyRef?: string
  hasApiKey?: boolean
  enabled: boolean
  defaultModelId?: string
  createdAt: string
  updatedAt: string
}

export type ModelConfig = {
  id: string
  providerId: string
  modelName: string
  displayName: string
  capabilities: ModelCapability[]
  contextWindow?: number
  enabled?: boolean
  createdAt: string
  updatedAt: string
}

export type Session = {
  id: string
  title: string
  status: SessionStatus
  workspacePath?: string
  defaultModelId?: string
  providerId?: string
  modelId?: string
  roleId?: string
  enabledSkillIds?: string[]
  enabledToolIds?: string[]
  allowedWorkerAgentRoleIds?: string[]
  maxWorkerAgentDepth?: number
  maxWorkerAgentsPerRun?: number
  outputMode: OutputMode
  unreadCompletedAt?: string
  createdAt: string
  updatedAt: string
}

export type Message = {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  contentType: MessageContentType
  runId?: string
  createdAt: string
}

export type AgentRun = {
  id: string
  sessionId: string
  parentRunId?: string
  workerAgentInvocationId?: string
  depth?: number
  status: RunStatus
  modelId: string
  workspacePath?: string
  retryCount: number
  maxRetries: number
  startedAt?: string
  endedAt?: string
  error?: RunError
}

export type RunStep = {
  id: string
  runId: string
  type: RunStepType
  status: RunStepStatus
  title: string
  summary?: string
  detail?: string
  createdAt: string
  completedAt?: string
}

export type Skill = {
  id: string
  name: string
  description?: string
  source: 'builtin' | 'workspace' | 'project'
  path?: string
  sourcePath?: string
  prompt?: string
  allowedToolIds?: string[]
  enabled?: boolean
}

export type Role = {
  id: string
  name: string
  description?: string
  defaultModelId?: string
  defaultModelRef?: ModelRef
  systemPrompt?: string
  allowedSkillIds: string[]
  defaultSkillIds?: string[]
  defaultToolIds?: string[]
  canBeMainAgent: boolean
  canBeWorkerAgent: boolean
  canBeAssignedToWorkerAgent?: boolean
  workerAgentGuidance?: string
}

export type ToolDefinition = {
  id: string
  name: string
  description: string
  inputSchema: unknown
  category: 'filesystem' | 'git' | 'web' | 'agent' | 'system'
  icon?: string
  requiresApiKey?: boolean
}

export type ToolPermissionPolicy = {
  id: string
  toolId: string
  mode: ToolPermissionMode
  scope: ToolPermissionScope
  subjectId?: string
  riskLevel?: ToolRiskLevel
  createdAt: string
  updatedAt: string
}

export type WorkerAgentInvocation = {
  id: string
  parentRunId: string
  childRunId?: string
  parentStepId?: string
  parentToolCallId?: string
  task: string
  roleId: string
  allowedToolIds: string[]
  modelRef?: ModelRef
  expectedOutput?: string
  contextSummary?: string
  status: WorkerAgentInvocationStatus
  lastEventAt?: string
  createdAt: string
  completedAt?: string
  error?: RunError
}

export type SshKey = {
  id: string
  name: string
  note?: string
  hasPassphrase: boolean
  createdAt: string
  updatedAt: string
}

export type SshServer = {
  id: string
  name: string
  host: string
  port: number
  username: string
  keyId: string
  note?: string
  createdAt: string
  updatedAt: string
}

export type SshServerAgentSummary = {
  id: string
  name: string
  note?: string
}

export type SshExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type SshCommandStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'

export type SshExecution = {
  id: string
  sessionId: string
  runId: string
  serverId: string
  serverName: string
  commands: string[]
  stopOnError: boolean
  timeoutMs: number
  status: SshExecutionStatus
  startedAt: string
  updatedAt: string
  completedAt?: string
  error?: RunError
}

export type SshCommandResult = {
  executionId: string
  index: number
  command: string
  status: SshCommandStatus
  stdout: string
  stderr: string
  exitCode?: number
  signal?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  skippedReason?: string
}
