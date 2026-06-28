import type { AgentRun, Message, RunStep } from '@hesper/shared'
import { reduceToolOutput } from './tool-output-reducer'

export type BuildRunContextSummaryInput = {
  run: Pick<AgentRun, 'id'>
  messages?: Array<Pick<Message, 'role' | 'content' | 'createdAt'> & Partial<Pick<Message, 'id'>>>
  steps?: Array<Pick<RunStep, 'type' | 'status' | 'title' | 'createdAt'> & Partial<Pick<RunStep, 'id' | 'detail'>>>
  maxChars?: number
}

type SummarySection = {
  kind: 'plain' | 'tool_activity'
  lines: string[]
}

const DEFAULT_MAX_CHARS = 6000
const REDACTED_VALUE = '[redacted-sensitive-value]'
const RUN_CONTEXT_SUMMARY_VERSION = 2
const SENSITIVE_FIELD_NAME_PATTERN = /(?:api[_ -]?key|secret|token|password)/i
const SUMMARY_TEXT_LINE_CHUNK_CHARS = 400

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(--(?:api[_-]?key|secret|token|password))(=|\s+)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, (_match, flag: string, separator: string) => `${flag}${separator}${REDACTED_VALUE}`)
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

function splitTextForSummary(value: string): string[] {
  const lines: string[] = []

  for (const line of value.split('\n')) {
    const codePoints = Array.from(line)
    if (codePoints.length <= SUMMARY_TEXT_LINE_CHUNK_CHARS) {
      lines.push(line)
      continue
    }

    for (let index = 0; index < codePoints.length; index += SUMMARY_TEXT_LINE_CHUNK_CHARS) {
      lines.push(codePoints.slice(index, index + SUMMARY_TEXT_LINE_CHUNK_CHARS).join(''))
    }
  }

  return lines
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

function buildToolEntry(step: Pick<RunStep, 'type' | 'status' | 'title' | 'createdAt'> & Partial<Pick<RunStep, 'id' | 'detail'>>): Record<string, unknown> | undefined {
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

function flattenSections(sections: SummarySection[]): string[] {
  return sections.flatMap((section) => section.lines)
}

function buildBodySections(latestUser: string | undefined, latestAssistant: string | undefined, toolEntries: Array<Record<string, unknown>>): SummarySection[] {
  const sections: SummarySection[] = [
    {
      kind: 'plain',
      lines: ['purpose: previous_run_continuity_not_new_user_request']
    }
  ]

  if (latestUser) {
    sections.push({
      kind: 'plain',
      lines: ['latest_user_request:', ...splitTextForSummary(latestUser)]
    })
  }

  if (latestAssistant) {
    sections.push({
      kind: 'plain',
      lines: ['latest_assistant_result:', ...splitTextForSummary(latestAssistant)]
    })
  }

  if (toolEntries.length > 0) {
    sections.push({
      kind: 'tool_activity',
      lines: ['tool_activity:', ...toolEntries.map((entry) => stableJsonStringify(entry))]
    })
  }

  return sections
}

function renderSummary(opening: string, bodyLines: string[], closing: string, omittedChars?: number): string {
  const lines = omittedChars && omittedChars > 0
    ? [...bodyLines, `[truncated ${omittedChars} chars]`]
    : bodyLines
  return `${opening}\n${lines.join('\n')}\n${closing}`
}

function candidateLength(opening: string, bodyLines: string[], closing: string, omittedChars?: number): number {
  return renderSummary(opening, bodyLines, closing, omittedChars).length
}

function truncateSummary(opening: string, sections: SummarySection[], closing: string, maxChars: number): string {
  const fullBodyLines = flattenSections(sections)
  const full = renderSummary(opening, fullBodyLines, closing)
  if (full.length <= maxChars) return full

  const fullBody = fullBodyLines.join('\n')
  const minimumCandidate = renderSummary(opening, [], closing, fullBody.length)
  if (minimumCandidate.length > maxChars) return minimumCandidate

  const candidateForLines = (bodyLines: string[]): string => {
    const prefixLength = bodyLines.length > 0 ? bodyLines.join('\n').length : 0
    const omittedChars = fullBody.length - prefixLength
    return renderSummary(opening, bodyLines, closing, omittedChars > 0 ? omittedChars : undefined)
  }

  const fits = (bodyLines: string[]): boolean => {
    const prefixLength = bodyLines.length > 0 ? bodyLines.join('\n').length : 0
    const omittedChars = fullBody.length - prefixLength
    return candidateLength(opening, bodyLines, closing, omittedChars > 0 ? omittedChars : undefined) <= maxChars
  }

  let keptLines: string[] = []
  let best = minimumCandidate

  for (const section of sections) {
    if (section.kind === 'plain') {
      for (const line of section.lines) {
        const nextLines = [...keptLines, line]
        if (!fits(nextLines)) return best
        keptLines = nextLines
        best = candidateForLines(keptLines)
      }
      continue
    }

    const header = section.lines[0]
    if (!header) continue

    const entryLines = section.lines.slice(1)
    const headerOnly = [...keptLines, header]
    if (!fits(headerOnly)) break

    keptLines = headerOnly
    best = candidateForLines(keptLines)

    for (const entryLine of entryLines) {
      const nextLines = [...keptLines, entryLine]
      if (!fits(nextLines)) return best
      keptLines = nextLines
      best = candidateForLines(keptLines)
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

  const opening = `<hesper_run_context run_id="${escapeXmlAttribute(input.run.id)}" version="${RUN_CONTEXT_SUMMARY_VERSION}">`
  const closing = '</hesper_run_context>'
  return truncateSummary(opening, buildBodySections(latestUser, latestAssistant, toolEntries), closing, maxChars)
}
