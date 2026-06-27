import type { Persistence } from '@hesper/persistence'
import { createId, nowIso, type AgentRun, type AgentRuntimeEvent, type Message, type MessageAttachment, type ModelThinkingLevel, type RunContextItem, type RunError, type RunStep } from '@hesper/shared'
import type { AgentAdapter, AttachmentReader } from './adapters'
import { normalizeUnknownError } from './adapters'
import { checkContextBudget } from './context-budget'
import { assembleHistoryMessages } from './context-assembler'
import { isContextOverflowError, MAX_OVERFLOW_RETRIES, nextOverflowAttempt } from './context-overflow'
import { buildRunContextItem } from './context-item'
import { clearPiEventRunState } from './map-pi-event'
import { clearPiToolRunState } from './pi-tools'
import { estimateRenderedTextAttachmentLength } from './prompt-attachments'
import { defaultRetryPolicy, getRetryDelayMs, isRetryableRunError, type RetryPolicy } from './retry-policy'
import { buildSessionCompaction } from './session-compaction'

export type EnqueueRunInput = {
  sessionId: string
  prompt: string
  modelId: string
  thinkingLevel?: ModelThinkingLevel
  systemPrompt?: string
  enabledToolIds?: string[]
  workspacePath?: string
  parentRunId?: string
  attachments?: MessageAttachment[]
  attachmentReader?: AttachmentReader
}

export type AgentRuntimeOptions = {
  persistence: Persistence
  adapter: AgentAdapter
  retryPolicy?: RetryPolicy
}

type RuntimeListener = (event: AgentRuntimeEvent) => void | Promise<void>
type QueuedRunEntry = {
  run: AgentRun
  prompt: string
  thinkingLevel?: ModelThinkingLevel
  systemPrompt?: string
  enabledToolIds?: string[]
  attachments?: MessageAttachment[]
  attachmentReader?: AttachmentReader
}
type SessionState = {
  running: boolean
  queue: QueuedRunEntry[]
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
  if (event.type === 'worker.invocation.created' || event.type === 'worker.invocation.updated') {
    return event.invocation.childRunId ?? event.invocation.parentRunId
  }
  if (event.type === 'message.completed') return event.message.runId
  if ('runId' in event && typeof event.runId === 'string') return event.runId
  return undefined
}

function groupContextItemsByRunId(items: RunContextItem[]): Map<string, RunContextItem[]> {
  const byRunId = new Map<string, RunContextItem[]>()
  for (const item of items) {
    const runItems = byRunId.get(item.runId) ?? []
    runItems.push(item)
    byRunId.set(item.runId, runItems)
  }
  return byRunId
}

function groupMessagesByRunId(messages: Message[]): Map<string, Message[]> {
  const byRunId = new Map<string, Message[]>()
  for (const message of messages) {
    if (!message.runId) continue
    const runMessages = byRunId.get(message.runId) ?? []
    runMessages.push(message)
    byRunId.set(message.runId, runMessages)
  }
  for (const [runId, runMessages] of byRunId) {
    byRunId.set(runId, [...runMessages].sort(compareMessages))
  }
  return byRunId
}

