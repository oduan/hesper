import type { RunStep } from '@hesper/shared'

export type ReducedToolDetail = {
  title: string
  status: RunStep['status']
  type: RunStep['type']
  category: 'success' | 'diagnostic' | 'error' | 'bulk_output' | 'empty' | 'unknown'
  command?: string
  exitCode?: number
  files?: string[]
  errorExcerpt?: string
  outputSummary?: string
  omittedChars?: number
}

type ToolStepLike = Pick<RunStep, 'status' | 'title' | 'type'> & Partial<Pick<RunStep, 'detail'>>
type ParsedCommandText = {
  command?: string
  exitCode?: number
  stdout?: string
  stderr?: string
}

const REDACTED_VALUE = '[redacted-sensitive-value]'
const MAX_FILES = 6
const MAX_SUMMARY_CHARS = 280
const MAX_DIAGNOSTIC_LINES = 6
const MAX_FAILURE_LINES = 7
const NON_MEANINGFUL_RESULT_KEYS = new Set(['display', 'displayName', 'platform', 'shell', 'toolCallId', 'toolIcon', 'toolId', 'workspacePath'])

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? sanitizeText(value) || undefined : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeDetailValue(detail: string | undefined): unknown | undefined {
  if (typeof detail !== 'string') return undefined
  const normalized = normalizeLineEndings(detail).trim()
  if (!normalized) return undefined
  try {
    return JSON.parse(normalized) as unknown
  } catch {
    return normalized
  }
}

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === 'string') return [sanitizeText(value)].filter(Boolean)
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [sanitizeText(item)].filter(Boolean)
      if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') return []
      const text = sanitizeText(item.text)
      return text ? [text] : []
    })
  }
  if (!isRecord(value)) return []
  if (typeof value.content === 'string') return [sanitizeText(value.content)].filter(Boolean)
  if (Array.isArray(value.content)) return extractTextBlocks(value.content)
  return []
}

