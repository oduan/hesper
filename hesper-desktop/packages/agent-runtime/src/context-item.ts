import { createHash } from 'node:crypto'
import type { AgentRun, Message, RunContextItem, RunStep } from '@hesper/shared'
import { buildRunContextSummary } from './context-summary'

const RUN_SUMMARY_CONTEXT_ITEM_VERSION = 2

export type BuildRunContextItemInput = {
  run: Pick<AgentRun, 'id' | 'sessionId'> & Partial<AgentRun>
  messages?: Message[]
  steps?: RunStep[]
  createdAt: string
  maxChars?: number
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareCreatedThenId(left: { createdAt: string, id?: string }, right: { createdAt: string, id?: string }): number {
  return compareText(left.createdAt, right.createdAt) || compareText(left.id ?? '', right.id ?? '')
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined) return JSON.stringify(null)
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function hashSourceMaterial(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex')
}

function contextItemId(runId: string): string {
  return `context-item-${runId}-run-summary-v${RUN_SUMMARY_CONTEXT_ITEM_VERSION}`
}

export function buildRunContextItem(input: BuildRunContextItemInput): RunContextItem | undefined {
  const messages = [...(input.messages ?? [])].sort(compareCreatedThenId)
  const steps = [...(input.steps ?? [])].sort(compareCreatedThenId)
  const content = buildRunContextSummary({
    run: input.run,
    messages,
    steps,
    ...(input.maxChars !== undefined ? { maxChars: input.maxChars } : {})
  })
  if (!content) return undefined

  return {
    id: contextItemId(input.run.id),
    sessionId: input.run.sessionId,
    runId: input.run.id,
    kind: 'run_summary',
    version: RUN_SUMMARY_CONTEXT_ITEM_VERSION,
    content,
    tokenEstimate: Math.ceil(content.length / 4),
    sourceHash: hashSourceMaterial({
      version: RUN_SUMMARY_CONTEXT_ITEM_VERSION,
      content
    }),
    createdAt: input.createdAt
  }
}