function hasPersistedRunSummary(items: RunContextItem[] | undefined): boolean {
  return Boolean(items?.some((item) => item.kind === 'run_summary' && item.content.trim()))
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareRuns(left: AgentRun, right: AgentRun): number {
  const leftTime = left.startedAt ?? left.endedAt ?? ''
  const rightTime = right.startedAt ?? right.endedAt ?? ''
  return stableCompare(leftTime, rightTime) || stableCompare(left.id, right.id)
}

function compareMessages(left: Message, right: Message): number {
  return stableCompare(left.createdAt, right.createdAt) || stableCompare(left.id, right.id)
}

function compareContextItemsByPreference(left: RunContextItem, right: RunContextItem): number {
  return (right.version - left.version) || stableCompare(right.createdAt, left.createdAt) || stableCompare(left.id, right.id)
}

function persistedRunSummaryItem(items: RunContextItem[] | undefined): RunContextItem | undefined {
  return items
    ?.filter((item) => item.kind === 'run_summary' && item.content.trim())
    .sort(compareContextItemsByPreference)[0]
}

function reservedOutputTokensForWindow(contextWindow: number): number {
  return Math.max(32, Math.min(1024, Math.floor(contextWindow * 0.2)))
}

function safetyMarginForWindow(contextWindow: number): number {
  return Math.max(16, Math.min(512, Math.floor(contextWindow * 0.05)))
}

export const DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW = 128_000

const RECENT_MESSAGE_RUN_COUNT = 1
const SESSION_COMPACTION_MAX_CHARS_BY_ATTEMPT = [4000, 2000, 1000] as const
const SESSION_COMPACTION_PENDING_TITLE = '正在进行压缩'
const SESSION_COMPACTION_SUCCEEDED_TITLE = '压缩完成，继续执行'

type SessionHistorySnapshot = {
  sessionMessages: Message[]
  sessionRuns: AgentRun[]
  contextItemsByRunId: Map<string, RunContextItem[]>
  messagesByRunId: Map<string, Message[]>
  stepsByRunId: Map<string, RunStep[]>
  previousParentRuns: AgentRun[]
  historyMessages: Message[]
}

type SessionCompactionApplication = {
  historyMessages: Message[]
  changed: boolean
  attempted: boolean
}

function totalHistoryContentLength(messages: Message[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

function sameHistoryMessages(left: Message[], right: Message[]): boolean {
  if (left.length !== right.length) return false
  return left.every((message, index) => {
    const other = right[index]
    return other !== undefined &&
      message.id === other.id &&
      message.role === other.role &&
      message.content === other.content &&
      message.createdAt === other.createdAt
  })
}

function didHistoryBecomeShorter(previous: Message[], next: Message[]): boolean {
  if (sameHistoryMessages(previous, next)) return false
  return totalHistoryContentLength(next) < totalHistoryContentLength(previous)
}

export class AgentRuntime {
  private readonly persistence: Persistence
  private readonly adapter: AgentAdapter
  private readonly retryPolicy: RetryPolicy
  private readonly listeners = new Set<RuntimeListener>()
  private readonly sessionStates = new Map<string, SessionState>()
  private readonly enqueueChains = new Map<string, Promise<void>>()
  private readonly terminatedRuns = new Map<string, RunError>()
  private readonly cancelledRuns = new Set<string>()
  private readonly activeControllers = new Map<string, AbortController>()

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
      const workspacePath = input.workspacePath ?? session.workspacePath
      const run: AgentRun = {
        id: createId('run'),
        sessionId: input.sessionId,
        status: shouldStartImmediately ? 'running' : 'queued',
        modelId: input.modelId,
        retryCount: 0,
        maxRetries: this.retryPolicy.maxRetries,
        ...(workspacePath !== undefined ? { workspacePath } : {}),
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
          ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
          ...(input.enabledToolIds !== undefined ? { enabledToolIds: input.enabledToolIds } : {}),
          ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
          ...(input.attachmentReader !== undefined ? { attachmentReader: input.attachmentReader } : {})
        })
        return run
      }

      this.startSessionRun(input.sessionId, run, input.prompt, input.thinkingLevel, input.systemPrompt, input.enabledToolIds, input.attachments, input.attachmentReader)
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
    await this.persistRunContextItem(failedRun)
    clearPiEventRunState(runId)
    clearPiToolRunState(runId)
    await this.emitAndPersist({ type: 'run.failed', runId, error: normalized, ...(failedRun.endedAt ? { endedAt: failedRun.endedAt } : {}) })
    this.activeControllers.get(runId)?.abort()

    if (!this.isActiveRun(runId)) {
      this.terminatedRuns.delete(runId)
    }

    return failedRun
  }

  async cancelRun(runId: string): Promise<AgentRun | undefined> {
    const existing = await this.persistence.runs.get(runId)
    if (!existing) return undefined
    if (existing.status === 'succeeded' || existing.status === 'failed' || existing.status === 'cancelled') {
      return existing
    }

    this.cancelledRuns.add(runId)
    for (const state of this.sessionStates.values()) {
      state.queue = state.queue.filter((entry) => entry.run.id !== runId)
    }

    const cancelledRun = await this.persistCancelledRun(existing)
    clearPiEventRunState(runId)
    clearPiToolRunState(runId)
    await this.emitAndPersist({ type: 'run.cancelled', runId, ...(cancelledRun.endedAt ? { endedAt: cancelledRun.endedAt } : {}) })
    this.activeControllers.get(runId)?.abort()

    if (!this.isActiveRun(runId)) {
      this.cancelledRuns.delete(runId)
    }

    return cancelledRun
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

  private startSessionRun(sessionId: string, run: AgentRun, prompt: string, thinkingLevel?: ModelThinkingLevel, systemPrompt?: string, enabledToolIds?: string[], attachments?: MessageAttachment[], attachmentReader?: AttachmentReader): void {
    const state = this.getSessionState(sessionId)
    state.running = true
    state.activeRunId = run.id
    state.active = this.executeRun(run, prompt, thinkingLevel, systemPrompt, enabledToolIds, attachments, attachmentReader)
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
      this.startSessionRun(sessionId, runningRun, next.prompt, next.thinkingLevel, next.systemPrompt, next.enabledToolIds, next.attachments, next.attachmentReader)
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
      this.startSessionRun(sessionId, runningRun, lateQueued.prompt, lateQueued.thinkingLevel, lateQueued.systemPrompt, lateQueued.enabledToolIds, lateQueued.attachments, lateQueued.attachmentReader)
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

  private async persistCancelledRun(run: AgentRun): Promise<AgentRun> {
    const cancelledRun: AgentRun = {
      ...run,
      status: 'cancelled',
      endedAt: run.endedAt ?? nowIso()
    }
    await this.persistence.runs.save(cancelledRun)
    return cancelledRun
  }

  private async applyCancellationIfNeeded(runId: string): Promise<boolean> {
    if (!this.cancelledRuns.has(runId)) return false

    const latest = await this.persistence.runs.get(runId)
    if (latest && latest.status !== 'cancelled') {
      await this.persistCancelledRun(latest)
    }
    clearPiEventRunState(runId)
    clearPiToolRunState(runId)
    return true
  }

  private async applyTerminationIfNeeded(runId: string): Promise<boolean> {
    const error = this.terminatedRuns.get(runId)
    if (!error) return false

    const latest = await this.persistence.runs.get(runId)
    if (latest && latest.status !== 'failed') {
      const failedRun = await this.persistFailedRun(latest, error)
      await this.persistRunContextItem(failedRun)
    }
    clearPiEventRunState(runId)
    clearPiToolRunState(runId)
    return true
  }

  private async persistRunContextItem(run: AgentRun): Promise<void> {
    if (run.parentRunId !== undefined) return
    try {
      const messages = await this.persistence.messages.listByRun(run.id)
      const steps = await this.persistence.steps.listByRun(run.id)
      const item = buildRunContextItem({
        run,
        messages,
        steps,
        createdAt: run.endedAt ?? nowIso()
      })
      if (item) await this.persistence.contextItems.save(item)
    } catch (error) {
      console.error('AgentRuntime context item persistence failed', error)
    }
  }

  private async loadSessionHistorySnapshot(currentRun: AgentRun): Promise<SessionHistorySnapshot> {
    const sessionMessages = await this.persistence.messages.listBySession(currentRun.sessionId)
    const sessionRuns = await this.persistence.runs.listBySession(currentRun.sessionId)
    const contextItemsByRunId = groupContextItemsByRunId(await this.persistence.contextItems.listBySession(currentRun.sessionId))
    const messagesByRunId = groupMessagesByRunId(sessionMessages)
    const previousParentRuns = sessionRuns
      .filter((candidate) => candidate.id !== currentRun.id && candidate.parentRunId === undefined)
      .sort(compareRuns)
    const stepsByRunId = new Map<string, RunStep[]>()

    for (const previousRun of previousParentRuns) {
      if (hasPersistedRunSummary(contextItemsByRunId.get(previousRun.id))) continue
      stepsByRunId.set(previousRun.id, await this.persistence.steps.listByRun(previousRun.id))
    }

    return {
      sessionMessages,
      sessionRuns,
      contextItemsByRunId,
      messagesByRunId,
      stepsByRunId,
      previousParentRuns,
      historyMessages: assembleHistoryMessages({
        currentRunId: currentRun.id,
        runs: sessionRuns,
        messages: sessionMessages,
        stepsByRunId,
        contextItemsByRunId
      })
    }
  }

  private async maybeApplyLocalSessionCompaction(currentRun: AgentRun, prompt: string, systemPrompt: string | undefined, attachments: MessageAttachment[] | undefined, attachmentReader: AttachmentReader | undefined, snapshot: SessionHistorySnapshot): Promise<SessionCompactionApplication> {
    const model = await this.persistence.models.get(currentRun.modelId)
    const modelContextWindow = model?.contextWindow ?? DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW

    const renderedAttachmentTextLengths = attachmentReader === undefined
      ? undefined
      : attachments
        ?.filter((attachment) => attachment.kind === 'text')
        .map((attachment) => estimateRenderedTextAttachmentLength(attachment))

    const budget = checkContextBudget({
      modelContextWindow,
      reservedOutputTokens: reservedOutputTokensForWindow(modelContextWindow),
      safetyMargin: safetyMarginForWindow(modelContextWindow),
      prompt,
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      historyMessages: snapshot.historyMessages,
      ...(renderedAttachmentTextLengths !== undefined ? { renderedAttachmentTextLengths } : {})
    })
    if (!budget.overLimit) return this.unchangedSessionCompaction(snapshot)

    return this.applySessionCompaction(currentRun, snapshot, 0)
  }

  private unchangedSessionCompaction(snapshot: SessionHistorySnapshot, attempted = false): SessionCompactionApplication {
    return { historyMessages: snapshot.historyMessages, changed: false, attempted }
  }

  private createSessionCompactionStep(runId: string): RunStep {
    return {
      id: createId('step'),
      runId,
      type: 'thought',
      status: 'running',
      title: SESSION_COMPACTION_PENDING_TITLE,
      createdAt: nowIso()
    }
  }

  private completedSessionCompactionStep(step: RunStep): RunStep {
    return {
      ...step,
      status: 'succeeded',
      title: SESSION_COMPACTION_SUCCEEDED_TITLE,
      completedAt: nowIso()
    }
  }

  private failedSessionCompactionStep(step: RunStep): RunStep {
    return {
      ...step,
      status: 'failed',
      completedAt: nowIso()
    }
  }

  private async trySaveRuntimeStep(step: RunStep): Promise<boolean> {
    try {
      await this.persistence.steps.save(step)
      return true
    } catch (error) {
      console.error('AgentRuntime failed to persist step state', error)
      return false
    }
  }

  private async tryEmitRuntimeStepEvent(kind: 'step.created' | 'step.updated', step: RunStep): Promise<void> {
    try {
      await this.emitAndPersist({ type: kind, step })
    } catch (error) {
      console.error('AgentRuntime failed to emit step event', error)
    }
  }

  private async tryPublishRuntimeStep(kind: 'step.created' | 'step.updated', step: RunStep): Promise<boolean> {
    const stepSaved = await this.trySaveRuntimeStep(step)
    if (stepSaved) {
      await this.tryEmitRuntimeStepEvent(kind, step)
    }
    return stepSaved
  }

  private async withSessionCompactionStep<T>(runId: string, apply: () => Promise<T>): Promise<T> {
    const step = this.createSessionCompactionStep(runId)
    const stepSaved = await this.tryPublishRuntimeStep('step.created', step)
    try {
      const result = await apply()
      if (stepSaved) {
        await this.tryPublishRuntimeStep('step.updated', this.completedSessionCompactionStep(step))
      }
      return result
    } catch (error) {
      if (stepSaved) {
        await this.tryPublishRuntimeStep('step.updated', this.failedSessionCompactionStep(step))
      }
      throw error
    }
  }

  private async applySessionCompaction(currentRun: AgentRun, snapshot: SessionHistorySnapshot, overflowAttempt: number): Promise<SessionCompactionApplication> {
    const eligibleRuns = snapshot.previousParentRuns.slice(0, Math.max(0, snapshot.previousParentRuns.length - RECENT_MESSAGE_RUN_COUNT))
    if (eligibleRuns.length === 0) return this.unchangedSessionCompaction(snapshot)

    const runSummaries: Array<{ runId: string, content: string, createdAt: string, version?: number }> = []
    for (const previousRun of eligibleRuns) {
      const persisted = persistedRunSummaryItem(snapshot.contextItemsByRunId.get(previousRun.id))
      if (persisted) {
        runSummaries.push({
          runId: persisted.runId,
          content: persisted.content,
          createdAt: persisted.createdAt,
          version: persisted.version
        })
        continue
      }

      const dynamic = buildRunContextItem({
        run: previousRun,
        messages: snapshot.messagesByRunId.get(previousRun.id) ?? [],
        steps: snapshot.stepsByRunId.get(previousRun.id) ?? [],
        createdAt: previousRun.endedAt ?? previousRun.startedAt ?? nowIso()
      })
      if (!dynamic) continue

      runSummaries.push({
        runId: dynamic.runId,
        content: dynamic.content,
        createdAt: dynamic.createdAt,
        version: dynamic.version
      })
    }

    if (runSummaries.length === 0) return this.unchangedSessionCompaction(snapshot)

    const maxChars = SESSION_COMPACTION_MAX_CHARS_BY_ATTEMPT[Math.min(overflowAttempt, SESSION_COMPACTION_MAX_CHARS_BY_ATTEMPT.length - 1)]
    const built = buildSessionCompaction({
      sessionId: currentRun.sessionId,
      createdAt: nowIso(),
      runSummaries,
      ...(maxChars !== undefined ? { maxChars } : {})
    })
    if (!built) return this.unchangedSessionCompaction(snapshot)

    return this.withSessionCompactionStep(currentRun.id, async () => {
      const existingReusable = [...snapshot.contextItemsByRunId.values()]
        .flat()
        .filter((item) => item.kind === 'session_summary' && item.sourceHash === built.sourceHash && item.content.length <= built.item.content.length)
        .sort(compareContextItemsByPreference)[0]

      const updatedContextItemsByRunId = new Map(snapshot.contextItemsByRunId)
      if (!existingReusable) {
        await this.persistence.contextItems.save(built.item)
        const runItems = updatedContextItemsByRunId.get(built.item.runId) ?? []
        updatedContextItemsByRunId.set(built.item.runId, [...runItems, built.item])
      }

      const historyMessages = assembleHistoryMessages({
        currentRunId: currentRun.id,
        runs: snapshot.sessionRuns,
        messages: snapshot.sessionMessages,
        stepsByRunId: snapshot.stepsByRunId,
        contextItemsByRunId: updatedContextItemsByRunId
      })
      return {
        historyMessages,
        changed: didHistoryBecomeShorter(snapshot.historyMessages, historyMessages),
        attempted: true
      }
    })
  }

  private async executeRun(run: AgentRun, prompt: string, thinkingLevel?: ModelThinkingLevel, systemPrompt?: string, enabledToolIds?: string[], attachments?: MessageAttachment[], attachmentReader?: AttachmentReader): Promise<void> {
    try {
      if (await this.applyCancellationIfNeeded(run.id) || await this.applyTerminationIfNeeded(run.id)) {
        return
      }

      const current: AgentRun = { ...run, status: 'running', startedAt: run.startedAt ?? nowIso() }
      await this.persistence.runs.save(current)
      await this.emitAndPersist({ type: 'run.started', runId: current.id, ...(current.startedAt ? { startedAt: current.startedAt } : {}) })

      let latestRun = current
      let attempt = latestRun.retryCount
      let overflowRetryCount = 0
      const localCompaction = await this.maybeApplyLocalSessionCompaction(
        latestRun,
        prompt,
        systemPrompt,
        attachments,
        attachmentReader,
        await this.loadSessionHistorySnapshot(latestRun)
      )
      let lastCompactionAttempt = localCompaction.attempted ? 0 : -1
      let historyMessages = localCompaction.historyMessages

      while (true) {
        if (await this.applyCancellationIfNeeded(latestRun.id) || await this.applyTerminationIfNeeded(latestRun.id)) {
          return
        }

        const controller = new AbortController()
        this.activeControllers.set(latestRun.id, controller)
        try {
          await this.adapter.run(
            {
              runId: latestRun.id,
              sessionId: latestRun.sessionId,
              prompt,
              modelId: latestRun.modelId,
              ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
              ...(systemPrompt !== undefined ? { systemPrompt } : {}),
              ...(enabledToolIds !== undefined ? { enabledToolIds } : {}),
              ...(attachments !== undefined ? { attachments } : {}),
              ...(attachmentReader !== undefined ? { attachmentReader } : {}),
              ...(latestRun.workspacePath !== undefined ? { workspacePath: latestRun.workspacePath } : {}),
              historyMessages,
              signal: controller.signal
            },
            async (event) => this.handleAdapterEvent(event)
          )

          if (await this.applyCancellationIfNeeded(latestRun.id) || await this.applyTerminationIfNeeded(latestRun.id)) {
            return
          }

          latestRun = {
            ...latestRun,
            status: 'succeeded',
            endedAt: nowIso()
          } satisfies AgentRun
          await this.persistence.runs.save(latestRun)
          if (await this.applyCancellationIfNeeded(latestRun.id) || await this.applyTerminationIfNeeded(latestRun.id)) {
            return
          }
          await this.persistRunContextItem(latestRun)
          clearPiEventRunState(latestRun.id)
          clearPiToolRunState(latestRun.id)
          await this.emitAndPersist({ type: 'run.succeeded', runId: latestRun.id, ...(latestRun.endedAt ? { endedAt: latestRun.endedAt } : {}) })
          return
        } catch (error) {
          const normalized = normalizeUnknownError(error)
          if (await this.applyCancellationIfNeeded(latestRun.id) || await this.applyTerminationIfNeeded(latestRun.id)) {
            return
          }

          const isOverflow = isContextOverflowError(error) || isContextOverflowError(normalized)
          const failureError: RunError = isOverflow ? { ...normalized, retryable: false } : normalized

          if (isOverflow && overflowRetryCount < MAX_OVERFLOW_RETRIES) {
            let nextAttempt = nextOverflowAttempt(lastCompactionAttempt)
            let retryWithCompactedHistory = false
            while (nextAttempt !== undefined) {
              const compaction = await this.applySessionCompaction(
                latestRun,
                await this.loadSessionHistorySnapshot(latestRun),
                nextAttempt
              )
              if (compaction.attempted) {
                lastCompactionAttempt = nextAttempt
              }
              if (compaction.changed) {
                historyMessages = compaction.historyMessages
                retryWithCompactedHistory = true
                break
              }
              nextAttempt = nextOverflowAttempt(nextAttempt)
            }
            if (retryWithCompactedHistory) {
              overflowRetryCount += 1
              if (await this.applyCancellationIfNeeded(latestRun.id) || await this.applyTerminationIfNeeded(latestRun.id)) {
                return
              }
              continue
            }
          }

          if (!isOverflow && isRetryableRunError(normalized, this.retryPolicy) && attempt < this.retryPolicy.maxRetries) {
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
            if (await this.applyCancellationIfNeeded(latestRun.id) || await this.applyTerminationIfNeeded(latestRun.id)) {
              return
            }
            continue
          }

          latestRun = {
            ...latestRun,
            status: 'failed',
            retryCount: attempt,
            endedAt: nowIso(),
            error: failureError
          } satisfies AgentRun
          await this.persistence.runs.save(latestRun)
          await this.persistRunContextItem(latestRun)
          clearPiEventRunState(latestRun.id)
          clearPiToolRunState(latestRun.id)
          await this.emitAndPersist({ type: 'run.failed', runId: latestRun.id, error: failureError, ...(latestRun.endedAt ? { endedAt: latestRun.endedAt } : {}) })
          return
        } finally {
          if (this.activeControllers.get(latestRun.id) === controller) {
            this.activeControllers.delete(latestRun.id)
          }
        }
      }
    } finally {
      this.terminatedRuns.delete(run.id)
      this.cancelledRuns.delete(run.id)
      this.activeControllers.delete(run.id)
    }
  }

  private async handleAdapterEvent(event: AgentRuntimeEvent): Promise<void> {
    const eventRunId = runIdFromEvent(event)
    if (eventRunId && (this.terminatedRuns.has(eventRunId) || this.cancelledRuns.has(eventRunId))) {
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