function parseCommandText(detail: string): ParsedCommandText {
  const lines = normalizeLineEndings(detail).split('\n')
  const stdout: string[] = []
  const stderr: string[] = []
  let command: string | undefined
  let exitCode: number | undefined
  let currentSection: 'stdout' | 'stderr' | undefined

  for (const line of lines) {
    if (line.trim() === 'stdout:') {
      currentSection = 'stdout'
      continue
    }
    if (line.trim() === 'stderr:') {
      currentSection = 'stderr'
      continue
    }
    if (currentSection === 'stdout') {
      stdout.push(line)
      continue
    }
    if (currentSection === 'stderr') {
      stderr.push(line)
      continue
    }
    if (line.startsWith('Command: ')) {
      command = sanitizeText(line.slice('Command: '.length)) || undefined
      continue
    }
    if (line.startsWith('Exit code: ')) {
      const parsed = Number(line.slice('Exit code: '.length).trim())
      exitCode = Number.isFinite(parsed) ? parsed : undefined
      continue
    }
  }

  const stdoutText = sanitizeText(stdout.join('\n'))
  const stderrText = sanitizeText(stderr.join('\n'))
  return {
    ...(command !== undefined ? { command } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(stdoutText ? { stdout: stdoutText } : {}),
    ...(stderrText ? { stderr: stderrText } : {})
  }
}

function extractToolId(payload: Record<string, unknown>): string | undefined {
  const output = isRecord(payload.output) ? payload.output : undefined
  const details = isRecord(output?.details) ? output.details : undefined
  const result = isRecord(details?.result) ? details.result : undefined
  return stringValue(payload.toolId)
    ?? stringValue(output?.toolId)
    ?? stringValue(details?.toolId)
    ?? stringValue(result?.toolId)
}

function extractOutputRecord(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const output = isRecord(payload.output) ? payload.output : undefined
  if (!output) return undefined
  const details = isRecord(output.details) ? output.details : undefined
  return isRecord(details?.result)
    ? details.result
    : isRecord(output.result)
      ? output.result
      : details
}

function extractOutputText(payload: Record<string, unknown>): string | undefined {
  const output = payload.output
  const blocks = extractTextBlocks(output)
  if (blocks.length > 0) return blocks.join('\n')
  return typeof output === 'string' ? sanitizeText(output) || undefined : undefined
}

function normalizePathCandidate(value: string): string | undefined {
  const trimmed = value.trim().replace(/^at\s+/, '').replace(/["'`()\[\],]+$/g, '')
  if (!trimmed || trimmed === '.' || trimmed === '..') return undefined
  const withoutLineInfo = trimmed.replace(/:(\d+)(?::\d+)?$/g, '')
  const normalized = withoutLineInfo.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!/[/.]/.test(normalized) || !/[A-Za-z0-9]$/.test(normalized)) return undefined
  return normalized
}

function collectPathFromText(text: string, bucket: Set<string>): void {
  const lines = normalizeLineEndings(text).split('\n')
  const patterns = [
    /^(?:PASS|FAIL)\s+(.+?\.[A-Za-z0-9]+)(?::\d+(?::\d+)?)?$/,
    /^(?:Created|Wrote|Updated|Edited|Deleted|Read)\s+(.+?\.[A-Za-z0-9]+)(?::\d+(?::\d+)?)?$/,
    /^at\s+(.+?\.[A-Za-z0-9]+)(?::\d+(?::\d+)?)?$/,
    /^(.+?\.[A-Za-z0-9]+):\d+/
  ]

  for (const rawLine of lines) {
    const line = sanitizeText(rawLine)
    if (!line) continue
    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (!match?.[1]) continue
      const normalized = normalizePathCandidate(match[1])
      if (normalized) bucket.add(normalized)
    }
  }
}

function collectFiles(value: unknown, bucket: Set<string>): void {
  if (!value) return
  if (typeof value === 'string') {
    collectPathFromText(value, bucket)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFiles(item, bucket)
    return
  }
  if (!isRecord(value)) return

  const results = Array.isArray(value.results) ? value.results : undefined
  const directPath = stringValue(value.path)
  if (directPath && !results) {
    const normalized = normalizePathCandidate(directPath)
    if (normalized && normalized !== 'workspacePath') bucket.add(normalized)
  }

  if (Array.isArray(value.paths)) {
    for (const candidate of value.paths) {
      const text = stringValue(candidate)
      const normalized = text ? normalizePathCandidate(text) : undefined
      if (normalized) bucket.add(normalized)
    }
  }

  if (results) {
    for (const result of results) collectFiles(result, bucket)
  }

  if (Array.isArray(value.matches)) {
    for (const match of value.matches) {
      if (!isRecord(match)) continue
      const line = stringValue(match.line)
      if (line) collectPathFromText(line, bucket)
    }
  }
}

function finalizeFiles(bucket: Set<string>): string[] | undefined {
  if (bucket.size === 0) return undefined
  return [...bucket].sort(compareText).slice(0, MAX_FILES)
}

function truncateText(value: string, maxChars: number): { text: string; omittedChars?: number } {
  if (value.length <= maxChars) return { text: value }
  const trimmed = value.slice(0, maxChars).trimEnd()
  return { text: trimmed, omittedChars: value.length - trimmed.length }
}

function buildSearchSummary(result: Record<string, unknown>): { text?: string; omittedChars?: number } {
  const results = Array.isArray(result.results) ? result.results.filter(isRecord) : []
  const orderedResults = results
    .map((entry) => ({
      path: stringValue(entry.path) ?? '',
      matches: Array.isArray(entry.matches) ? entry.matches.filter(isRecord) : []
    }))
    .filter((entry) => entry.path)
    .sort((left, right) => compareText(left.path, right.path))

  const lines: string[] = []
  for (const entry of orderedResults) {
    for (const match of entry.matches) {
      if (lines.length >= MAX_DIAGNOSTIC_LINES) break
      const lineNumber = numberValue(match.lineNumber)
      const line = stringValue(match.line)
      if (!lineNumber || !line) continue
      lines.push(`${entry.path}:${lineNumber} ${line}`)
    }
    if (lines.length >= MAX_DIAGNOSTIC_LINES) break
  }

  if (lines.length === 0) return {}
  if (result.truncated === true) lines.push('[additional search results omitted]')
  const summary = lines.join('\n')
  return truncateText(summary, MAX_SUMMARY_CHARS)
}

function buildFailureExcerpt(text: string): { text?: string; omittedChars?: number } {
  const lines = sanitizeText(text).split('\n').map((line) => line.trim()).filter(Boolean)
  const selected: string[] = []

  for (const line of lines) {
    if (!(
      /^(?:FAIL|ERROR|AssertionError|TypeError|ReferenceError)/.test(line)
      || /^(?:- Expected|\+ Received|[-+]\s)/.test(line)
      || /^at\s+/.test(line)
    )) {
      continue
    }
    if (!selected.includes(line)) selected.push(line)
    if (selected.length >= MAX_FAILURE_LINES) break
  }

  const excerpt = (selected.length > 0 ? selected : lines.slice(0, MAX_FAILURE_LINES)).join('\n')
  return excerpt ? truncateText(excerpt, MAX_SUMMARY_CHARS) : {}
}

function buildCompactSummary(text: string): { text?: string; omittedChars?: number } {
  const lines = sanitizeText(text).split('\n').map((line) => line.trim()).filter(Boolean)
  const full = lines.join('\n')
  const summary = lines.slice(0, 6).join('\n')
  if (!summary) return {}

  const truncated = truncateText(summary, MAX_SUMMARY_CHARS)
  const omittedByLineLimit = full.length > summary.length ? full.length - summary.length : 0
  const omittedByCharLimit = truncated.omittedChars ?? 0
  const omittedChars = omittedByLineLimit + omittedByCharLimit
  return {
    text: truncated.text,
    ...(omittedChars > 0 ? { omittedChars } : {})
  }
}

function extractCommand(payload: Record<string, unknown>, result: Record<string, unknown> | undefined, parsedText: ParsedCommandText): string | undefined {
  const input = isRecord(payload.input) ? payload.input : undefined
  return stringValue(result?.command)
    ?? stringValue(result?.executedCommand)
    ?? stringValue(input?.command)
    ?? parsedText.command
}

function extractExitCode(result: Record<string, unknown> | undefined, parsedText: ParsedCommandText): number | undefined {
  return numberValue(result?.exitCode) ?? parsedText.exitCode
}

function hasSearchMatchResults(result: Record<string, unknown> | undefined): boolean {
  return Array.isArray(result?.results) && result.results.some((entry) => (
    isRecord(entry)
    && Array.isArray(entry.matches)
    && entry.matches.some((match) => isRecord(match) && typeof match.line === 'string' && typeof match.lineNumber === 'number')
  ))
}

function isDiagnosticTool(toolId: string | undefined, result: Record<string, unknown> | undefined): boolean {
  if (toolId && /(?:^|\.)(?:grep|search(?:-files)?)$/i.test(toolId)) return true
  return hasSearchMatchResults(result)
}

function hasMeaningfulStructuredOutput(result: Record<string, unknown> | undefined): boolean {
  if (!result) return false
  return Object.keys(result).some((key) => !NON_MEANINGFUL_RESULT_KEYS.has(key))
}

export function reduceToolOutput(step: ToolStepLike): ReducedToolDetail | undefined {
  if (step.type !== 'tool_call' && step.type !== 'tool_result') return undefined

  const base: ReducedToolDetail = {
    title: sanitizeText(step.title) || step.title,
    status: step.status,
    type: step.type,
    category: 'unknown'
  }

  const detailValue = normalizeDetailValue(step.detail)
  if (detailValue === undefined) {
    return { ...base, category: 'empty' }
  }

  const detailText = typeof detailValue === 'string' ? sanitizeText(detailValue) : undefined
  const payload = isRecord(detailValue) ? detailValue : undefined
  const result = payload ? extractOutputRecord(payload) : undefined
  const outputText = payload ? extractOutputText(payload) : detailText
  const parsedText = typeof outputText === 'string' ? parseCommandText(outputText) : detailText ? parseCommandText(detailText) : {}
  const toolId = payload ? extractToolId(payload) : undefined
  const command = payload ? extractCommand(payload, result, parsedText) : parsedText.command
  const exitCode = extractExitCode(result, parsedText)
  const isError = step.status === 'failed' || (payload?.isError === true) || (typeof exitCode === 'number' && exitCode !== 0)

  const fileBucket = new Set<string>()
  if (payload) {
    collectFiles(result, fileBucket)
    if (outputText) collectFiles(outputText, fileBucket)
    if (fileBucket.size === 0) collectFiles(payload.input, fileBucket)
  } else if (detailText) {
    collectFiles(detailText, fileBucket)
  }
  const files = finalizeFiles(fileBucket)

  if (isError) {
    const errorSource = result?.stderr && typeof result.stderr === 'string'
      ? result.stderr
      : parsedText.stderr ?? outputText ?? detailText ?? ''
    const excerpt = buildFailureExcerpt(errorSource)
    const reduced: ReducedToolDetail = {
      ...base,
      category: 'error',
      ...(command ? { command } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(files ? { files } : {})
    }
    if (excerpt.text) {
      reduced.errorExcerpt = excerpt.text
      reduced.outputSummary = excerpt.text
    }
    if (excerpt.omittedChars !== undefined) reduced.omittedChars = excerpt.omittedChars
    return reduced
  }

  if (payload && isDiagnosticTool(toolId, result)) {
    const reduced: ReducedToolDetail = {
      ...base,
      category: 'diagnostic',
      ...(files ? { files } : {})
    }
    const summary = result ? buildSearchSummary(result) : {}
    if (summary.text) reduced.outputSummary = summary.text
    if (summary.omittedChars !== undefined) reduced.omittedChars = summary.omittedChars
    return reduced
  }

  const summarySource = typeof result?.stdout === 'string' && sanitizeText(result.stdout)
    ? sanitizeText(result.stdout)
    : outputText ?? detailText

  if (!summarySource && !command && !hasMeaningfulStructuredOutput(result)) {
    return {
      ...base,
      category: 'empty',
      ...(files ? { files } : {})
    }
  }

  const summary = summarySource ? buildCompactSummary(summarySource) : {}
  const category = summary.omittedChars !== undefined ? 'bulk_output' : 'success'
  const reduced: ReducedToolDetail = {
    ...base,
    category,
    ...(command ? { command } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(files ? { files } : {})
  }
  if (summary.text) reduced.outputSummary = summary.text
  if (summary.omittedChars !== undefined) reduced.omittedChars = summary.omittedChars
  return reduced
}
