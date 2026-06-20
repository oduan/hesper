import { createInMemoryPersistence } from '@hesper/persistence'
import type { AgentRun, AgentRuntimeEvent, Role, RunStep, Session, ToolDefinition } from '@hesper/shared'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentPromptInput } from '../adapters'
import { diagnoseWorkerAgent } from '../worker-agent-diagnosis'
import { createWorkerAgentService } from '../worker-agent-service'

type CreateHarnessOptions = {
  adapter?: AgentAdapter
  session?: Session
  roles?: Role[]
  parentRun?: Partial<AgentRun>
  now?: () => string
  filterEnabledToolIds?: (toolIds: string[]) => Promise<string[]>
  seedWorkerInvocations?: Array<Record<string, unknown>>
}

const baseNow = '2026-06-20T05:40:00.000Z'
const now = baseNow

function createIncrementingClock(start = baseNow, stepMs = 1000): () => string {
  let current = Date.parse(start) - stepMs
  return () => {
    current += stepMs
    return new Date(current).toISOString()
  }
}

function withTimeout(promise: Promise<any>, label: string, timeoutMs = 1500): Promise<any> {
  return Promise.race([
    promise,
    new Promise<any>((_, reject) => {
      setTimeout(() => reject(new Error(label)), timeoutMs)
    })
  ])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const defaultSession: Session = {
  id: 'session-1',
  title: 'Worker service',
  status: 'active',
  workspacePath: 'C:/workspace',
  outputMode: 'markdown',
  enabledToolIds: [
    'agent.spawn-worker-agent',
    'agent.list-worker-agents',
    'agent.get-worker-agent',
    'agent.wait-worker-agent',
    'agent.cancel-worker-agent',
    'filesystem.read-file',
    'filesystem.write-file'
  ],
  allowedWorkerAgentRoleIds: ['reviewer'],
  maxWorkerAgentDepth: 1,
  maxWorkerAgentsPerRun: 3,
  createdAt: baseNow,
  updatedAt: baseNow
}

const reviewerRole: Role = {
  id: 'reviewer',
  name: 'Reviewer',
  allowedSkillIds: [],
  defaultToolIds: ['filesystem.read-file', 'filesystem.write-file'],
  canBeMainAgent: false,
  canBeWorkerAgent: true,
  canBeAssignedToWorkerAgent: true
}

const blockedRole: Role = {
  id: 'blocked',
  name: 'Blocked',
  allowedSkillIds: [],
  defaultToolIds: ['filesystem.read-file'],
  canBeMainAgent: false,
  canBeWorkerAgent: false,
  canBeAssignedToWorkerAgent: false
}

const tools: ToolDefinition[] = [
  {
    id: 'filesystem.read-file',
    name: 'Read File',
    description: 'Read',
    category: 'filesystem',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    id: 'filesystem.write-file',
    name: 'Write File',
    description: 'Write',
    category: 'filesystem',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    id: 'agent.spawn-worker-agent',
    name: 'Spawn Worker Agent',
    description: 'Spawn',
    category: 'agent',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    id: 'agent.wait-worker-agent',
    name: 'Wait Worker Agent',
    description: 'Wait',
    category: 'agent',
    inputSchema: { type: 'object', properties: {} }
  }
]

class BlockingAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []
  readonly startedRunIds: string[] = []
  readonly abortedRunIds: string[] = []
  private readonly releases = new Map<string, () => void>()

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.startedRunIds.push(input.runId)
    await emit({ type: 'message.delta', runId: input.runId, delta: `started:${input.prompt}` })
    await new Promise<void>((resolve, reject) => {
      this.releases.set(input.runId, resolve)
      input.signal.addEventListener('abort', () => {
        this.abortedRunIds.push(input.runId)
        reject(new Error('aborted by test'))
      }, { once: true })
    })
  }

  finish(runId: string): void {
    this.releases.get(runId)?.()
  }
}

class FinishableAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []
  readonly startedRunIds: string[] = []
  private readonly releases = new Map<string, () => void>()

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.startedRunIds.push(input.runId)
    await emit({ type: 'message.delta', runId: input.runId, delta: `started:${input.prompt}` })
    await new Promise<void>((resolve, reject) => {
      this.releases.set(input.runId, resolve)
      input.signal.addEventListener('abort', () => reject(new Error('aborted by test')), { once: true })
    })
    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: `done:${input.prompt}`,
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-20T05:41:00.000Z'
      }
    })
  }

  finish(runId: string): void {
    this.releases.get(runId)?.()
  }
}

class AbortableAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []
  readonly startedRunIds: string[] = []
  readonly abortedRunIds: string[] = []
  private readonly releases = new Map<string, () => void>()

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.startedRunIds.push(input.runId)
    await emit({ type: 'message.delta', runId: input.runId, delta: `started:${input.prompt}` })
    await new Promise<void>((resolve, reject) => {
      this.releases.set(input.runId, resolve)
      input.signal.addEventListener('abort', () => {
        this.abortedRunIds.push(input.runId)
        resolve()
      }, { once: true })
    })
    throw new Error('aborted by test')
  }

  finish(runId: string): void {
    this.releases.get(runId)?.()
  }
}

