import { createHash } from 'node:crypto'
import type { RunContextItem } from '@hesper/shared'

const SESSION_SUMMARY_CONTEXT_ITEM_VERSION = 1
const SESSION_SUMMARY_WRAPPER_VERSION = 1
const DEFAULT_MAX_CHARS = 6000
const REDACTED_VALUE = '[redacted-sensitive-value]'
const SECTION_HEADER_SET = new Set(['latest_user_request:', 'latest_assistant_result:', 'tool_activity:'])
const TRUNCATION_MARKER_PATTERN = /^\[truncated \d+ chars\]$/
const HARD_CONSTRAINT_PATTERN = /(?:\b(?:must(?:\s+not)?|do not|don't|only|avoid|keep|preserve|required|cannot|never)\b|(?:必须|不要|仅|只做|不能|不得|保留|避免))/i
const DECISION_PATTERN = /(?:\b(?:decision|decided|choose|chosen|approach|plan|architecture|architectural|reuse|prefer|keep|adopt|confirm(?:ed)?)\b|(?:方案|决定|架构|采用|复用|确认|保持))/i
const VALIDATION_PATTERN = /(?:\b(?:test|typecheck|lint|build|validate|validation|check|assert|verification|verified)\b|(?:测试|验证|检查|构建))/i
const FAILURE_PATTERN = /(?:\b(?:fail(?:ed|ure)?|error|exception|assertionerror|typeerror|referenceerror)\b|(?:失败|报错|错误|异常))/i
const PATH_LIKE_PATTERN = /(?:^|[\s"'`(])((?:[A-Za-z]:[\\/]|\.\.?[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)(?=$|[\s"'`):,])/g

export type BuildSessionCompactionInput = {
  sessionId: string
  runSummaries: Array<{ runId: string, content: string, createdAt: string, version?: number }>
  recentMessages?: Array<{ role: string, content: string, createdAt: string }>
  currentPrompt?: string
  createdAt: string
  maxChars?: number
}

export type SessionCompactionResult = {
  item: RunContextItem
  coveredRunIds: string[]
  sourceHash: string
}

type SummarySection = {
  kind: 'plain' | 'tool_activity'
  header: string
  lines: string[]
}

type OrderedRunSummary = {
  runId: string
  createdAt: string
  content: string
  version?: number
}

type ParsedRunSummary = {
  runId: string
  createdAt: string
  latestUserRequest?: string
  latestAssistantResult?: string
  toolEntries: Record<string, unknown>[]
  truncationMarkers: string[]
  importantFiles: string[]
}

type OrderedMessage = {
  role: string
  content: string
  createdAt: string
}

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

function sanitizeText(value: string): string {
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
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) return value.map((item) => normalizeStructuredValue(item))
  if (value instanceof Date) return value.toISOString()
  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(compareText)) {
      normalized[key] = /(?:api[_ -]?key|secret|token|password)/i.test(key)
        ? REDACTED_VALUE
        : normalizeStructuredValue(value[key])
    }
    return normalized
  }
  return value
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeStructuredValue(value)) ?? 'null'
}

function hashSourceMaterial(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex')
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0) return DEFAULT_MAX_CHARS
  return Math.floor(maxChars)
}

function normalizeOrderedRunSummaries(runSummaries: BuildSessionCompactionInput['runSummaries']): OrderedRunSummary[] {
  return runSummaries
    .map((summary, index) => ({ summary, index }))
    .sort((left, right) => {
      return compareText(left.summary.createdAt, right.summary.createdAt)
        || compareText(left.summary.runId, right.summary.runId)
        || compareText(left.summary.content, right.summary.content)
        || left.index - right.index
    })
    .map(({ summary }) => ({
      runId: summary.runId,
      createdAt: summary.createdAt,
      content: normalizeLineEndings(summary.content),
      ...(summary.version !== undefined ? { version: summary.version } : {})
    }))
}

function normalizeOrderedMessages(messages: BuildSessionCompactionInput['recentMessages']): OrderedMessage[] {
  return [...(messages ?? [])]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareText(left.message.createdAt, right.message.createdAt) || compareText(left.message.role, right.message.role) || left.index - right.index)
    .map(({ message }) => ({
      role: message.role,
      createdAt: message.createdAt,
      content: sanitizeText(message.content)
    }))
    .filter((message) => message.content)
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = sanitizeText(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function uniqueOrderedRecords(values: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const result: Record<string, unknown>[] = []
  for (const value of values) {
    const key = stableJsonStringify(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalizeStructuredValue(value) as Record<string, unknown>)
  }
  return result
}

function normalizePath(value: string): string | undefined {
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/:+$/, '')
  if (!trimmed || trimmed === '.' || trimmed === '..') return undefined
  return trimmed
}

