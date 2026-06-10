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

export type Session = {
  id: string
  title: string
  status: SessionStatus
  workspacePath?: string
  defaultModelId?: string
  outputMode: OutputMode
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
}

export type Role = {
  id: string
  name: string
  description?: string
  defaultModelId?: string
  allowedSkillIds: string[]
  canBeMainAgent: boolean
  canBeSubagent: boolean
}

export type ToolDefinition = {
  id: string
  name: string
  description: string
  inputSchema: unknown
  category: 'filesystem' | 'git' | 'web' | 'agent' | 'system'
}
