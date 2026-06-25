import type { AgentRun, Message, RunContextItem, RunStep } from '@hesper/shared'
import { buildRunContextSummary } from './context-summary'

export type AssembleHistoryMessagesInput = {
  currentRunId: string
  runs: AgentRun[]
  messages: Message[]
  stepsByRunId?: Map<string, RunStep[]>
  contextItemsByRunId?: Map<string, RunContextItem[]>
  maxContextItemChars?: number
  anchorRunCount?: number
  recentRunCount?: number
}

type RunContextCandidate = {
  run: AgentRun
  content: string
}

function stableCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareMessages(left: Message, right: Message): number {
  const byCreatedAt = stableCompare(left.createdAt, right.createdAt)
  return byCreatedAt === 0 ? stableCompare(left.id, right.id) : byCreatedAt
}

function compareRuns(left: AgentRun, right: AgentRun): number {
  const leftTime = left.startedAt ?? left.endedAt ?? ''
  const rightTime = right.startedAt ?? right.endedAt ?? ''
  const byTime = stableCompare(leftTime, rightTime)
  return byTime === 0 ? stableCompare(left.id, right.id) : byTime
}

function syntheticSummaryMessage(run: AgentRun, content: string, after: Message | undefined): Message {
  return {
    id: `context-summary-${run.id}`,
    sessionId: run.sessionId,
    runId: run.id,
    role: 'user',
    content,
    contentType: 'plain',
    createdAt: after?.createdAt ?? run.endedAt ?? run.startedAt ?? '1970-01-01T00:00:00.000Z'
  }
}

function shouldSummarizeRun(run: AgentRun, steps: RunStep[]): boolean {
  return steps.length > 0 || Boolean(run.error)
}

function persistedRunSummary(items: RunContextItem[] | undefined): string | undefined {
  return items
    ?.filter((item) => item.kind === 'run_summary' && item.content.trim())
    .sort((left, right) => (right.version - left.version) || stableCompare(right.createdAt, left.createdAt) || stableCompare(left.id, right.id))[0]
    ?.content
}

function addCandidateIfBudgetAllows(selectedRunIds: Set<string>, candidate: RunContextCandidate, budget: { used: number, max: number }): void {
  if (selectedRunIds.has(candidate.run.id)) return
  if (budget.used + candidate.content.length > budget.max) return
  selectedRunIds.add(candidate.run.id)
  budget.used += candidate.content.length
}

function selectContextCandidates(candidates: RunContextCandidate[], input: AssembleHistoryMessagesInput): Set<string> {
  if (input.maxContextItemChars === undefined) {
    return new Set(candidates.map((candidate) => candidate.run.id))
  }

  const selectedRunIds = new Set<string>()
  const budget = { used: 0, max: Math.max(0, input.maxContextItemChars) }
  const anchorCount = Math.max(0, input.anchorRunCount ?? 0)
  const recentCount = Math.max(0, input.recentRunCount ?? 0)
  const anchorCandidates = candidates.slice(0, anchorCount)
  const recentCandidates = candidates.slice(Math.max(anchorCount, candidates.length - recentCount))
  const middleCandidates = candidates.slice(anchorCount, Math.max(anchorCount, candidates.length - recentCount))

  for (const candidate of anchorCandidates) {
    addCandidateIfBudgetAllows(selectedRunIds, candidate, budget)
  }
  for (const candidate of [...recentCandidates].reverse()) {
    addCandidateIfBudgetAllows(selectedRunIds, candidate, budget)
  }
  for (const candidate of middleCandidates) {
    addCandidateIfBudgetAllows(selectedRunIds, candidate, budget)
  }

  return selectedRunIds
}

export function assembleHistoryMessages(input: AssembleHistoryMessagesInput): Message[] {
  const parentRunIds = new Set(
    input.runs
      .filter((run) => run.id !== input.currentRunId && run.parentRunId === undefined)
      .map((run) => run.id)
  )
  const messagesByRunId = new Map<string, Message[]>()
  const unboundMessages: Message[] = []

  for (const message of input.messages) {
    if (message.runId === input.currentRunId) continue
    if (!message.runId) {
      unboundMessages.push(message)
      continue
    }
    if (!parentRunIds.has(message.runId)) continue
    const messages = messagesByRunId.get(message.runId) ?? []
    messages.push(message)
    messagesByRunId.set(message.runId, messages)
  }

  const result: Message[] = [...unboundMessages.sort(compareMessages)]
  const orderedRuns = input.runs
    .filter((run) => parentRunIds.has(run.id))
    .sort(compareRuns)
  const contextCandidates: RunContextCandidate[] = []

  for (const run of orderedRuns) {
    const persisted = persistedRunSummary(input.contextItemsByRunId?.get(run.id))
    if (persisted) {
      contextCandidates.push({ run, content: persisted })
      continue
    }
    const runMessages = (messagesByRunId.get(run.id) ?? []).sort(compareMessages)
    const steps = input.stepsByRunId?.get(run.id) ?? []
    if (!shouldSummarizeRun(run, steps)) continue
    const summary = buildRunContextSummary({
      run,
      messages: runMessages,
      steps
    })
    if (summary) contextCandidates.push({ run, content: summary })
  }

  const selectedContextRunIds = selectContextCandidates(contextCandidates, input)
  const contextByRunId = new Map(contextCandidates.map((candidate) => [candidate.run.id, candidate.content]))

  for (const run of orderedRuns) {
    const runMessages = (messagesByRunId.get(run.id) ?? []).sort(compareMessages)
    result.push(...runMessages)
    const context = contextByRunId.get(run.id)
    if (context && selectedContextRunIds.has(run.id)) {
      result.push(syntheticSummaryMessage(run, context, runMessages.at(-1)))
    }
  }

  return result
}