function collectPathsFromText(text: string): string[] {
  const result = new Set<string>()
  const normalized = normalizeLineEndings(text)
  for (const match of normalized.matchAll(PATH_LIKE_PATTERN)) {
    const path = normalizePath(match[1] ?? '')
    if (path) result.add(path)
  }
  return [...result].sort(compareText)
}

function collectFilesFromToolEntry(entry: Record<string, unknown>): string[] {
  const result = new Set<string>()
  const files = entry.files
  if (Array.isArray(files)) {
    for (const file of files) {
      if (typeof file !== 'string') continue
      const normalized = normalizePath(file)
      if (normalized) result.add(normalized)
    }
  }
  for (const field of ['outputSummary', 'errorExcerpt', 'command']) {
    const value = entry[field]
    if (typeof value !== 'string') continue
    for (const path of collectPathsFromText(value)) result.add(path)
  }
  return [...result].sort(compareText)
}

function parseToolEntry(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isPlainObject(parsed) ? normalizeStructuredValue(parsed) as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function parseRunSummary(summary: OrderedRunSummary): ParsedRunSummary {
  const lines = normalizeLineEndings(summary.content).split('\n')
  const userLines: string[] = []
  const assistantLines: string[] = []
  const truncationMarkers: string[] = []
  const toolEntries: Record<string, unknown>[] = []
  const importantFiles = new Set<string>()
  let currentSection: 'user' | 'assistant' | 'tool' | undefined

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) {
      if (currentSection === 'user') userLines.push('')
      if (currentSection === 'assistant') assistantLines.push('')
      continue
    }
    if (trimmed.startsWith('<hesper_run_context') || trimmed === '</hesper_run_context>') {
      currentSection = undefined
      continue
    }
    if (TRUNCATION_MARKER_PATTERN.test(trimmed)) {
      truncationMarkers.push(trimmed)
      currentSection = undefined
      continue
    }
    if (trimmed === 'latest_user_request:') {
      currentSection = 'user'
      continue
    }
    if (trimmed === 'latest_assistant_result:') {
      currentSection = 'assistant'
      continue
    }
    if (trimmed === 'tool_activity:') {
      currentSection = 'tool'
      continue
    }
    if (SECTION_HEADER_SET.has(trimmed)) {
      currentSection = undefined
      continue
    }

    if (currentSection === 'tool') {
      const entry = parseToolEntry(rawLine)
      if (entry) {
        toolEntries.push(entry)
        for (const file of collectFilesFromToolEntry(entry)) importantFiles.add(file)
      }
      continue
    }

    if (currentSection === 'user') {
      userLines.push(rawLine)
      for (const path of collectPathsFromText(rawLine)) importantFiles.add(path)
      continue
    }

    if (currentSection === 'assistant') {
      assistantLines.push(rawLine)
      for (const path of collectPathsFromText(rawLine)) importantFiles.add(path)
    }
  }

  const latestUserRequest = sanitizeText(userLines.join('\n')) || undefined
  const latestAssistantResult = sanitizeText(assistantLines.join('\n')) || undefined
  if (latestUserRequest) {
    for (const path of collectPathsFromText(latestUserRequest)) importantFiles.add(path)
  }
  if (latestAssistantResult) {
    for (const path of collectPathsFromText(latestAssistantResult)) importantFiles.add(path)
  }

  return {
    runId: summary.runId,
    createdAt: summary.createdAt,
    ...(latestUserRequest ? { latestUserRequest } : {}),
    ...(latestAssistantResult ? { latestAssistantResult } : {}),
    toolEntries,
    truncationMarkers: uniqueOrdered(truncationMarkers),
    importantFiles: [...importantFiles].sort(compareText)
  }
}

function splitLines(text: string): string[] {
  return normalizeLineEndings(text).split('\n').map((line) => sanitizeText(line)).filter(Boolean)
}

function extractMatchingLines(text: string | undefined, pattern: RegExp): string[] {
  if (!text) return []
  const result: string[] = []
  for (const line of splitLines(text)) {
    const normalized = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim()
    if (!normalized) continue
    if (pattern.test(normalized) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      result.push(normalized)
    }
  }
  if (result.length > 0) return uniqueOrdered(result)

  return uniqueOrdered(
    sanitizeText(text)
      .split(/(?<=[.!?。！？])\s+/)
      .map((line) => line.trim())
      .filter((line) => line && pattern.test(line))
  )
}

function stringifyScalar(value: unknown): string | undefined {
  if (typeof value === 'string') return sanitizeText(value) || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return undefined
}

