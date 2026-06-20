import { z } from 'zod'
import type {
  AgentRun,
  Message,
  ModelConfig,
  ModelProviderConfig,
  ModelRef,
  Role,
  RunError,
  RunStep,
  Session,
  Skill,
  WorkerAgentInvocation,
  ToolDefinition,
  ToolPermissionPolicy
} from './domain'
import type { AgentRuntimeEvent } from './events'

type Simplify<T> = { [K in keyof T]: T[K] }
type Expect<T extends true> = T
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
    ? true
    : false
  : false

type StripUndefined<T> = {
  [K in keyof T]: undefined extends T[K] ? Exclude<T[K], undefined> : T[K]
}

type NormalizeOptional<T> = Simplify<StripUndefined<T>>

function stripUndefined<T extends Record<string, unknown>>(value: T): StripUndefined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as StripUndefined<T>
}

const runErrorBaseSchema = z.object({
  code: z.enum(['network_error', 'timeout', 'rate_limit_transient', 'stream_interrupted', 'tool_error', 'unknown']),
  message: z.string().min(1),
  retryable: z.boolean()
})

export const runErrorSchema = runErrorBaseSchema.transform((value) => value)

const modelRefBaseSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1)
})

export const modelRefSchema = modelRefBaseSchema.transform((value) => value)

const modelProviderConfigBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['mock', 'openai', 'deepseek', 'openai-compatible', 'anthropic', 'custom']),
  baseUrl: z.string().url().optional(),
  apiKeyRef: z.string().min(1).optional(),
  hasApiKey: z.boolean().optional(),
  enabled: z.boolean(),
  defaultModelId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const modelProviderConfigSchema = modelProviderConfigBaseSchema.transform(stripUndefined)

const modelConfigBaseSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  modelName: z.string().min(1),
  displayName: z.string().min(1),
  capabilities: z.array(z.enum(['streaming', 'toolCalls', 'jsonOutput', 'reasoning'])),
  contextWindow: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const modelConfigSchema = modelConfigBaseSchema.transform(stripUndefined)

const sessionBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['active', 'archived', 'deleted']),
  workspacePath: z.string().optional(),
  defaultModelId: z.string().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  roleId: z.string().min(1).optional(),
  enabledSkillIds: z.array(z.string().min(1)).optional(),
  enabledToolIds: z.array(z.string().min(1)).optional(),
  allowedWorkerAgentRoleIds: z.array(z.string().min(1)).optional(),
  maxWorkerAgentDepth: z.number().int().nonnegative().optional(),
  maxWorkerAgentsPerRun: z.number().int().nonnegative().optional(),
  outputMode: z.enum(['markdown', 'html']),
  unreadCompletedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const sessionSchema = sessionBaseSchema.transform(stripUndefined)

const messageBaseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  contentType: z.enum(['markdown', 'html', 'plain']),
  runId: z.string().optional(),
  createdAt: z.string().datetime()
})

export const messageSchema = messageBaseSchema.transform(stripUndefined)

const agentRunBaseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  parentRunId: z.string().optional(),
  workerAgentInvocationId: z.string().optional(),
  depth: z.number().int().nonnegative().optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  modelId: z.string().min(1),
  workspacePath: z.string().optional(),
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  error: runErrorSchema.optional()
})

export const agentRunSchema = agentRunBaseSchema.transform(stripUndefined)

const runStepBaseSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  type: z.enum(['thought', 'tool_call', 'tool_result', 'model_call', 'retry', 'warning']),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  title: z.string().min(1),
  summary: z.string().optional(),
  detail: z.string().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional()
})

export const runStepSchema = runStepBaseSchema.transform(stripUndefined)

const skillBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(['builtin', 'workspace', 'project']),
  path: z.string().optional(),
  sourcePath: z.string().optional(),
  prompt: z.string().optional(),
  allowedToolIds: z.array(z.string().min(1)).optional(),
  enabled: z.boolean().optional()
})

export const skillSchema = skillBaseSchema.transform(stripUndefined)

const roleBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  defaultModelId: z.string().optional(),
  defaultModelRef: modelRefSchema.optional(),
  systemPrompt: z.string().optional(),
  allowedSkillIds: z.array(z.string().min(1)),
  defaultSkillIds: z.array(z.string().min(1)).optional(),
  defaultToolIds: z.array(z.string().min(1)).optional(),
  canBeMainAgent: z.boolean(),
  canBeWorkerAgent: z.boolean(),
  canBeAssignedToWorkerAgent: z.boolean().optional(),
  workerAgentGuidance: z.string().optional()
})

export const roleSchema = roleBaseSchema.transform(stripUndefined)

export const toolDefinitionBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.unknown(),
  category: z.enum(['filesystem', 'git', 'web', 'agent', 'system']),
  icon: z.string().min(1).optional(),
  requiresApiKey: z.boolean().optional()
})

export const toolDefinitionSchema = toolDefinitionBaseSchema.transform(stripUndefined) satisfies z.ZodType<ToolDefinition>

