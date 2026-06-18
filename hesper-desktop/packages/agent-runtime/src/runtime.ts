import type { Persistence } from '@hesper/persistence'
import { createId, nowIso, type AgentRun, type AgentRuntimeEvent, type Message, type RunError, type RunStep } from '@hesper/shared'
import type { AgentAdapter } from './adapters'
import { normalizeUnknownError } from './adapters'
import { clearPiEventRunState } from './map-pi-event'
import { defaultRetryPolicy, getRetryDelayMs, isRetryableRunError, type RetryPolicy } from './retry-policy'

export type EnqueueRunInput = {
  sessionId: string
  prompt: string
  modelId: string
  systemPrompt?: string
  enabledToolIds?: string[]
  workspacePath?: string
  parentRunId?: string
}

export type AgentRuntimeOptions = {
  persistence: Persistence
  adapter: AgentAdapter
  retryPolicy?: RetryPolicy
}

type RuntimeListener = (event: AgentRuntimeEvent) => void | Promise<void>
type SessionState = {
  running: boolean
  queue: Array<{ run: AgentRun; prompt: string; systemPrompt?: string; enabledToolIds?: string[] }>
  active: Promise<void> | undefined
  activeRunId: string | undefined
  waiters: Array<() => void>
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createMissingSessionError(sessionId: string): Error {
  return new Error(`Session not found: ${sessionId}`)
}

function runIdFromEvent(event: AgentRuntimeEvent): string | undefined {
  if (event.type === 'run.created') return event.run.id
  if (event.type === 'step.created' || event.type === 'step.updated') return event.step.runId
  if (event.type === 'message.completed') return event.message.runId
  if ('runId' in event && typeof event.runId === 'string') return event.runId
  return undefined
}

function compareMessages(left: Message, right: Message): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

export class AgentRuntime {
  private readonly persistence: Persistence
  private readonly adapter: AgentAdapter
  private readonly retryPolicy: RetryPolicy
  private readonly listeners = new Set<RuntimeListener>()
  private readonly sessionStates = new Map<string, SessionState>()
  private readonly enqueueChains = new Map<string, Promise<void>>()
  private readonly terminatedRuns = new Map<string, RunError>()

  constructor(options: AgentRuntimeOptions) {
    this.persistence = options.persistence
    this.adapter = options.adapter
    this.retryPolicy = options.retryPolicy ?? defaultRetryPolicy
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async enqueue(input: EnqueueRunInput): Promise<AgentRun> {
    return this.withSessionEnqueueLock(input.sessionId, async () => {
      const session = await this.persistence.sessions.get(input.sessionId)
      if (!session || session.status === 'deleted') throw createMissingSessionError(input.sessionId)

      const state = this.getSessionState(input.sessionId)
      const shouldStartImmediately = !state.running
      const timestamp = nowIso()
      const run: AgentRun = {
        id: createId('run'),
        sessionId: input.sessionId,
        status: shouldStartImmediately ? 'running' : 'queued',
        modelId: input.modelId,
        retryCount: 0,
        maxRetries: this.retryPolicy.maxRetries,
        ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {}),
        ...(input.parentRunId !== undefined ? { parentRunId: input.parentRunId } : {}),
        ...(shouldStartImmediately ? { startedAt: timestamp } : {})
      }

      if (shouldStartImmediately) {
        state.running = true
      }

      await this.persistence.runs.save(run)
      await this.emitAndPersist({ type: 'run.created', run })

      if (!shouldStartImmediately) {
        state.queue.push({
          run,
          prompt: input.prompt,
          ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
          ...(input.enabledToolIds !== undefined ? { enabledToolIds: input.enabledToolIds } : {})
        })
        return run
      }

      this.startSessionRun(input.sessionId, run, input.prompt, input.systemPrompt, input.enabledToolIds)
      return run
    })
  }

  async waitForIdle(sessionId: string): Promise<void> {
    const state = this.sessionStates.get(sessionId)
    if (!state || (!state.running && state.queue.length === 0 && !state.active)) return

    await new Promise<void>((resolve) => {
      const current = this.getSessionState(sessionId)
      if (!current.running && current.queue.length === 0 && !current.active) {
        resolve()
        return
      }
      current.waiters.push(resolve)
    })
  }

  async failRun(runId: string, error: unknown): Promise<AgentRun | undefined> {
    const normalized = normalizeUnknownError(error)
    const existing = await this.persistence.runs.get(runId)
    if (!existing) return undefined

    this.terminatedRuns.set(runId, normalized)
    for (const state of this.sessionStates.values()) {
      state.queue = state.queue.filter((entry) => entry.run.id !== runId)
    }

    const failedRun = await this.persistFailedRun(existing, normalized)
    clearPiEventRunState(runId)
    await this.emitAndPersist({ type: 'run.failed', runId, error: normalized })

    if (!this.isActiveRun(runId)) {
      this.terminatedRuns.delete(runId)
    }

    return failedRun
  }

  private getSessionState(sessionId: string): SessionState {
    const existing = this.sessionStates.get(sessionId)
    if (existing) return existing

    const created: SessionState = { running: false, queue: [], active: undefined, activeRunId: undefined, waiters: [] }
    this.sessionStates.set(sessionId, created)
    return created
  }

  private async withSessionEnqueueLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.enqueueChains.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = previous.then(() => current)
    this.enqueueChains.set(sessionId, chained)

    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.enqueueChains.get(sessionId) === chained) {
        this.enqueueChains.delete(sessionId)
      }
    }
  }

  private startSessionRun(sessionId: string, run: AgentRun, prompt: string, systemPrompt?: string, enabledToolIds?: string[]): void {
    const state = this.getSessionState(sessionId)
    state.running = true
    state.activeRunId = run.id
    state.active = this.executeRun(run, prompt, systemPrompt, enabledToolIds)
      .then(() => this.finishRun(sessionId))
      .catch(() => this.finishRun(sessionId))
  }

  private async finishRun(sessionId: string): Promise<void> {
    const state = this.getSessionState(sessionId)
    const next = state.queue.shift()

    if (next) {
      const startedAt = nowIso()
      const runningRun: AgentRun = {
        ...next.run,
        status: 'running',
        startedAt
      }
      this.startSessionRun(sessionId, runningRun, next.prompt, next.systemPrompt, next.enabledToolIds)
      return
    }

    state.running = false
    state.active = undefined
    state.activeRunId = undefined

    const lateQueued = state.queue.shift()
    if (lateQueued) {
      const startedAt = nowIso()
      const runningRun: AgentRun = {
        ...lateQueued.run,
        status: 'running',
        startedAt
      }
      this.startSessionRun(sessionId, runningRun, lateQueued.prompt, lateQueued.systemPrompt, lateQueued.enabledToolIds)
      return
    }

    const waiters = state.waiters.splice(0)
    this.sessionStates.delete(sessionId)
    for (const resolve of waiters) resolve()
  }

  private isActiveRun(runId: string): boolean {
    return [...this.sessionStates.values()].some((state) => state.activeRunId === runId)
  }

  private async persistFailedRun(run: AgentRun, error: RunError): Promise<AgentRun> {
    const failedRun: AgentRun = {
      ...run,
      status: 'failed',
      endedAt: nowIso(),
      error
    }
    await this.persistence.runs.save(failedRun)
    return failedRun
  }

  private async applyTerminationIfNeeded(runId: string): Promise<boolean> {
    const error = this.terminatedRuns.get(runId)
    if (!error) return false

    const latest = await this.persistence.runs.get(runId)
    if (latest && latest.status !== 'failed') {
      await this.persistFailedRun(latest, error)
    }
    clearPiEventRunState(runId)
    return true
  }

  private async executeRun(run: AgentRun, prompt: string, systemPrompt?: string, enabledToolIds?: string[]): Promise<void> {
    try {
      const current: AgentRun = { ...run, status: 'running', startedAt: run.startedAt ?? nowIso() }
      await this.persistence.runs.save(current)
      await this.emitAndPersist({ type: 'run.started', runId: current.id })

      let latestRun = current
      let attempt = latestRun.retryCount
      const historyMessages = (await this.persistence.messages.listBySession(current.sessionId))
        .filter((message) => message.runId !== current.id)
        .sort(compareMessages)

      while (true) {
        if (await this.applyTerminationIfNeeded(latestRun.id)) {
          return
        }

        const controller = new AbortController()
        try {
        await this.adapter.run(
          {
            runId: latestRun.id,
            sessionId: latestRun.sessionId,
            prompt,
            modelId: latestRun.modelId,
            ...(systemPrompt !== undefined ? { systemPrompt } : {}),
            ...(enabledToolIds !== undefined ? { enabledToolIds } : {}),
            ...(latestRun.workspacePath !== undefined ? { workspacePath: latestRun.workspacePath } : {}),
            historyMessages,
            signal: controller.signal
          },
          async (event) => this.handleAdapterEvent(event)
        )

        if (await this.applyTerminationIfNeeded(latestRun.id)) {
          return
        }

        latestRun = {
          ...latestRun,
          status: 'succeeded',
          endedAt: nowIso()
        } satisfies AgentRun
        await this.persistence.runs.save(latestRun)
        if (await this.applyTerminationIfNeeded(latestRun.id)) {
          return
        }
        clearPiEventRunState(latestRun.id)
        await this.emitAndPersist({ type: 'run.succeeded', runId: latestRun.id })
        return
      } catch (error) {
        const normalized = normalizeUnknownError(error)
        if (await this.applyTerminationIfNeeded(latestRun.id)) {
          return
        }
        if (isRetryableRunError(normalized, this.retryPolicy) && attempt < this.retryPolicy.maxRetries) {
          const delayMs = getRetryDelayMs(this.retryPolicy, attempt)
          attempt += 1
          latestRun = {
            ...latestRun,
            retryCount: attempt
          }
          await this.persistence.runs.save(latestRun)
          await this.emitAndPersist({
            type: 'run.retrying',
            runId: latestRun.id,
            retryCount: attempt,
            nextRetryAt: new Date(Date.now() + delayMs).toISOString()
          })
          await sleep(delayMs)
          continue
        }

        latestRun = {
          ...latestRun,
          status: 'failed',
          retryCount: attempt,
          endedAt: nowIso(),
          error: normalized
        } satisfies AgentRun
        await this.persistence.runs.save(latestRun)
        clearPiEventRunState(latestRun.id)
        await this.emitAndPersist({ type: 'run.failed', runId: latestRun.id, error: normalized })
        return
      }
    }
    } finally {
      this.terminatedRuns.delete(run.id)
    }
  }

  private async handleAdapterEvent(event: AgentRuntimeEvent): Promise<void> {
    const eventRunId = runIdFromEvent(event)
    if (eventRunId && this.terminatedRuns.has(eventRunId)) {
      return
    }
    if (event.type === 'step.created' || event.type === 'step.updated') {
      await this.persistence.steps.save(event.step as RunStep)
    }
    if (event.type === 'message.completed') {
      await this.persistence.messages.save(event.message as Message)
    }
    await this.emitAndPersist(event)
  }

  private async emitAndPersist(event: AgentRuntimeEvent): Promise<void> {
    await this.persistence.events.append(event)
    for (const listener of this.listeners) {
      try {
        await listener(event)
      } catch (error) {
        console.error('AgentRuntime listener failed', error)
      }
    }
  }
}
