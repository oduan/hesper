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
  recentMessageRunCount?: number
}

type RunContextCandidate = {
  run: AgentRun
  content: string
}

type SessionSummaryCandidate = {
  item: RunContextItem
  content: string
  coveredRunIds: string[]
  firstCoveredIndex: number
}

const DEFAULT_RECENT_MESSAGE_RUN_COUNT = 1
const SESSION_SUMMARY_COVERED_RUN_IDS_PATTERN = /<hesper_session_context\b[^>]*\bcovered_run_ids=(?:"([^"]*)"|'([^']*)')/i

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

function syntheticSessionSummaryMessage(item: RunContextItem): Message {
  return {
    id: `context-summary-${item.id}`,
    sessionId: item.sessionId,
    runId: item.runId,
    role: 'user',
    content: item.content,
    contentType: 'plain',
    createdAt: item.createdAt
  }
}

function shouldSummarizeRun(run: AgentRun, _messages: Message[], steps: RunStep[]): boolean {
  return steps.length > 0 || Boolean(run.error)
}

function compareContextItemsByPreference(left: RunContextItem, right: RunContextItem): number {
  return (right.version - left.version) || stableCompare(right.createdAt, left.createdAt) || stableCompare(left.id, right.id)
}

function persistedRunSummary(items: RunContextItem[] | undefined): string | undefined {
  return items
    ?.filter((item) => item.kind === 'run_summary' && item.content.trim())
    .sort(compareContextItemsByPreference)[0]
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

function normalizeCount(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function parseCoveredRunIds(content: string): string[] {
  const match = content.match(SESSION_SUMMARY_COVERED_RUN_IDS_PATTERN)
  const raw = match?.[1] ?? match?.[2]
  if (!raw) return []

  return [...new Set(raw.split(',').map((runId) => runId.trim()).filter(Boolean))]
}

function isContiguousCoverage(coveredRunIds: string[], orderedRunIndexById: Map<string, number>): boolean {
  if (coveredRunIds.length === 0) return false

  const indices = coveredRunIds
    .map((runId) => orderedRunIndexById.get(runId))
    .filter((index): index is number => index !== undefined)
    .sort((left, right) => left - right)

  if (indices.length !== coveredRunIds.length) return false
  for (let index = 1; index < indices.length; index += 1) {
    if (indices[index] !== indices[index - 1]! + 1) return false
  }
  return true
}

function collectSessionSummaryCandidates(
  orderedRuns: AgentRun[],
  contextItemsByRunId: Map<string, RunContextItem[]> | undefined,
  recentMessageRunIds: Set<string>
): SessionSummaryCandidate[] {
  if (!contextItemsByRunId || orderedRuns.length === 0) return []

  const orderedRunIndexById = new Map(orderedRuns.map((run, index) => [run.id, index]))
  const summarizableRunIds = new Set(orderedRuns.filter((run) => !recentMessageRunIds.has(run.id)).map((run) => run.id))
  const bestByCoverageKey = new Map<string, SessionSummaryCandidate>()

  for (const items of contextItemsByRunId.values()) {
    for (const item of items) {
      if (item.kind !== 'session_summary' || !item.content.trim()) continue
      if (!orderedRunIndexById.has(item.runId)) continue

      const coveredRunIds = parseCoveredRunIds(item.content)
        .filter((runId) => summarizableRunIds.has(runId))
        .sort((left, right) => (orderedRunIndexById.get(left)! - orderedRunIndexById.get(right)!) || stableCompare(left, right))

      if (!isContiguousCoverage(coveredRunIds, orderedRunIndexById)) continue

      const firstCoveredRunId = coveredRunIds[0]
      if (!firstCoveredRunId) continue

      const firstCoveredIndex = orderedRunIndexById.get(firstCoveredRunId)
      if (firstCoveredIndex === undefined) continue

      const candidate: SessionSummaryCandidate = {
        item,
        content: item.content,
        coveredRunIds,
        firstCoveredIndex
      }
      const coverageKey = coveredRunIds.join(',')
      const existing = bestByCoverageKey.get(coverageKey)
      if (!existing || compareContextItemsByPreference(candidate.item, existing.item) < 0) {
        bestByCoverageKey.set(coverageKey, candidate)
      }
    }
  }

  const coveredRunIds = new Set<string>()
  return [...bestByCoverageKey.values()]
    .sort((left, right) => {
      return (left.firstCoveredIndex - right.firstCoveredIndex)
        || (right.coveredRunIds.length - left.coveredRunIds.length)
        || compareContextItemsByPreference(left.item, right.item)
    })
    .filter((candidate) => {
      if (candidate.coveredRunIds.some((runId) => coveredRunIds.has(runId))) return false
      for (const runId of candidate.coveredRunIds) coveredRunIds.add(runId)
      return true
    })
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

  const orderedRuns = input.runs
    .filter((run) => parentRunIds.has(run.id))
    .sort(compareRuns)
  const recentMessageRunCount = normalizeCount(input.recentMessageRunCount, DEFAULT_RECENT_MESSAGE_RUN_COUNT)
  const recentMessageRunIds = new Set(
    orderedRuns
      .slice(Math.max(0, orderedRuns.length - recentMessageRunCount))
      .map((run) => run.id)
  )
  const contextCandidates: RunContextCandidate[] = []

  for (const run of orderedRuns) {
    const persisted = persistedRunSummary(input.contextItemsByRunId?.get(run.id))
    if (persisted) {
      contextCandidates.push({ run, content: persisted })
      continue
    }

    const runMessages = (messagesByRunId.get(run.id) ?? []).sort(compareMessages)
    const steps = input.stepsByRunId?.get(run.id) ?? []
    if (!shouldSummarizeRun(run, runMessages, steps)) continue

    const summary = buildRunContextSummary({
      run,
      messages: runMessages,
      steps
    })
    if (summary) contextCandidates.push({ run, content: summary })
  }

  const selectedContextRunIds = selectContextCandidates(contextCandidates, input)
  const contextByRunId = new Map(contextCandidates.map((candidate) => [candidate.run.id, candidate.content]))
  const sessionSummaryCandidates = collectSessionSummaryCandidates(orderedRuns, input.contextItemsByRunId, recentMessageRunIds)
  const sessionSummaryByFirstRunId = new Map(sessionSummaryCandidates.map((candidate) => [candidate.coveredRunIds[0]!, candidate]))
  const coveredBySessionSummaryRunIds = new Set(sessionSummaryCandidates.flatMap((candidate) => candidate.coveredRunIds))
  const result: Message[] = [...unboundMessages.sort(compareMessages)]

  for (const run of orderedRuns) {
    const runMessages = (messagesByRunId.get(run.id) ?? []).sort(compareMessages)
    const sessionSummary = sessionSummaryByFirstRunId.get(run.id)

    if (sessionSummary) {
      result.push(syntheticSessionSummaryMessage(sessionSummary.item))
    }
    if (recentMessageRunIds.has(run.id)) {
      result.push(...runMessages)
    }
    if (coveredBySessionSummaryRunIds.has(run.id)) continue

    const context = contextByRunId.get(run.id)
    if (context && selectedContextRunIds.has(run.id)) {
      result.push(syntheticSummaryMessage(run, context, runMessages.at(-1)))
    }
  }

  return result
}
