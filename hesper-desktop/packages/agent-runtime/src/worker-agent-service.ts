import { randomUUID } from 'node:crypto'
import type { Persistence } from '@hesper/persistence'
import {
  createId,
  nowIso,
  type AgentRun,
  type AgentRuntimeEvent,
  type Message,
  type Role,
  type RunError,
  type RunStep,
  type Session,
  type Skill,
  type ToolDefinition,
  type WorkerAgentInvocation
} from '@hesper/shared'
import type { ToolExecutionContext } from '@hesper/tools'
import type { AgentAdapter } from './adapters'
import { normalizeUnknownError } from './adapters'
import { diagnoseWorkerAgent, type WorkerAgentDiagnosis } from './worker-agent-diagnosis'

const DEFAULT_WAIT_TIMEOUT_MS = 60_000
const MAX_WAIT_TIMEOUT_MS = 300_000
const WORKER_AGENT_TOOL_IDS = new Set([
  'agent.spawn-worker-agent',
  'agent.list-worker-agents',
  'agent.get-worker-agent',
  'agent.wait-worker-agent',
  'agent.cancel-worker-agent'
])

const WORKER_AGENT_STATUSES = new Set<WorkerAgentInvocation['status']>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
])

export type SpawnWorkerAgentInput = {
  task: string
  roleId: string
  allowedToolIds: string[]
  expectedOutput?: string
  contextSummary?: string
  wait?: boolean
  timeoutMs?: number
  cancelOnTimeout?: boolean
}

export type ListWorkerAgentsInput = {
  parentRunId?: string
  status?: WorkerAgentInvocation['status']
}

export type GetWorkerAgentInput = {
  invocationId: string
}

export type WaitWorkerAgentInput = {
  invocationId: string
  timeoutMs?: number
  cancelOnTimeout?: boolean
}

export type CancelWorkerAgentInput = {
  invocationId: string
  reason?: string
}

export type WorkerAgentResult = {
  messageId: string
  content: string
}

export type WorkerAgentToolResult = WorkerAgentInvocation & {
  invocationId: string
  childRunId: string
  timedOut?: boolean
  diagnosis?: WorkerAgentDiagnosis
  result?: WorkerAgentResult
}

type PromptAssemblyLike = {
  assembleWorkerAgentPrompt(input: {
    session: Pick<Session, 'id' | 'workspacePath' | 'outputMode' | 'enabledSkillIds'>
    role: Role
    skills: Skill[]
    tools: ToolDefinition[]
    task: string
    expectedOutput?: string
    contextSummary?: string
    allowedToolIds: string[]
    depth: number
    maxDepth: number
    maxWorkerAgentsPerRun: number
  }): { systemPrompt: string }
}

type RegistryLike<T> = {
  list(): T[]
}

type MaybePromise<T> = T | Promise<T>

type RoleRegistryLike = {
  listRoles(): MaybePromise<Role[]>
  getRole(id: string): MaybePromise<Role | undefined>
}

type ToolRegistryLike = RegistryLike<ToolDefinition> & {
  get(id: string): ToolDefinition | undefined
}

type RuntimeListener = (event: AgentRuntimeEvent) => void | Promise<void>

type ActiveWorker = {
  invocationId: string
  childRunId: string
  controller: AbortController
  promise: Promise<void>
  startedAt: string
  lastEventAt: string
}

type FinalizedChildRunState = {
  status: WorkerAgentInvocation['status']
  endedAt: string
}

type SpawnPreparation = {
  parsed: SpawnWorkerAgentInput
  invocation: WorkerAgentInvocation
  childRun: AgentRun
  activeWorker: ActiveWorker
  role: Role
  session: Session
  effectiveAllowedToolIds: string[]
}

export type WorkerAgentServiceOptions = {
  persistence: Persistence
  adapter: AgentAdapter
  promptAssembly: PromptAssemblyLike
  roles: RoleRegistryLike
  skills: RegistryLike<Skill>
  tools: ToolRegistryLike
  filterEnabledToolIds: (toolIds: string[]) => Promise<string[]>
  emit?: (event: AgentRuntimeEvent) => void | Promise<void>
  now?: () => string
}