function summarizeToolEntry(entry: Record<string, unknown>): string | undefined {
  const title = stringifyScalar(entry.title) ?? 'tool activity'
  const status = stringifyScalar(entry.status)
  const exitCode = typeof entry.exitCode === 'number' && Number.isFinite(entry.exitCode) ? `, exit ${entry.exitCode}` : ''
  const detail = stringifyScalar(entry.errorExcerpt) ?? stringifyScalar(entry.outputSummary)
  const detailLine = detail?.split('\n').find(Boolean)
  const fileList = collectFilesFromToolEntry(entry)
  const fileSuffix = fileList.length > 0 ? ` [files: ${fileList.join(', ')}]` : ''
  const statusSegment = status ? ` (${status}${exitCode})` : exitCode ? ` (${exitCode.slice(2)})` : ''
  const summary = `${title}${statusSegment}${detailLine ? `: ${detailLine}` : ''}${fileSuffix}`
  return sanitizeText(summary) || undefined
}

function selectRecentUnique(values: string[], maxItems: number): string[] {
  const seen = new Set<string>()
  const selected: string[] = []
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = sanitizeText(values[index] ?? '')
    if (!value || seen.has(value)) continue
    seen.add(value)
    selected.push(value)
    if (selected.length >= maxItems) break
  }
  return selected.reverse()
}

function flattenSections(sections: SummarySection[]): string[] {
  return sections.flatMap((section) => [section.header, ...section.lines])
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
    const headerOnly = [...keptLines, section.header]
    if (!fits(headerOnly)) return best

    keptLines = headerOnly
    best = candidateForLines(keptLines)

    for (const line of section.lines) {
      const nextLines = [...keptLines, line]
      if (!fits(nextLines)) return best
      keptLines = nextLines
      best = candidateForLines(keptLines)
    }
  }

  return best
}

function hasMeaningfulSummary(parsed: ParsedRunSummary): boolean {
  return Boolean(parsed.latestUserRequest || parsed.latestAssistantResult || parsed.toolEntries.length > 0 || parsed.truncationMarkers.length > 0 || parsed.importantFiles.length > 0)
}

function buildSections(parsedSummaries: ParsedRunSummary[], currentPrompt: string | undefined, recentMessages: OrderedMessage[]): SummarySection[] {
  const earliestGoal = parsedSummaries.find((summary) => summary.latestUserRequest)?.latestUserRequest
  const hardConstraints = uniqueOrdered([
    ...extractMatchingLines(currentPrompt, HARD_CONSTRAINT_PATTERN),
    ...recentMessages.filter((message) => message.role === 'user').flatMap((message) => extractMatchingLines(message.content, HARD_CONSTRAINT_PATTERN)),
    ...parsedSummaries.flatMap((summary) => extractMatchingLines(summary.latestUserRequest, HARD_CONSTRAINT_PATTERN))
  ])

  const confirmedDecisions = uniqueOrdered([
    ...parsedSummaries.flatMap((summary) => extractMatchingLines(summary.latestAssistantResult, DECISION_PATTERN)),
    ...recentMessages.filter((message) => message.role === 'assistant').flatMap((message) => extractMatchingLines(message.content, DECISION_PATTERN))
  ])

  const recentFailures = selectRecentUnique(
    parsedSummaries
      .flatMap((summary) => summary.toolEntries)
      .map((entry) => ({ entry, summary: summarizeToolEntry(entry) }))
      .filter(({ entry, summary }) => Boolean(summary) && (FAILURE_PATTERN.test(stringifyScalar(entry.status) ?? '') || FAILURE_PATTERN.test(stringifyScalar(entry.category) ?? '') || Boolean(stringifyScalar(entry.errorExcerpt))))
      .map(({ summary }) => `failure: ${summary!}`),
    4
  )

  const recentValidation = selectRecentUnique(
    [
      ...parsedSummaries
        .flatMap((summary) => summary.toolEntries)
        .map((entry) => ({ entry, summary: summarizeToolEntry(entry) }))
        .filter(({ entry, summary }) => Boolean(summary) && !Boolean(stringifyScalar(entry.errorExcerpt)) && (VALIDATION_PATTERN.test(stringifyScalar(entry.title) ?? '') || VALIDATION_PATTERN.test(stringifyScalar(entry.outputSummary) ?? '') || VALIDATION_PATTERN.test(stringifyScalar(entry.command) ?? '')))
        .map(({ summary }) => `validation: ${summary!}`),
      ...parsedSummaries
        .map((summary) => summary.latestAssistantResult)
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => extractMatchingLines(value, VALIDATION_PATTERN).map((line) => `validation: ${line}`))
    ],
    4
  )

  const importantFiles = uniqueOrdered(
    parsedSummaries.flatMap((summary) => summary.importantFiles)
  ).sort(compareText)

  const sourceOmissions = uniqueOrdered(parsedSummaries.flatMap((summary) => summary.truncationMarkers))
  const toolActivity = uniqueOrderedRecords(parsedSummaries.flatMap((summary) => summary.toolEntries))
  const sections: SummarySection[] = [
    {
      kind: 'plain',
      header: 'purpose:',
      lines: ['reusable_session_continuity_after_run_summary_overflow']
    }
  ]

  if (earliestGoal) {
    sections.push({
      kind: 'plain',
      header: 'earliest_user_goal:',
      lines: splitLines(earliestGoal)
    })
  }

  if (hardConstraints.length > 0) {
    sections.push({
      kind: 'plain',
      header: 'hard_constraints:',
      lines: hardConstraints.map((line) => `- ${line}`)
    })
  }

  if (confirmedDecisions.length > 0) {
    sections.push({
      kind: 'plain',
      header: 'confirmed_decisions:',
      lines: confirmedDecisions.map((line) => `- ${line}`)
    })
  }

  const recentFailuresAndValidation = uniqueOrdered([...recentFailures, ...recentValidation])
  if (recentFailuresAndValidation.length > 0) {
    sections.push({
      kind: 'plain',
      header: 'recent_failures_and_validation:',
      lines: recentFailuresAndValidation.map((line) => `- ${line}`)
    })
  }

  if (importantFiles.length > 0) {
    sections.push({
      kind: 'plain',
      header: 'important_files:',
      lines: importantFiles.map((file) => `- ${file}`)
    })
  }

  if (sourceOmissions.length > 0) {
    sections.push({
      kind: 'plain',
      header: 'source_omissions:',
      lines: sourceOmissions.map((line) => `- ${line}`)
    })
  }

  if (toolActivity.length > 0) {
    sections.push({
      kind: 'tool_activity',
      header: 'tool_activity:',
      lines: toolActivity.map((entry) => stableJsonStringify(entry))
    })
  }

  return sections.filter((section) => section.lines.length > 0)
}

