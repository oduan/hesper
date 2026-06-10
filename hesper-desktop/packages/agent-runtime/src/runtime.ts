import type { Persistence } from '@hesper/persistence'
import { createId, nowIso, type AgentRun, type AgentRuntimeEvent, type Message, type RunStep } from '@hesper/shared'
import type { AgentAdapter } from './adapters'
import { normalizeUnknownError } from './adapters'
import { defaultRetryPolicy, getRetryDelayMs, isRetryableRunError, type RetryPolicy } from './retry-policy'

export type EnqueueRunInput = {
  sessionId: string
  prompt: string
  modelId: string
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
  queue: Array<{ run: AgentRun; prompt: string }>
  active: Promise<void> | undefined
  waiters: Array<() => void>
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createMissingSessionError(sessionId: string): Error {
  return new Error(`Session not found: ${sessionId}`)
}

export class AgentRuntime {
  private readonly persistence: Persistence
  private readonly adapter: AgentAdapter
  private readonly retryPolicy: RetryPolicy
  private readonly listeners = new Set<RuntimeListener>()
  private readonly sessionStates = new Map<string, SessionState>()

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
    const session = await this.persistence.sessions.get(input.sessionId)
    if (!session || session.status === 'deleted') throw createMissingSessionError(input.sessionId)

    const state = this.getSessionState(input.sessionId)
    const timestamp = nowIso()
    const run: AgentRun = {
      id: createId('run'),
      sessionId: input.sessionId,
      status: state.running ? 'queued' : 'running',
      modelId: input.modelId,
      retryCount: 0,
      maxRetries: this.retryPolicy.maxRetries,
      ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {}),
      ...(input.parentRunId !== undefined ? { parentRunId: input.parentRunId } : {}),
      ...(!state.running ? { startedAt: timestamp } : {})
    }

    await this.persistence.runs.save(run)
    await this.emitAndPersist({ type: 'run.created', run })

    if (state.running) {
      state.queue.push({ run, prompt: input.prompt })
      return run
    }

    this.startSessionRun(input.sessionId, run, input.prompt)
    return run
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

  private getSessionState(sessionId: string): SessionState {
    const existing = this.sessionStates.get(sessionId)
    if (existing) return existing

    const created: SessionState = { running: false, queue: [], active: undefined, waiters: [] }
    this.sessionStates.set(sessionId, created)
    return created
  }

  private startSessionRun(sessionId: string, run: AgentRun, prompt: string): void {
    const state = this.getSessionState(sessionId)
    state.running = true
    state.active = this.executeRun(run, prompt)
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
      this.startSessionRun(sessionId, runningRun, next.prompt)
      return
    }

    state.running = false
    state.active = undefined
    const waiters = state.waiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  private async executeRun(run: AgentRun, prompt: string): Promise<void> {
    const current: AgentRun = { ...run, status: 'running', startedAt: run.startedAt ?? nowIso() }
    await this.persistence.runs.save(current)
    await this.emitAndPersist({ type: 'run.started', runId: current.id })

    let latestRun = current
    let attempt = latestRun.retryCount

    while (true) {
      const controller = new AbortController()
      try {
        await this.adapter.run(
          {
            runId: latestRun.id,
            sessionId: latestRun.sessionId,
            prompt,
            modelId: latestRun.modelId,
            ...(latestRun.workspacePath !== undefined ? { workspacePath: latestRun.workspacePath } : {}),
            signal: controller.signal
          },
          async (event) => this.handleAdapterEvent(event)
        )

        latestRun = {
          ...latestRun,
          status: 'succeeded',
          endedAt: nowIso()
        } satisfies AgentRun
        await this.persistence.runs.save(latestRun)
        await this.emitAndPersist({ type: 'run.succeeded', runId: latestRun.id })
        return
      } catch (error) {
        const normalized = normalizeUnknownError(error)
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
        await this.emitAndPersist({ type: 'run.failed', runId: latestRun.id, error: normalized })
        return
      }
    }
  }

  private async handleAdapterEvent(event: AgentRuntimeEvent): Promise<void> {
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
      await listener(event)
    }
  }
}