export type WorkerAgentService = {
  subscribe(listener: RuntimeListener): () => void
  spawn(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult>
  list(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentInvocation[]>
  get(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult>
  wait(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult>
  cancel(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult>
}

function currentNow(options: WorkerAgentServiceOptions): string {
  return options.now?.() ?? nowIso()
}

function createWorkerAgentId(): string {
  return `worker-agent-${randomUUID()}`
}

function composeWorkerPrompt(task: string, contextSummary?: string): string {
  if (!contextSummary) return task
  return `Context summary:\n${contextSummary}\n\nTask:\n${task}`
}

function boundedTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MS
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WAIT_TIMEOUT_MS
  return Math.min(Math.floor(value), MAX_WAIT_TIMEOUT_MS)
}

function ensureString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Worker Agent argument must be a non-empty string: ${key}`)
  return value
}

function ensureStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Worker Agent argument must be an array of non-empty strings: ${key}`)
  }
  return value
}

function parseSpawnInput(input: Record<string, unknown>): SpawnWorkerAgentInput {
  return {
    task: ensureString(input.task, 'task'),
    roleId: ensureString(input.roleId, 'roleId'),
    allowedToolIds: ensureStringArray(input.allowedToolIds, 'allowedToolIds'),
    ...(typeof input.expectedOutput === 'string' ? { expectedOutput: input.expectedOutput } : {}),
    ...(typeof input.contextSummary === 'string' ? { contextSummary: input.contextSummary } : {}),
    ...(typeof input.wait === 'boolean' ? { wait: input.wait } : {}),
    ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
    ...(typeof input.cancelOnTimeout === 'boolean' ? { cancelOnTimeout: input.cancelOnTimeout } : {})
  }
}

function parseInvocationInput(input: Record<string, unknown>): GetWorkerAgentInput {
  return {
    invocationId: ensureString(input.invocationId, 'invocationId')
  }
}

function parseWaitInput(input: Record<string, unknown>): WaitWorkerAgentInput {
  return {
    invocationId: ensureString(input.invocationId, 'invocationId'),
    ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
    ...(typeof input.cancelOnTimeout === 'boolean' ? { cancelOnTimeout: input.cancelOnTimeout } : {})
  }
}

function parseCancelInput(input: Record<string, unknown>): CancelWorkerAgentInput {
  return {
    invocationId: ensureString(input.invocationId, 'invocationId'),
    ...(typeof input.reason === 'string' ? { reason: input.reason } : {})
  }
}

function parseWorkerAgentStatus(value: unknown): WorkerAgentInvocation['status'] {
  if (typeof value !== 'string' || !WORKER_AGENT_STATUSES.has(value as WorkerAgentInvocation['status'])) {
    throw new Error(`Worker Agent status is invalid: ${String(value)}`)
  }
  return value as WorkerAgentInvocation['status']
}

function parseListInput(input: Record<string, unknown>): ListWorkerAgentsInput {
  return {
    ...(typeof input.parentRunId === 'string' && input.parentRunId.trim() ? { parentRunId: input.parentRunId } : {}),
    ...(input.status !== undefined ? { status: parseWorkerAgentStatus(input.status) } : {})
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function createAccessDeniedError(): Error {
  return new Error('Worker Agent access denied: invocation belongs to a different session')
}

function createNotFoundError(entity: string, id: string): Error {
  return new Error(`${entity} not found: ${id}`)
}

function createRoleError(roleId: string): Error {
  return new Error(`Worker Agent role is not assignable: ${roleId}`)
}

function createLimitError(message: string): Error {
  return new Error(message)
}

function latestAssistantMessage(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') return message
  }
  return undefined
}

function latestRunningStep(steps: RunStep[]): RunStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step?.status === 'running') return step
  }
  return undefined
}

