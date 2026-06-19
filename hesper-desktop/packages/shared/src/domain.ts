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

export type ModelProviderKind = 'mock' | 'openai' | 'deepseek' | 'openai-compatible' | 'anthropic' | 'custom'
export type ModelCapability = 'streaming' | 'toolCalls' | 'jsonOutput' | 'reasoning'
export type ToolPermissionMode = 'allow' | 'deny' | 'ask'
export type ToolPermissionScope = 'global' | 'session' | 'role' | 'subagent'
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type SubagentInvocationStatus = RunStatus

export type ModelRef = {
  providerId: string
  modelId: string
}

export type ModelProviderConfig = {
  id: string
  name: string
  kind: ModelProviderKind
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
  allowedSubagentRoleIds?: string[]
  maxSubagentDepth?: number
  maxSubagentsPerRun?: number
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
  subagentInvocationId?: string
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
  canBeSubagent: boolean
  canBeAssignedToSubagent?: boolean
  subagentGuidance?: string
}

export type ToolDefinition = {
  id: string
  name: string
  description: string
  inputSchema: unknown
  category: 'filesystem' | 'git' | 'web' | 'agent' | 'system'
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

export type SubagentInvocation = {
  id: string
  parentRunId: string
  childRunId?: string
  task: string
  roleId: string
  allowedToolIds: string[]
  modelRef?: ModelRef
  expectedOutput?: string
  status: SubagentInvocationStatus
  createdAt: string
  completedAt?: string
  error?: RunError
}
