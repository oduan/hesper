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

type ContextCandidate = {
  key: string
  insertionRunId: string
  orderIndex: number
  coveredRunIds: string[]
  content: string
  message: Message
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

function compareContextItemsByPreference(left: RunContextItem, right: RunContextItem): number {
  return (right.version - left.version) || stableCompare(right.createdAt, left.createdAt) || stableCompare(left.id, right.id)
}

function persistedRunSummary(items: RunContextItem[] | undefined): string | undefined {
  return items
    ?.filter((item) => item.kind === 'run_summary' && item.content.trim())
    .sort(compareContextItemsByPreference)[0]
    ?.content
}

function compareContextCandidates(left: ContextCandidate, right: ContextCandidate): number {
  return (left.orderIndex - right.orderIndex)
    || (right.coveredRunIds.length - left.coveredRunIds.length)
    || stableCompare(left.key, right.key)
}

function addCandidateIfBudgetAllows(
  selectedCandidateKeys: Set<string>,
  coveredRunIds: Set<string>,
  candidate: ContextCandidate,
  budget: { used: number, max: number }
): void {
  if (selectedCandidateKeys.has(candidate.key)) return
  if (candidate.coveredRunIds.some((runId) => coveredRunIds.has(runId))) return
  if (budget.used + candidate.content.length > budget.max) return

  selectedCandidateKeys.add(candidate.key)
  budget.used += candidate.content.length
  for (const runId of candidate.coveredRunIds) {
    coveredRunIds.add(runId)
  }
}

function selectContextCandidates(candidates: ContextCandidate[], input: AssembleHistoryMessagesInput): Set<string> {
  const orderedCandidates = [...candidates].sort(compareContextCandidates)

  if (input.maxContextItemChars === undefined) {
    const selectedCandidateKeys = new Set<string>()
    const coveredRunIds = new Set<string>()
    const unlimitedBudget = { used: 0, max: Number.POSITIVE_INFINITY }

    for (const candidate of orderedCandidates) {
      addCandidateIfBudgetAllows(selectedCandidateKeys, coveredRunIds, candidate, unlimitedBudget)
    }

    return selectedCandidateKeys
  }

  const selectedCandidateKeys = new Set<string>()
  const coveredRunIds = new Set<string>()
  const budget = { used: 0, max: Math.max(0, input.maxContextItemChars) }
  const anchorCount = Math.max(0, input.anchorRunCount ?? 0)
  const recentCount = Math.max(0, input.recentRunCount ?? 0)
  const anchorCandidates = orderedCandidates.slice(0, anchorCount)
  const recentCandidates = orderedCandidates.slice(Math.max(anchorCount, orderedCandidates.length - recentCount))
  const middleCandidates = orderedCandidates.slice(anchorCount, Math.max(anchorCount, orderedCandidates.length - recentCount))

  for (const candidate of anchorCandidates) {
    addCandidateIfBudgetAllows(selectedCandidateKeys, coveredRunIds, candidate, budget)
  }
  for (const candidate of [...recentCandidates].reverse()) {
    addCandidateIfBudgetAllows(selectedCandidateKeys, coveredRunIds, candidate, budget)
  }
  for (const candidate of middleCandidates) {
    addCandidateIfBudgetAllows(selectedCandidateKeys, coveredRunIds, candidate, budget)
  }

  return selectedCandidateKeys
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
): ContextCandidate[] {
  if (!contextItemsByRunId || orderedRuns.length === 0) return []

  const orderedRunIndexById = new Map(orderedRuns.map((run, index) => [run.id, index]))
  const bestByCoverageKey = new Map<string, { item: RunContextItem, coveredRunIds: string[], firstCoveredIndex: number }>()

  for (const items of contextItemsByRunId.values()) {
    for (const item of items) {
      if (item.kind !== 'session_summary' || !item.content.trim()) continue
      if (!orderedRunIndexById.has(item.runId)) continue

      const coveredRunIds = parseCoveredRunIds(item.content)
      if (coveredRunIds.length === 0) continue
      if (coveredRunIds.some((runId) => !orderedRunIndexById.has(runId))) continue
      if (coveredRunIds.some((runId) => recentMessageRunIds.has(runId))) continue

      const orderedCoveredRunIds = [...coveredRunIds].sort((left, right) => (orderedRunIndexById.get(left)! - orderedRunIndexById.get(right)!) || stableCompare(left, right))
      if (!isContiguousCoverage(orderedCoveredRunIds, orderedRunIndexById)) continue

      const firstCoveredRunId = orderedCoveredRunIds[0]
      if (!firstCoveredRunId) continue

      const firstCoveredIndex = orderedRunIndexById.get(firstCoveredRunId)
      if (firstCoveredIndex === undefined) continue

      const coverageKey = orderedCoveredRunIds.join(',')
      const existing = bestByCoverageKey.get(coverageKey)
      if (!existing || compareContextItemsByPreference(item, existing.item) < 0) {
        bestByCoverageKey.set(coverageKey, {
          item,
          coveredRunIds: orderedCoveredRunIds,
          firstCoveredIndex
        })
      }
    }
  }

  return [...bestByCoverageKey.values()]
    .map(({ item, coveredRunIds, firstCoveredIndex }) => ({
      key: `session:${item.id}`,
      insertionRunId: coveredRunIds[0]!,
      orderIndex: firstCoveredIndex,
      coveredRunIds,
      content: item.content,
      message: syntheticSessionSummaryMessage(item)
    }))
    .sort(compareContextCandidates)
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
  const orderedRunIndexById = new Map(orderedRuns.map((run, index) => [run.id, index]))
  const recentMessageRunCount = normalizeCount(input.recentMessageRunCount, DEFAULT_RECENT_MESSAGE_RUN_COUNT)
  const recentMessageRunIds = new Set(
    orderedRuns
      .slice(Math.max(0, orderedRuns.length - recentMessageRunCount))
      .map((run) => run.id)
  )
  const runContextCandidates: ContextCandidate[] = []

  for (const run of orderedRuns) {
    const runMessages = (messagesByRunId.get(run.id) ?? []).sort(compareMessages)
    const steps = input.stepsByRunId?.get(run.id) ?? []
    const persisted = persistedRunSummary(input.contextItemsByRunId?.get(run.id))

    if (persisted) {
      runContextCandidates.push({
        key: `run:${run.id}`,
        insertionRunId: run.id,
        orderIndex: orderedRunIndexById.get(run.id) ?? 0,
        coveredRunIds: [run.id],
        content: persisted,
        message: syntheticSummaryMessage(run, persisted, runMessages.at(-1))
      })
      continue
    }

    const hasMessages = runMessages.length > 0
    const hasDynamicSummaryInputs = hasMessages || steps.length > 0 || Boolean(run.error)
    const isRecentMessageOnlyRun = hasMessages && steps.length === 0 && !run.error && recentMessageRunIds.has(run.id)

    if (!hasDynamicSummaryInputs || isRecentMessageOnlyRun) continue

    const summary = buildRunContextSummary({
      run,
      messages: runMessages,
      steps
    })
    if (!summary) continue

    runContextCandidates.push({
      key: `run:${run.id}`,
      insertionRunId: run.id,
      orderIndex: orderedRunIndexById.get(run.id) ?? 0,
      coveredRunIds: [run.id],
      content: summary,
      message: syntheticSummaryMessage(run, summary, runMessages.at(-1))
    })
  }

  const sessionSummaryCandidates = collectSessionSummaryCandidates(orderedRuns, input.contextItemsByRunId, recentMessageRunIds)
  const allContextCandidates = [...runContextCandidates, ...sessionSummaryCandidates].sort(compareContextCandidates)
  const selectedContextCandidateKeys = selectContextCandidates(allContextCandidates, input)
  const selectedCandidateByInsertionRunId = new Map(
    allContextCandidates
      .filter((candidate) => selectedContextCandidateKeys.has(candidate.key))
      .map((candidate) => [candidate.insertionRunId, candidate] as const)
  )
  const result: Message[] = [...unboundMessages.sort(compareMessages)]

  for (const run of orderedRuns) {
    const runMessages = (messagesByRunId.get(run.id) ?? []).sort(compareMessages)
    if (recentMessageRunIds.has(run.id)) {
      result.push(...runMessages)
    }

    const selectedCandidate = selectedCandidateByInsertionRunId.get(run.id)
    if (selectedCandidate) {
      result.push(selectedCandidate.message)
    }
  }

  return result
}