function isFinalStatus(status: WorkerAgentInvocation['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function runIdFromEvent(event: AgentRuntimeEvent): string | undefined {
  if (event.type === 'run.created') return event.run.id
  if (event.type === 'run.started' || event.type === 'run.retrying' || event.type === 'run.failed' || event.type === 'run.succeeded' || event.type === 'run.cancelled') return event.runId
  if (event.type === 'step.created' || event.type === 'step.updated') return event.step.runId
  if (event.type === 'message.delta') return event.runId
  if (event.type === 'message.completed') return event.message.runId
  if (event.type === 'worker.invocation.created' || event.type === 'worker.invocation.updated') return event.invocation.childRunId ?? event.invocation.parentRunId
  return undefined
}

export function createWorkerAgentService(options: WorkerAgentServiceOptions): WorkerAgentService {
  const listeners = new Set<RuntimeListener>()
  const activeWorkers = new Map<string, ActiveWorker>()
  const childRunIdToInvocationId = new Map<string, string>()
  const finalizedChildRuns = new Map<string, FinalizedChildRunState>()
  const spawnChains = new Map<string, Promise<void>>()

  async function withSpawnLock<T>(parentRunId: string, task: () => Promise<T>): Promise<T> {
    const previous = spawnChains.get(parentRunId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = previous.then(() => current)
    spawnChains.set(parentRunId, chained)

    await previous
    try {
      return await task()
    } finally {
      release()
      if (spawnChains.get(parentRunId) === chained) {
        spawnChains.delete(parentRunId)
      }
    }
  }

  function getParentRunId(input: ListWorkerAgentsInput, context: ToolExecutionContext): string {
    return input.parentRunId ?? context.runId
  }

  async function broadcastEvent(event: AgentRuntimeEvent): Promise<void> {
    await options.persistence.events.append(event)
    for (const listener of listeners) {
      try {
        await listener(event)
      } catch (error) {
        console.error('WorkerAgentService listener failed', error)
      }
    }
    if (options.emit) {
      try {
        await options.emit(event)
      } catch (error) {
        console.error('WorkerAgentService emit failed', error)
      }
    }
  }

  async function saveInvocation(invocation: WorkerAgentInvocation): Promise<WorkerAgentInvocation> {
    await options.persistence.workerAgentInvocations.save(invocation)
    return invocation
  }

  async function emitInvocationCreated(invocation: WorkerAgentInvocation): Promise<void> {
    await broadcastEvent({ type: 'worker.invocation.created', invocation })
  }

  async function emitInvocationUpdated(invocation: WorkerAgentInvocation): Promise<void> {
    await broadcastEvent({ type: 'worker.invocation.updated', invocation })
  }

  async function updateInvocationRecord(invocationId: string, patch: Partial<WorkerAgentInvocation>): Promise<WorkerAgentInvocation> {
    const existing = await options.persistence.workerAgentInvocations.get(invocationId)
    if (!existing) throw createNotFoundError('Worker Agent invocation', invocationId)
    const updated: WorkerAgentInvocation = { ...existing, ...patch }
    await saveInvocation(updated)
    const active = activeWorkers.get(invocationId)
    if (active && patch.lastEventAt) active.lastEventAt = patch.lastEventAt
    await emitInvocationUpdated(updated)
    return updated
  }

  async function touchInvocation(invocationId: string, timestamp: string): Promise<WorkerAgentInvocation> {
    return updateInvocationRecord(invocationId, { lastEventAt: timestamp })
  }

  function markChildRunFinalized(childRunId: string, status: WorkerAgentInvocation['status']): boolean {
    if (finalizedChildRuns.has(childRunId)) return false
    finalizedChildRuns.set(childRunId, { status, endedAt: currentNow(options) })
    return true
  }

  function getFinalizedChildRunStatus(childRunId: string): FinalizedChildRunState | undefined {
    return finalizedChildRuns.get(childRunId)
  }

  function getActiveWorkerByInvocationId(invocationId: string): ActiveWorker | undefined {
    return activeWorkers.get(invocationId)
  }

  async function findInvocationByChildRun(childRunId: string): Promise<WorkerAgentInvocation | undefined> {
    const invocationId = childRunIdToInvocationId.get(childRunId)
    if (invocationId) {
      return options.persistence.workerAgentInvocations.get(invocationId)
    }
    const invocations = await options.persistence.workerAgentInvocations.listByChildRun(childRunId)
    return invocations[0]
  }

  async function loadInvocationWithSession(invocationId: string, context: ToolExecutionContext): Promise<{ invocation: WorkerAgentInvocation; parentRun: AgentRun; }> {
    const invocation = await options.persistence.workerAgentInvocations.get(invocationId)
    if (!invocation) throw createNotFoundError('Worker Agent invocation', invocationId)

    const parentRun = await options.persistence.runs.get(invocation.parentRunId)
    if (!parentRun) throw createNotFoundError('Run', invocation.parentRunId)
    if (parentRun.sessionId !== context.sessionId) throw createAccessDeniedError()

    const session = await options.persistence.sessions.get(context.sessionId)
    if (!session) throw createNotFoundError('Session', context.sessionId)

    return { invocation, parentRun }
  }

  async function loadParentRunAndSession(parentRunId: string, sessionId: string): Promise<{ parentRun: AgentRun; session: Session }> {
    const parentRun = await options.persistence.runs.get(parentRunId)
    if (!parentRun) throw createNotFoundError('Run', parentRunId)
    if (parentRun.sessionId !== sessionId) throw createAccessDeniedError()

    const session = await options.persistence.sessions.get(sessionId)
    if (!session) throw createNotFoundError('Session', sessionId)

    return { parentRun, session }
  }

  function isAssignableWorkerRole(role: Role): boolean {
    return role.canBeWorkerAgent === true && role.canBeAssignedToWorkerAgent !== false
  }

  function ensureWorkerRole(session: Session, role: Role | undefined, roleId: string, assignableRoles: Role[]): Role {
    if (!role) throw createNotFoundError('Role', roleId)
    if (!isAssignableWorkerRole(role)) throw createRoleError(roleId)

    const allowedRoleIds = session.allowedWorkerAgentRoleIds
    if (allowedRoleIds && allowedRoleIds.length > 0) {
      if (!allowedRoleIds.includes(roleId)) throw createRoleError(roleId)
      return role
    }

    if (!assignableRoles.some((candidate) => candidate.id === roleId)) throw createRoleError(roleId)
    return role
  }

  async function resolveEffectiveAllowedToolIds(requestedAllowedToolIds: string[], contextAllowedToolIds: string[], roleDefaultToolIds: string[] | undefined): Promise<string[]> {
    const requested = uniqueStrings(requestedAllowedToolIds)
    const contextAllowed = new Set(uniqueStrings(contextAllowedToolIds))
    const roleAllowed = new Set(uniqueStrings(roleDefaultToolIds ?? []))
    const intersection = requested.filter((toolId) => contextAllowed.has(toolId) && roleAllowed.has(toolId))
    if (intersection.length === 0) return []

    const globallyEnabled = new Set(await options.filterEnabledToolIds(intersection))
    return intersection.filter((toolId) => globallyEnabled.has(toolId) && !WORKER_AGENT_TOOL_IDS.has(toolId))
  }

  async function buildSnapshot(invocationId: string, optionsSnapshot: { timedOut?: boolean } = {}): Promise<WorkerAgentToolResult> {
    const invocation = await options.persistence.workerAgentInvocations.get(invocationId)
    if (!invocation) throw createNotFoundError('Worker Agent invocation', invocationId)

    const parentRun = await options.persistence.runs.get(invocation.parentRunId)
    if (!parentRun) throw createNotFoundError('Run', invocation.parentRunId)

    const childRun = invocation.childRunId ? await options.persistence.runs.get(invocation.childRunId) : undefined
    const messages = invocation.childRunId ? await options.persistence.messages.listByRun(invocation.childRunId) : []
    const steps = invocation.childRunId ? await options.persistence.steps.listByRun(invocation.childRunId) : []
    const resultMessage = latestAssistantMessage(messages)
    const activeWorker = getActiveWorkerByInvocationId(invocationId)
    const finalState = invocation.childRunId ? getFinalizedChildRunStatus(invocation.childRunId) : undefined
    const shouldDiagnose = invocation.status === 'running' && !finalState
    const activeStep = latestRunningStep(steps)
    const diagnosis = shouldDiagnose
      ? diagnoseWorkerAgent({
          startedAt: childRun?.startedAt ?? invocation.createdAt,
          lastEventAt: activeWorker?.lastEventAt ?? invocation.lastEventAt ?? childRun?.startedAt ?? invocation.createdAt,
          now: currentNow(options),
          ...(activeStep ? { activeStep } : {})
        })
      : undefined

    const childRunId = invocation.childRunId
    if (!childRunId) throw createNotFoundError('Run', invocation.parentRunId)

    return {
      ...invocation,
      invocationId: invocation.id,
      childRunId,
      ...(optionsSnapshot.timedOut ? { timedOut: true } : {}),
      ...(diagnosis ? { diagnosis } : {}),
      ...(resultMessage ? { result: { messageId: resultMessage.id, content: resultMessage.content } } : {})
    }
  }

  async function handleChildEvent(invocationId: string, childRunId: string, event: AgentRuntimeEvent): Promise<void> {
    if (getFinalizedChildRunStatus(childRunId)) return

    if (event.type === 'step.created' || event.type === 'step.updated') {
      await options.persistence.steps.save(event.step)
    }
    if (event.type === 'message.completed') {
      await options.persistence.messages.save(event.message)
    }

    await broadcastEvent(event)

    if (getFinalizedChildRunStatus(childRunId)) return

    await touchInvocation(invocationId, currentNow(options))
  }

  async function finalizeChildRun(
    invocation: WorkerAgentInvocation,
    childRun: AgentRun,
    patch: { status: WorkerAgentInvocation['status']; completedAt: string; error?: RunError },
    event: AgentRuntimeEvent
  ): Promise<void> {
    if (!markChildRunFinalized(childRun.id, patch.status)) return

    const finalizedRun: AgentRun = {
      ...childRun,
      status: patch.status,
      endedAt: patch.completedAt,
      ...(patch.error ? { error: patch.error } : {})
    }
    await options.persistence.runs.save(finalizedRun)
    await updateInvocationRecord(invocation.id, {
      status: patch.status,
      completedAt: patch.completedAt,
      lastEventAt: patch.completedAt,
      ...(patch.error ? { error: patch.error } : {})
    })
    await broadcastEvent(event)
  }

  async function executeChildRun(
    invocation: WorkerAgentInvocation,
    childRun: AgentRun,
    input: SpawnWorkerAgentInput,
    effectiveAllowedToolIds: string[],
    role: Role,
    session: Session,
    controller: AbortController
  ): Promise<void> {
    try {
      if (getFinalizedChildRunStatus(childRun.id)) return

      const startedAt = childRun.startedAt ?? currentNow(options)
      await broadcastEvent({ type: 'run.started', runId: childRun.id, startedAt })
      await touchInvocation(invocation.id, currentNow(options))

      if (getFinalizedChildRunStatus(childRun.id)) return

      const prompt = options.promptAssembly.assembleWorkerAgentPrompt({
        session: {
          id: session.id,
          outputMode: session.outputMode,
          ...(session.workspacePath !== undefined ? { workspacePath: session.workspacePath } : {}),
          ...(session.enabledSkillIds !== undefined ? { enabledSkillIds: session.enabledSkillIds } : {})
        },
        role,
        skills: options.skills.list(),
        tools: options.tools.list(),
        task: input.task,
        ...(input.expectedOutput !== undefined ? { expectedOutput: input.expectedOutput } : {}),
        ...(input.contextSummary !== undefined ? { contextSummary: input.contextSummary } : {}),
        allowedToolIds: effectiveAllowedToolIds,
        depth: childRun.depth ?? 1,
        maxDepth: session.maxWorkerAgentDepth ?? 1,
        maxWorkerAgentsPerRun: session.maxWorkerAgentsPerRun ?? 10
      })

      await options.adapter.run(
        {
          runId: childRun.id,
          sessionId: childRun.sessionId,
          prompt: composeWorkerPrompt(input.task, input.contextSummary),
          modelId: childRun.modelId,
          ...(prompt.systemPrompt ? { systemPrompt: prompt.systemPrompt } : {}),
          enabledToolIds: effectiveAllowedToolIds,
          ...(childRun.workspacePath !== undefined ? { workspacePath: childRun.workspacePath } : {}),
          historyMessages: [],
          signal: controller.signal
        },
        (event) => handleChildEvent(invocation.id, childRun.id, event)
      )

      if (getFinalizedChildRunStatus(childRun.id)) return

      const endedAt = currentNow(options)
      await finalizeChildRun(invocation, childRun, { status: 'succeeded', completedAt: endedAt }, { type: 'run.succeeded', runId: childRun.id, endedAt })
    } catch (error) {
      if (getFinalizedChildRunStatus(childRun.id)?.status === 'cancelled') return

      const normalized = normalizeUnknownError(error)
      const status = controller.signal.aborted ? 'cancelled' : 'failed'
      const endedAt = currentNow(options)
      await finalizeChildRun(
        invocation,
        childRun,
        {
          status,
          completedAt: endedAt,
          ...(status === 'failed' ? { error: normalized } : {})
        },
        status === 'cancelled'
          ? { type: 'run.cancelled', runId: childRun.id, endedAt }
          : { type: 'run.failed', runId: childRun.id, error: normalized, endedAt }
      )
    } finally {
      const active = activeWorkers.get(invocation.id)
      if (active?.childRunId === childRun.id) {
        activeWorkers.delete(invocation.id)
      }
      if (childRunIdToInvocationId.get(childRun.id) === invocation.id) {
        childRunIdToInvocationId.delete(childRun.id)
      }
    }
  }

  async function spawn(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult> {
    const parsed = parseSpawnInput(input)
    const { parentRun, session } = await loadParentRunAndSession(context.runId, context.sessionId)

    const prepared = await withSpawnLock(parentRun.id, async (): Promise<SpawnPreparation> => {
      const maxWorkerAgentsPerRun = session.maxWorkerAgentsPerRun ?? 10
      const existingInvocations = await options.persistence.workerAgentInvocations.listByParentRun(parentRun.id)
      if (existingInvocations.length >= maxWorkerAgentsPerRun) {
        throw createLimitError(`Worker Agent invocation limit exceeded: ${existingInvocations.length} >= ${maxWorkerAgentsPerRun}`)
      }

      const roles = await options.roles.listRoles()
      const role = ensureWorkerRole(session, await options.roles.getRole(parsed.roleId), parsed.roleId, roles.filter(isAssignableWorkerRole))
      const depth = (parentRun.depth ?? 0) + 1
      const maxDepth = session.maxWorkerAgentDepth ?? 1
      if (depth > maxDepth) {
        throw createLimitError(`Worker Agent depth limit exceeded: ${depth} > ${maxDepth}`)
      }

      const effectiveAllowedToolIds = await resolveEffectiveAllowedToolIds(parsed.allowedToolIds, context.allowedToolIds, role.defaultToolIds)
      if (effectiveAllowedToolIds.length === 0) {
        throw createLimitError('Worker Agent has no allowed tools after filtering')
      }

      const invocationId = createWorkerAgentId()
      const childRunId = createId('run')
      const createdAt = currentNow(options)
      const startedAt = createdAt
      const invocation: WorkerAgentInvocation = {
        id: invocationId,
        parentRunId: parentRun.id,
        childRunId,
        ...(context.parentStepId !== undefined ? { parentStepId: context.parentStepId } : {}),
        ...(context.toolCallId !== undefined ? { parentToolCallId: context.toolCallId } : {}),
        task: parsed.task,
        roleId: role.id,
        allowedToolIds: effectiveAllowedToolIds,
        ...(role.defaultModelRef ? { modelRef: role.defaultModelRef } : {}),
        ...(parsed.expectedOutput !== undefined ? { expectedOutput: parsed.expectedOutput } : {}),
        ...(parsed.contextSummary !== undefined ? { contextSummary: parsed.contextSummary } : {}),
        status: 'running',
        lastEventAt: createdAt,
        createdAt
      }

      const childRunWorkspacePath = parentRun.workspacePath ?? session.workspacePath
      const childRun: AgentRun = {
        id: childRunId,
        sessionId: session.id,
        parentRunId: parentRun.id,
        workerAgentInvocationId: invocation.id,
        depth,
        status: 'running',
        modelId: role.defaultModelId ?? role.defaultModelRef?.modelId ?? parentRun.modelId,
        retryCount: 0,
        maxRetries: 0,
        ...(childRunWorkspacePath !== undefined ? { workspacePath: childRunWorkspacePath } : {}),
        startedAt
      }
      const activeWorker: ActiveWorker = {
        invocationId,
        childRunId,
        controller: new AbortController(),
        promise: Promise.resolve(),
        startedAt,
        lastEventAt: createdAt
      }

      try {
        await saveInvocation(invocation)
        await options.persistence.runs.save(childRun)
        childRunIdToInvocationId.set(childRunId, invocationId)
        activeWorkers.set(invocationId, activeWorker)
        await emitInvocationCreated(invocation)
        await broadcastEvent({ type: 'run.created', run: childRun })
        return { parsed, invocation, childRun, activeWorker, role, session, effectiveAllowedToolIds }
      } catch (error) {
        activeWorkers.delete(invocationId)
        childRunIdToInvocationId.delete(childRunId)
        throw error
      }
    })

    const childExecution = executeChildRun(
      prepared.invocation,
      prepared.childRun,
      prepared.parsed,
      prepared.effectiveAllowedToolIds,
      prepared.role,
      prepared.session,
      prepared.activeWorker.controller
    )
    prepared.activeWorker.promise = childExecution
    void childExecution.catch(() => undefined)

    if (prepared.parsed.wait === false) {
      return { ...prepared.invocation, invocationId: prepared.invocation.id, childRunId: prepared.childRun.id }
    }

    return wait({ invocationId: prepared.invocation.id, timeoutMs: prepared.parsed.timeoutMs, cancelOnTimeout: prepared.parsed.cancelOnTimeout }, context)
  }

  async function list(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentInvocation[]> {
    const parsed = parseListInput(input)
    const parentRunId = getParentRunId(parsed, context)
    const { parentRun } = await loadParentRunAndSession(parentRunId, context.sessionId)
    const invocations = await options.persistence.workerAgentInvocations.listByParentRun(parentRun.id)
    return parsed.status ? invocations.filter((invocation) => invocation.status === parsed.status) : invocations
  }

  async function get(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult> {
    const parsed = parseInvocationInput(input)
    await loadInvocationWithSession(parsed.invocationId, context)
    return buildSnapshot(parsed.invocationId)
  }

  async function wait(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult> {
    const parsed = parseWaitInput(input)
    const { invocation } = await loadInvocationWithSession(parsed.invocationId, context)
    const finalState = invocation.childRunId ? getFinalizedChildRunStatus(invocation.childRunId) : undefined
    if (finalState || invocation.status !== 'running') {
      return buildSnapshot(invocation.id)
    }

    const active = getActiveWorkerByInvocationId(invocation.id)
    if (!active) {
      return buildSnapshot(invocation.id)
    }

    const timeoutMs = boundedTimeoutMs(parsed.timeoutMs)
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs)
    })

    const race = await Promise.race([
      active.promise.then(() => 'done' as const),
      timeoutPromise
    ])

    if (timeoutHandle) clearTimeout(timeoutHandle)

    if (race === 'timeout') {
      const diagnosisSnapshot = await buildSnapshot(invocation.id, { timedOut: true })
      if (parsed.cancelOnTimeout) {
        const cancelled = await cancel({ invocationId: invocation.id }, context)
        return {
          ...cancelled,
          timedOut: true,
          ...(diagnosisSnapshot.diagnosis ? { diagnosis: diagnosisSnapshot.diagnosis } : {})
        }
      }
      return diagnosisSnapshot
    }

    return buildSnapshot(invocation.id)
  }

  async function cancel(input: Record<string, unknown>, context: ToolExecutionContext): Promise<WorkerAgentToolResult> {
    const parsed = parseCancelInput(input)
    const { invocation } = await loadInvocationWithSession(parsed.invocationId, context)
    const childRunId = invocation.childRunId
    if (!childRunId) throw createNotFoundError('Run', invocation.parentRunId)

    const finalState = getFinalizedChildRunStatus(childRunId)
    if (finalState) {
      return buildSnapshot(invocation.id)
    }

    const childRun = await options.persistence.runs.get(childRunId)
    if (!childRun) throw createNotFoundError('Run', childRunId)

    const active = getActiveWorkerByInvocationId(invocation.id)
    if (active?.childRunId === childRunId) {
      activeWorkers.delete(invocation.id)
    }
    if (childRunIdToInvocationId.get(childRunId) === invocation.id) {
      childRunIdToInvocationId.delete(childRunId)
    }

    const endedAt = currentNow(options)
    if (!markChildRunFinalized(childRun.id, 'cancelled')) {
      return buildSnapshot(invocation.id)
    }

    const cancelledRun: AgentRun = {
      ...childRun,
      status: 'cancelled',
      endedAt
    }
    await options.persistence.runs.save(cancelledRun)
    await updateInvocationRecord(invocation.id, {
      status: 'cancelled',
      completedAt: endedAt,
      lastEventAt: endedAt
    })
    active?.controller.abort()
    await broadcastEvent({ type: 'run.cancelled', runId: childRun.id, endedAt })

    return buildSnapshot(invocation.id)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    spawn,
    list,
    get,
    wait,
    cancel
  }
}
