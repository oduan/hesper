import type { AgentRun, Message, RunStep } from '@hesper/shared'
import { buildRunContextSummary } from './context-summary'

export type AssembleHistoryMessagesInput = {
  currentRunId: string
  runs: AgentRun[]
  messages: Message[]
  stepsByRunId: Map<string, RunStep[]>
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

  for (const run of orderedRuns) {
    const runMessages = (messagesByRunId.get(run.id) ?? []).sort(compareMessages)
    result.push(...runMessages)
    const steps = input.stepsByRunId.get(run.id) ?? []
    if (!shouldSummarizeRun(run, steps)) continue
    const summary = buildRunContextSummary({
      run,
      messages: runMessages,
      steps
    })
    if (summary) {
      result.push(syntheticSummaryMessage(run, summary, runMessages.at(-1)))
    }
  }

  return result
}
