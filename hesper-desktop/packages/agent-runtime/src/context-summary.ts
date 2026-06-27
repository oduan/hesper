import type { AgentRun, Message, RunStep } from '@hesper/shared'
import { reduceToolOutput } from './tool-output-reducer'

export type BuildRunContextSummaryInput = {
  run: Pick<AgentRun, 'id'>
  messages?: Array<Pick<Message, 'role' | 'content' | 'createdAt'> & Partial<Pick<Message, 'id'>>>
  steps?: Array<Pick<RunStep, 'type' | 'status' | 'title' | 'createdAt'> & Partial<Pick<RunStep, 'id' | 'summary' | 'detail'>>>
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 6000
const REDACTED_VALUE = '[redacted-sensitive-value]'
const RUN_CONTEXT_SUMMARY_VERSION = 2
const SENSITIVE_FIELD_NAME_PATTERN = /(?:api[_ -]?key|secret|token|password)/i

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, REDACTED_VALUE)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED_VALUE)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED_VALUE)
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, REDACTED_VALUE)
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED_VALUE)
    .replace(/\bglpat-[A-Za-z0-9_-]{12,}\b/g, REDACTED_VALUE)
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, REDACTED_VALUE)
    .replace(/\bhf_[A-Za-z0-9]{20,}\b/g, REDACTED_VALUE)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED_VALUE)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, REDACTED_VALUE)
    .replace(/(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, REDACTED_VALUE)
    .replace(/(["']?(?:api[_ -]?key|secret|token|password)["']?\s*[:=]\s*["']?)([^"'\s,;]+)/gi, `$1${REDACTED_VALUE}`)
}

function sanitizeTextSection(value: string): string {
  return normalizeLineEndings(redactSensitiveText(value)).trim()
}

function sanitizeStructuredText(value: string): string {
  return normalizeLineEndings(redactSensitiveText(value)).trim()
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeStructuredValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeStructuredText(value)
  if (Array.isArray(value)) return value.map((item) => normalizeStructuredValue(item))
  if (value instanceof Date) return value.toISOString()
  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(compareText)) {
      const raw = value[key]
      normalized[key] = SENSITIVE_FIELD_NAME_PATTERN.test(key)
        ? REDACTED_VALUE
        : normalizeStructuredValue(raw)
    }
    return normalized
  }
  return value
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeStructuredValue(value)) ?? 'null'
}

function sortChronologically<T extends { createdAt: string, id?: string }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      return compareText(left.item.createdAt, right.item.createdAt) || compareText(left.item.id ?? '', right.item.id ?? '') || left.index - right.index
    })
    .map(({ item }) => item)
}

function latestContentByRole(messages: Array<Pick<Message, 'role' | 'content' | 'createdAt'> & Partial<Pick<Message, 'id'>>>, role: Message['role']): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== role) continue
    const content = sanitizeTextSection(message.content)
    if (content) return content
  }
  return undefined
}

function normalizeFiles(files: string[] | undefined): string[] | undefined {
  if (!files || files.length === 0) return undefined
  const normalized = [...new Set(files.map((file) => sanitizeTextSection(file)).filter(Boolean))].sort(compareText)
  return normalized.length > 0 ? normalized : undefined
}

function buildToolEntry(step: Pick<RunStep, 'type' | 'status' | 'title' | 'createdAt'> & Partial<Pick<RunStep, 'id' | 'summary' | 'detail'>>): Record<string, unknown> | undefined {
  const reduced = reduceToolOutput(step)
  if (!reduced) return undefined

  const entry: Record<string, unknown> = {
    category: reduced.category,
    status: reduced.status,
    title: sanitizeTextSection(reduced.title) || reduced.title
  }

  if (reduced.command) {
    const command = sanitizeTextSection(reduced.command)
    if (command) entry.command = command
  }

  if (typeof reduced.exitCode === 'number' && Number.isFinite(reduced.exitCode)) {
    entry.exitCode = reduced.exitCode
  }

  const files = normalizeFiles(reduced.files)
  if (files) entry.files = files

  if (reduced.errorExcerpt) {
    const errorExcerpt = sanitizeTextSection(reduced.errorExcerpt)
    if (errorExcerpt) entry.errorExcerpt = errorExcerpt
  }

  if (reduced.outputSummary) {
    const outputSummary = sanitizeTextSection(reduced.outputSummary)
    if (outputSummary) entry.outputSummary = outputSummary
  }

  if (typeof reduced.omittedChars === 'number' && Number.isFinite(reduced.omittedChars) && reduced.omittedChars > 0) {
    entry.omittedChars = Math.floor(reduced.omittedChars)
  }

  return Object.keys(entry).length > 0 ? entry : undefined
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0) return DEFAULT_MAX_CHARS
  return Math.floor(maxChars)
}

function truncateSummary(opening: string, body: string, closing: string, maxChars: number): string {
  const full = `${opening}\n${body}\n${closing}`
  if (full.length <= maxChars) return full

  const candidateForPrefix = (prefixLength: number): string => {
    const prefix = body.slice(0, prefixLength)
    const omitted = body.length - prefixLength
    const marker = `[truncated ${omitted} chars]`
    return `${opening}\n${prefix}${prefixLength > 0 ? '\n' : ''}${marker}\n${closing}`
  }

  const minimumCandidate = `${opening}\n[truncated ${body.length} chars]\n${closing}`
  if (minimumCandidate.length > maxChars) return minimumCandidate.slice(0, maxChars)

  let low = 0
  let high = body.length
  let best = minimumCandidate
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = candidateForPrefix(mid)
    if (candidate.length <= maxChars) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

export function buildRunContextSummary(input: BuildRunContextSummaryInput): string | undefined {
  const maxChars = normalizeMaxChars(input.maxChars)
  const orderedMessages = sortChronologically(input.messages ?? [])
  const latestUser = latestContentByRole(orderedMessages, 'user')
  const latestAssistant = latestContentByRole(orderedMessages, 'assistant')

  const toolEntries = sortChronologically(input.steps ?? [])
    .filter((step) => step.type === 'tool_call' || step.type === 'tool_result')
    .map((step) => buildToolEntry(step))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))

  if (!latestUser && !latestAssistant && toolEntries.length === 0) return undefined

  const bodyLines: string[] = ['purpose: previous_run_continuity_not_new_user_request']
  if (latestUser) {
    bodyLines.push('latest_user_request:')
    bodyLines.push(latestUser)
  }
  if (latestAssistant) {
    bodyLines.push('latest_assistant_result:')
    bodyLines.push(latestAssistant)
  }
  if (toolEntries.length > 0) {
    bodyLines.push('tool_activity:')
    for (const entry of toolEntries) {
      bodyLines.push(stableJsonStringify(entry))
    }
  }

  const opening = `<hesper_run_context run_id="${escapeXmlAttribute(input.run.id)}" version="${RUN_CONTEXT_SUMMARY_VERSION}">`
  const closing = '</hesper_run_context>'
  return truncateSummary(opening, bodyLines.join('\n'), closing, maxChars)
}