const toolPermissionPolicyBaseSchema = z.object({
  id: z.string().min(1),
  toolId: z.string().min(1),
  mode: z.enum(['allow', 'deny', 'ask']),
  scope: z.enum(['global', 'session', 'role', 'worker-agent']),
  subjectId: z.string().min(1).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const toolPermissionPolicySchema = toolPermissionPolicyBaseSchema.transform(stripUndefined)

const workerAgentInvocationBaseSchema = z.object({
  id: z.string().min(1),
  parentRunId: z.string().min(1),
  childRunId: z.string().min(1).optional(),
  parentStepId: z.string().min(1).optional(),
  parentToolCallId: z.string().min(1).optional(),
  task: z.string().min(1),
  roleId: z.string().min(1),
  allowedToolIds: z.array(z.string().min(1)),
  modelRef: modelRefSchema.optional(),
  expectedOutput: z.string().optional(),
  contextSummary: z.string().optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  lastEventAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: runErrorSchema.optional()
})

export const workerAgentInvocationSchema = workerAgentInvocationBaseSchema.transform(stripUndefined)

const runCreatedEventSchema = z.object({
  type: z.literal('run.created'),
  run: agentRunSchema
})

const runStartedEventSchema = z.object({
  type: z.literal('run.started'),
  runId: z.string().min(1),
  startedAt: z.string().datetime().optional()
}).transform(stripUndefined)

const stepCreatedEventSchema = z.object({
  type: z.literal('step.created'),
  step: runStepSchema
})

const stepUpdatedEventSchema = z.object({
  type: z.literal('step.updated'),
  step: runStepSchema
})

const messageDeltaEventSchema = z.object({
  type: z.literal('message.delta'),
  runId: z.string().min(1),
  delta: z.string()
})

const messageCompletedEventSchema = z.object({
  type: z.literal('message.completed'),
  message: messageSchema
})

const runRetryingEventSchema = z.object({
  type: z.literal('run.retrying'),
  runId: z.string().min(1),
  retryCount: z.number().int().nonnegative(),
  nextRetryAt: z.string().datetime()
})

const runFailedEventSchema = z.object({
  type: z.literal('run.failed'),
  runId: z.string().min(1),
  error: runErrorSchema,
  endedAt: z.string().datetime().optional()
}).transform(stripUndefined)

const runSucceededEventSchema = z.object({
  type: z.literal('run.succeeded'),
  runId: z.string().min(1),
  endedAt: z.string().datetime().optional()
}).transform(stripUndefined)

const runCancelledEventSchema = z.object({
  type: z.literal('run.cancelled'),
  runId: z.string().min(1),
  endedAt: z.string().datetime().optional()
}).transform(stripUndefined)

const workerInvocationCreatedEventSchema = z.object({
  type: z.literal('worker.invocation.created'),
  invocation: workerAgentInvocationSchema
})

const workerInvocationUpdatedEventSchema = z.object({
  type: z.literal('worker.invocation.updated'),
  invocation: workerAgentInvocationSchema
})

export const agentRuntimeEventSchema = z.union([
  runCreatedEventSchema,
  runStartedEventSchema,
  stepCreatedEventSchema,
  stepUpdatedEventSchema,
  messageDeltaEventSchema,
  messageCompletedEventSchema,
  runRetryingEventSchema,
  runFailedEventSchema,
  runSucceededEventSchema,
  runCancelledEventSchema,
  workerInvocationCreatedEventSchema,
  workerInvocationUpdatedEventSchema
])

// Compile-time contract checks
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SessionCheck = Expect<Equal<z.output<typeof sessionSchema>, NormalizeOptional<Session>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MessageCheck = Expect<Equal<z.output<typeof messageSchema>, NormalizeOptional<Message>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AgentRunCheck = Expect<Equal<z.output<typeof agentRunSchema>, NormalizeOptional<AgentRun>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RunStepCheck = Expect<Equal<z.output<typeof runStepSchema>, NormalizeOptional<RunStep>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SkillCheck = Expect<Equal<z.output<typeof skillSchema>, NormalizeOptional<Skill>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RoleCheck = Expect<Equal<z.output<typeof roleSchema>, NormalizeOptional<Role>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ToolDefinitionCheck = Expect<Equal<z.output<typeof toolDefinitionSchema>, NormalizeOptional<ToolDefinition>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ToolPermissionPolicyCheck = Expect<Equal<z.output<typeof toolPermissionPolicySchema>, NormalizeOptional<ToolPermissionPolicy>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ModelRefCheck = Expect<Equal<z.output<typeof modelRefSchema>, NormalizeOptional<ModelRef>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ModelProviderConfigCheck = Expect<Equal<z.output<typeof modelProviderConfigSchema>, NormalizeOptional<ModelProviderConfig>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ModelConfigCheck = Expect<Equal<z.output<typeof modelConfigSchema>, NormalizeOptional<ModelConfig>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _WorkerAgentInvocationCheck = Expect<Equal<z.output<typeof workerAgentInvocationSchema>, NormalizeOptional<WorkerAgentInvocation>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RunErrorCheck = Expect<Equal<z.output<typeof runErrorSchema>, NormalizeOptional<RunError>>>// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AgentRuntimeEventCheck = Expect<Equal<z.output<typeof agentRuntimeEventSchema>, NormalizeOptional<AgentRuntimeEvent>>>