class ProgressAdapter implements AgentAdapter {
  readonly inputs: AgentPromptInput[] = []
  readonly startedRunIds: string[] = []
  private readonly releases = new Map<string, () => void>()

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    this.inputs.push(input)
    this.startedRunIds.push(input.runId)
    await emit({
      type: 'step.created',
      step: {
        id: `step-${input.runId}-1`,
        runId: input.runId,
        type: 'tool_call',
        status: 'running',
        title: '检查上下文',
        createdAt: '2026-06-20T05:40:05.000Z'
      }
    })
    await new Promise<void>((resolve, reject) => {
      this.releases.set(input.runId, resolve)
      input.signal.addEventListener('abort', () => reject(new Error('aborted by test')), { once: true })
    })
    await emit({
      type: 'message.completed',
      message: {
        id: `message-${input.runId}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: `done:${input.prompt}`,
        contentType: 'markdown',
        runId: input.runId,
        createdAt: '2026-06-20T05:40:10.000Z'
      }
    })
  }

  finish(runId: string): void {
    this.releases.get(runId)?.()
  }
}

async function createHarness(options: CreateHarnessOptions = {}): Promise<any> {
  const session = options.session ?? defaultSession
  const roles = options.roles ?? [reviewerRole]
  const now = options.now ?? createIncrementingClock()
  const persistence = await createInMemoryPersistence()
  await persistence.sessions.save(session)
  const parentRun = {
    id: options.parentRun?.id ?? 'run-parent',
    sessionId: session.id,
    status: (options.parentRun?.status as AgentRun['status']) ?? 'running',
    modelId: options.parentRun?.modelId ?? 'mock/hesper-fast',
    retryCount: options.parentRun?.retryCount ?? 0,
    maxRetries: options.parentRun?.maxRetries ?? 0,
    ...(options.parentRun?.workspacePath !== undefined ? { workspacePath: options.parentRun.workspacePath } : session.workspacePath !== undefined ? { workspacePath: session.workspacePath } : {}),
    ...(options.parentRun?.depth !== undefined ? { depth: options.parentRun.depth } : {}),
    ...(options.parentRun?.startedAt !== undefined ? { startedAt: options.parentRun.startedAt } : { startedAt: baseNow }),
    ...(options.parentRun?.endedAt !== undefined ? { endedAt: options.parentRun.endedAt } : {}),
    ...(options.parentRun?.error !== undefined ? { error: options.parentRun.error } : {}),
    ...(options.parentRun?.parentRunId !== undefined ? { parentRunId: options.parentRun.parentRunId } : {}),
    ...(options.parentRun?.workerAgentInvocationId !== undefined ? { workerAgentInvocationId: options.parentRun.workerAgentInvocationId } : {})
  } as AgentRun
  await persistence.runs.save(parentRun)

  if (options.seedWorkerInvocations) {
    for (const invocation of options.seedWorkerInvocations) {
      await persistence.workerAgentInvocations.save(invocation as never)
    }
  }

  const adapter: any = options.adapter ?? new BlockingAdapter()
  const events: AgentRuntimeEvent[] = []
  const service = createWorkerAgentService({
    persistence,
    adapter,
    promptAssembly: {
      assembleWorkerAgentPrompt(input) {
        return {
          systemPrompt: `worker-system:${input.role.id}:${input.task}${input.contextSummary ? `\nContext summary: ${input.contextSummary}` : ''}`,
          toolManifest: 'tools',
          skillManifest: 'skills',
          roleManifest: 'roles',
          workerAgentRules: 'rules'
        }
      }
    },
    roles: {
      listRoles: () => [...roles],
      getRole: (id) => roles.find((role) => role.id === id)
    },
    skills: {
      list: () => []
    },
    tools: {
      list: () => [...tools],
      get: (id) => tools.find((tool) => tool.id === id)
    },
    filterEnabledToolIds: options.filterEnabledToolIds ?? (async (toolIds) => toolIds.filter((toolId) => toolId === 'filesystem.read-file')),
    emit: (event) => {
      events.push(event)
    },
    now
  })

  function createContext(overrides: Partial<{ runId: string; sessionId: string; workspacePath?: string; allowedToolIds: string[]; toolCallId?: string; parentStepId?: string }> = {}) {
    return {
      runId: overrides.runId ?? parentRun.id,
      sessionId: overrides.sessionId ?? session.id,
      allowedToolIds: overrides.allowedToolIds ?? [...(session.enabledToolIds ?? [])],
      ...(overrides.workspacePath !== undefined ? { workspacePath: overrides.workspacePath } : session.workspacePath !== undefined ? { workspacePath: session.workspacePath } : {}),
      ...(overrides.toolCallId !== undefined ? { toolCallId: overrides.toolCallId } : {}),
      ...(overrides.parentStepId !== undefined ? { parentStepId: overrides.parentStepId } : {})
    } as any
  }

  return { persistence, service, adapter, events, session, roles, parentRun, now, createContext } as any
}

describe('worker agent diagnosis', () => {
  it('classifies Worker Agent progress by idle time', () => {
    const activeStep: RunStep = {
      id: 'step-child-tool-1',
      runId: 'run-child',
      type: 'tool_call',
      status: 'running',
      title: '调用 filesystem.search',
      createdAt: '2026-06-20T05:39:00.000Z'
    }

    expect(diagnoseWorkerAgent({ startedAt: '2026-06-20T05:38:00.000Z', lastEventAt: '2026-06-20T05:39:50.000Z', now, activeStep })).toMatchObject({
      progressState: 'active',
      recommendation: 'continue_waiting'
    })
    expect(diagnoseWorkerAgent({ startedAt: '2026-06-20T05:38:00.000Z', lastEventAt: '2026-06-20T05:38:45.000Z', now, activeStep })).toMatchObject({
      progressState: 'quiet',
      recommendation: 'inspect'
    })
    expect(diagnoseWorkerAgent({ startedAt: '2026-06-20T05:35:00.000Z', lastEventAt: '2026-06-20T05:36:00.000Z', now, activeStep })).toMatchObject({
      progressState: 'possibly_stalled',
      recommendation: 'cancel_and_retry'
    })
  })
})

describe('worker agent service', () => {
  it('spawns wait:false Worker Agents as parallel child runs and lists them by parent run', async () => {
    const { service, adapter, persistence, events, createContext } = await createHarness({ adapter: new BlockingAdapter() })
    const first = await withTimeout(
      service.spawn(
        { task: 'review A', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file', 'filesystem.write-file', 'agent.spawn-worker-agent'], wait: false },
        createContext({ toolCallId: 'tool-a', parentStepId: 'step-run-parent-tool-tool-a' })
      ),
      'first spawn timed out'
    )
    const second = await withTimeout(
      service.spawn(
        { task: 'review B', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file', 'filesystem.write-file', 'agent.spawn-worker-agent'], wait: false },
        createContext({ toolCallId: 'tool-b', parentStepId: 'step-run-parent-tool-tool-b' })
      ),
      'second spawn timed out'
    )

    await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(2))

    expect(first).toMatchObject({
      parentRunId: 'run-parent',
      parentStepId: 'step-run-parent-tool-tool-a',
      status: 'running',
      invocationId: expect.stringMatching(/^worker-agent-/),
      childRunId: expect.stringMatching(/^run-/)
    })
    expect(second).toMatchObject({
      parentRunId: 'run-parent',
      parentStepId: 'step-run-parent-tool-tool-b',
      status: 'running',
      invocationId: expect.stringMatching(/^worker-agent-/),
      childRunId: expect.stringMatching(/^run-/)
    })
    expect(first.childRunId).not.toBe(second.childRunId)
    expect(adapter.inputs).toHaveLength(2)
    expect(adapter.inputs.map((input: AgentPromptInput) => input.enabledToolIds)).toEqual([['filesystem.read-file'], ['filesystem.read-file']])
    expect(await service.list({}, createContext())).toHaveLength(2)
    expect(await service.list({ status: 'running' }, createContext())).toHaveLength(2)
    expect(await persistence.workerAgentInvocations.listByParentRun('run-parent')).toHaveLength(2)
    expect(events.map((event: AgentRuntimeEvent) => event.type)).toEqual(expect.arrayContaining(['worker.invocation.created', 'run.created']))
  })

  it('passes contextSummary through to the worker prompt and adapter input', async () => {
    const { service, adapter, createContext } = await createHarness({ adapter: new BlockingAdapter() })
    const context = createContext({ toolCallId: 'tool-context', parentStepId: 'step-run-parent-tool-tool-context' })

    const spawned = await withTimeout(
      service.spawn(
        { task: 'review with context', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], contextSummary: 'Parent context', wait: false },
        context
      ),
      'spawn timed out'
    )

    await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))
    expect(spawned.status).toBe('running')
    expect(adapter.inputs[0]?.systemPrompt).toContain('Parent context')
    expect(adapter.inputs[0]?.prompt).toContain('Parent context')
  })

  it('serializes concurrent spawn attempts for the same parent run', async () => {
    const { service, persistence, adapter, createContext } = await createHarness({
      adapter: new BlockingAdapter(),
      session: { ...defaultSession, maxWorkerAgentsPerRun: 1 }
    })
    const originalListByParentRun = persistence.workerAgentInvocations.listByParentRun.bind(persistence.workerAgentInvocations)
    persistence.workerAgentInvocations.listByParentRun = async (parentRunId: string) => {
      await delay(25)
      return originalListByParentRun(parentRunId)
    }

    const context = createContext()
    const results = await Promise.allSettled([
      service.spawn({ task: 'first parallel', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, context),
      service.spawn({ task: 'second parallel', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, context)
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejection = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(String(rejection?.reason ?? '')).toContain('limit')
    await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))
    await expect(persistence.workerAgentInvocations.listByParentRun('run-parent')).resolves.toHaveLength(1)
  })

  it('returns a bounded wait diagnosis without cancelling by default', async () => {
    const { service, adapter, persistence, createContext } = await createHarness({ adapter: new BlockingAdapter() })
    const context = createContext({ toolCallId: 'tool-wait', parentStepId: 'step-run-parent-tool-tool-wait' })
    const spawned = await withTimeout(
      service.spawn({ task: 'slow review', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, context),
      'spawn timed out'
    )
    await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))

    const waited = await service.wait({ invocationId: spawned.invocationId, timeoutMs: 1 }, context)

    expect(waited).toMatchObject({
      invocationId: spawned.invocationId,
      childRunId: spawned.childRunId,
      status: 'running',
      timedOut: true,
      diagnosis: expect.objectContaining({ runningForMs: expect.any(Number) })
    })
    expect((await persistence.runs.get(spawned.childRunId))?.status).toBe('running')
    expect((await persistence.workerAgentInvocations.get(spawned.invocationId))?.status).toBe('running')
  })

  it('stores Worker result and makes it available via wait and get', async () => {
    const adapter = new FinishableAdapter()
    const { service, persistence, createContext } = await createHarness({ adapter })
    const context = createContext({ toolCallId: 'tool-result', parentStepId: 'step-run-parent-tool-tool-result' })
    const spawned = await withTimeout(
      service.spawn({ task: 'finish review', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, context),
      'spawn timed out'
    )
    await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))
    adapter.finish(spawned.childRunId)

    await vi.waitFor(async () => {
      const run = await persistence.runs.get(spawned.childRunId)
      expect(run?.status).toBe('succeeded')
    })

    const waited = await service.wait({ invocationId: spawned.invocationId, timeoutMs: 1000 }, context)
    const fetched = await service.get({ invocationId: spawned.invocationId }, context)

    expect(waited).toMatchObject({
      status: 'succeeded',
      result: {
        messageId: `message-${spawned.childRunId}`,
        content: 'done:finish review'
      }
    })
    expect(fetched).toMatchObject({
      status: 'succeeded',
      result: {
        messageId: `message-${spawned.childRunId}`,
        content: 'done:finish review'
      }
    })
    await expect(persistence.messages.listByRun(spawned.childRunId)).resolves.toEqual([
      expect.objectContaining({ id: `message-${spawned.childRunId}`, content: 'done:finish review' })
    ])
  })

  it('cancels an active Worker Agent and marks it cancelled', async () => {
    const adapter = new AbortableAdapter()
    const { service, persistence, createContext } = await createHarness({ adapter })
    const context = createContext({ toolCallId: 'tool-cancel', parentStepId: 'step-run-parent-tool-tool-cancel' })
    const spawned = await withTimeout(
      service.spawn({ task: 'cancel review', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, context),
      'spawn timed out'
    )
    await vi.waitFor(() => expect(adapter.startedRunIds).toHaveLength(1))

    await expect(service.cancel({ invocationId: spawned.invocationId, reason: 'test cancel' }, context)).resolves.toMatchObject({
      status: 'cancelled',
      invocationId: spawned.invocationId,
      childRunId: spawned.childRunId
    })
    await vi.waitFor(() => expect(adapter.abortedRunIds).toContain(spawned.childRunId))
    await vi.waitFor(async () => {
      const run = await persistence.runs.get(spawned.childRunId)
      expect(run?.status).toBe('cancelled')
    })
    await expect(persistence.workerAgentInvocations.get(spawned.invocationId)).resolves.toMatchObject({
      status: 'cancelled'
    })
    await expect(service.get({ invocationId: spawned.invocationId }, context)).resolves.toMatchObject({
      status: 'cancelled'
    })
  })

  it('allows assignable worker roles when the session has no explicit allowed worker role list', async () => {
    const { allowedWorkerAgentRoleIds: _allowedWorkerAgentRoleIds, ...sessionWithoutExplicitAllowedRoles } = defaultSession
    const { service, createContext } = await createHarness({
      session: sessionWithoutExplicitAllowedRoles
    })

    await expect(service.spawn({ task: 'review', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, createContext())).resolves.toMatchObject({
      roleId: 'reviewer',
      status: 'running'
    })
  })

  it('denies cross-session access to worker invocations', async () => {
    const { service, createContext } = await createHarness()
    const spawned = await withTimeout(
      service.spawn({ task: 'review secret', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, createContext()),
      'spawn timed out'
    )

    const foreignContext = {
      runId: 'run-foreign',
      sessionId: 'session-foreign',
      workspacePath: 'C:/workspace',
      allowedToolIds: ['filesystem.read-file']
    }

    await expect(service.get({ invocationId: spawned.invocationId }, foreignContext)).rejects.toThrow('Worker Agent access denied')
    await expect(service.list({ parentRunId: 'run-parent' }, foreignContext)).rejects.toThrow('Worker Agent access denied')
  })

  it('enforces role and tool limits', async () => {
    const blockedHarness = await createHarness({ roles: [blockedRole] })
    await expect(
      blockedHarness.service.spawn(
        { task: 'blocked role', roleId: 'blocked', allowedToolIds: ['filesystem.read-file'], wait: false },
        blockedHarness.createContext()
      )
    ).rejects.toThrow(/role/i)

    const { service, createContext } = await createHarness({
      filterEnabledToolIds: async (toolIds) => toolIds.filter((toolId) => toolId === 'filesystem.read-file')
    })
    await expect(
      service.spawn(
        { task: 'no tools', roleId: 'reviewer', allowedToolIds: ['agent.spawn-worker-agent'], wait: false },
        createContext()
      )
    ).rejects.toThrow(/allowed tools/i)
  })

  it('enforces depth and count limits', async () => {
    const depthHarness = await createHarness({
      parentRun: { depth: 1 },
      session: { ...defaultSession, maxWorkerAgentDepth: 1 }
    })
    await expect(
      depthHarness.service.spawn(
        { task: 'too deep', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false },
        depthHarness.createContext()
      )
    ).rejects.toThrow(/depth/i)

    const countSeed = {
      id: 'worker-agent-seeded',
      parentRunId: 'run-parent',
      childRunId: 'run-child-seeded',
      task: 'seed',
      roleId: 'reviewer',
      allowedToolIds: ['filesystem.read-file'],
      status: 'running' as const,
      createdAt: baseNow,
      lastEventAt: baseNow
    }
    const countHarness = await createHarness({
      session: { ...defaultSession, maxWorkerAgentsPerRun: 1 },
      seedWorkerInvocations: [countSeed]
    })
    await expect(
      countHarness.service.spawn(
        { task: 'too many', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false },
        countHarness.createContext()
      )
    ).rejects.toThrow(/limit/i)
  })

  it('updates worker invocation lastEventAt when child events arrive', async () => {
    const adapter = new ProgressAdapter()
    const clock = createIncrementingClock()
    const { service, persistence, createContext } = await createHarness({ adapter, now: clock })
    const context = createContext({ toolCallId: 'tool-progress', parentStepId: 'step-run-parent-tool-tool-progress' })
    const spawned = await withTimeout(
      service.spawn({ task: 'track progress', roleId: 'reviewer', allowedToolIds: ['filesystem.read-file'], wait: false }, context),
      'spawn timed out'
    )
    await vi.waitFor(async () => {
      const invocation = await persistence.workerAgentInvocations.get(spawned.invocationId)
      expect(invocation).toBeDefined()
      expect(Date.parse(String(invocation!.lastEventAt ?? invocation!.createdAt))).toBeGreaterThan(Date.parse(invocation!.createdAt))
    })
    await expect(persistence.steps.listByRun(spawned.childRunId)).resolves.toEqual([
      expect.objectContaining({ id: `step-${spawned.childRunId}-1`, title: '检查上下文' })
    ])

    adapter.finish(spawned.childRunId)
    await vi.waitFor(async () => {
      const run = await persistence.runs.get(spawned.childRunId)
      expect(run?.status).toBe('succeeded')
    })
  })
})
