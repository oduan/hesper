import { z } from 'zod'
import type {
  AgentRun,
  Message,
  Role,
  RunError,
  RunStep,
  Session,
  Skill,
  ToolDefinition
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

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

const runErrorBaseSchema = z.object({
  code: z.enum(['network_error', 'timeout', 'rate_limit_transient', 'stream_interrupted', 'tool_error', 'unknown']),
  message: z.string().min(1),
  retryable: z.boolean()
})

export const runErrorSchema = runErrorBaseSchema.transform((value) => value) as z.ZodType<RunError>

const sessionBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['active', 'archived', 'deleted']),
  workspacePath: z.string().optional(),
  defaultModelId: z.string().optional(),
  outputMode: z.enum(['markdown', 'html']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const sessionSchema = sessionBaseSchema.transform(stripUndefined) as z.ZodType<Session>

const messageBaseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  contentType: z.enum(['markdown', 'html', 'plain']),
  runId: z.string().optional(),
  createdAt: z.string().datetime()
})

export const messageSchema = messageBaseSchema.transform(stripUndefined) as z.ZodType<Message>

const agentRunBaseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  parentRunId: z.string().optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  modelId: z.string().min(1),
  workspacePath: z.string().optional(),
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  error: runErrorSchema.optional()
})

export const agentRunSchema = agentRunBaseSchema.transform(stripUndefined) as z.ZodType<AgentRun>

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

export const runStepSchema = runStepBaseSchema.transform(stripUndefined) as z.ZodType<RunStep>

const skillBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(['builtin', 'workspace', 'project']),
  path: z.string().optional()
})

export const skillSchema = skillBaseSchema.transform(stripUndefined) as z.ZodType<Skill>

const roleBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  defaultModelId: z.string().optional(),
  allowedSkillIds: z.array(z.string().min(1)),
  canBeMainAgent: z.boolean(),
  canBeSubagent: z.boolean()
})

export const roleSchema = roleBaseSchema.transform(stripUndefined) as z.ZodType<Role>

export const toolDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.unknown(),
  category: z.enum(['filesystem', 'git', 'web', 'agent', 'system'])
}) satisfies z.ZodType<ToolDefinition>

const runCreatedEventSchema = z.object({
  type: z.literal('run.created'),
  run: agentRunSchema
})

const runStartedEventSchema = z.object({
  type: z.literal('run.started'),
  runId: z.string().min(1)
})

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
  error: runErrorSchema
})

const runSucceededEventSchema = z.object({
  type: z.literal('run.succeeded'),
  runId: z.string().min(1)
})

export const agentRuntimeEventSchema = z.discriminatedUnion('type', [
  runCreatedEventSchema,
  runStartedEventSchema,
  stepCreatedEventSchema,
  stepUpdatedEventSchema,
  messageDeltaEventSchema,
  messageCompletedEventSchema,
  runRetryingEventSchema,
  runFailedEventSchema,
  runSucceededEventSchema
]) as z.ZodType<AgentRuntimeEvent>

// Compile-time contract checks
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SessionCheck = Expect<Equal<z.infer<typeof sessionSchema>, Simplify<Session>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MessageCheck = Expect<Equal<z.infer<typeof messageSchema>, Simplify<Message>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AgentRunCheck = Expect<Equal<z.infer<typeof agentRunSchema>, Simplify<AgentRun>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RunStepCheck = Expect<Equal<z.infer<typeof runStepSchema>, Simplify<RunStep>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SkillCheck = Expect<Equal<z.infer<typeof skillSchema>, Simplify<Skill>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RoleCheck = Expect<Equal<z.infer<typeof roleSchema>, Simplify<Role>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ToolDefinitionCheck = Expect<Equal<z.infer<typeof toolDefinitionSchema>, Simplify<ToolDefinition>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RunErrorCheck = Expect<Equal<z.infer<typeof runErrorSchema>, Simplify<RunError>>>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AgentRuntimeEventCheck = Expect<Equal<z.infer<typeof agentRuntimeEventSchema>, Simplify<AgentRuntimeEvent>>>