function contextItemId(runId: string): string {
  return `context-item-${runId}-session-summary-v${SESSION_SUMMARY_CONTEXT_ITEM_VERSION}`
}

export function buildSessionCompaction(input: BuildSessionCompactionInput): SessionCompactionResult | undefined {
  const orderedRunSummaries = normalizeOrderedRunSummaries(input.runSummaries)
  const coveredRunIds = uniqueOrdered(orderedRunSummaries.map((summary) => summary.runId))
  if (coveredRunIds.length === 0) return undefined

  const parsedSummaries = orderedRunSummaries.map((summary) => parseRunSummary(summary))
  if (!parsedSummaries.some(hasMeaningfulSummary)) return undefined

  const recentMessages = normalizeOrderedMessages(input.recentMessages)
  const currentPrompt = input.currentPrompt ? sanitizeText(input.currentPrompt) : undefined
  const sections = buildSections(parsedSummaries, currentPrompt, recentMessages)
  if (sections.length === 0) return undefined

  const opening = `<hesper_session_context session_id="${escapeXmlAttribute(input.sessionId)}" covered_run_ids="${escapeXmlAttribute(coveredRunIds.join(','))}" version="${SESSION_SUMMARY_WRAPPER_VERSION}">`
  const closing = '</hesper_session_context>'
  const content = truncateSummary(opening, sections, closing, normalizeMaxChars(input.maxChars))
  if (!content) return undefined

  const lastCoveredRunId = coveredRunIds[coveredRunIds.length - 1]
  if (!lastCoveredRunId) return undefined

  const sourceHash = hashSourceMaterial({
    version: SESSION_SUMMARY_CONTEXT_ITEM_VERSION,
    sessionId: input.sessionId,
    coveredRunIds,
    runSummaries: orderedRunSummaries.map((summary) => ({
      runId: summary.runId,
      createdAt: summary.createdAt,
      ...(summary.version !== undefined ? { version: summary.version } : {}),
      content: sanitizeText(summary.content)
    })),
    recentMessages,
    ...(currentPrompt ? { currentPrompt } : {})
  })

  const item: RunContextItem = {
    id: contextItemId(lastCoveredRunId),
    sessionId: input.sessionId,
    runId: lastCoveredRunId,
    kind: 'session_summary',
    version: SESSION_SUMMARY_CONTEXT_ITEM_VERSION,
    content,
    tokenEstimate: Math.ceil(content.length / 4),
    sourceHash,
    createdAt: input.createdAt
  }

  return {
    item,
    coveredRunIds,
    sourceHash
  }
}
