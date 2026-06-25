import type { AgentRun, Message, RunStep } from '@hesper/shared'

export type BuildRunContextSummaryInput = {
  run: Pick<AgentRun, 'id'> & Partial<AgentRun>
  messages: Message[]
  steps: RunStep[]
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 6000
const FIELD_MAX_CHARS = 1800
const CONTEXT_CLOSE = '\n</hesper_run_context>'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized === 'apikey'
    || normalized === 'secret'
    || normalized === 'token'
    || normalized === 'password'
    || normalized === 'accesstoken'
    || normalized === 'refreshtoken'
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[redacted-sensitive-value]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-sensitive-value]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted-sensitive-value]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, '[redacted-sensitive-value]')
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted-sensitive-value]')
    .replace(/\bglpat-[A-Za-z0-9_-]{12,}\b/g, '[redacted-sensitive-value]')
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, '[redacted-sensitive-value]')
    .replace(/\bhf_[A-Za-z0-9]{20,}\b/g, '[redacted-sensitive-value]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-sensitive-value]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted-sensitive-value]')
    .replace(/(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted-sensitive-value]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)=)[^&#\s]+/gi, '$1[redacted-sensitive-value]')
    .replace(/\b(api[_ -]?key|secret|token|password)\b\s*[:=]\s*["']?[^"'\s,;|]+/gi, '[redacted-sensitive-value]')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

function stableCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareCreatedThenId<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  const byCreatedAt = stableCompare(left.createdAt, right.createdAt)
  return byCreatedAt === 0 ? stableCompare(left.id, right.id) : byCreatedAt
}

function stableJsonStringify(value: unknown, keyHint?: string): string {
  if (keyHint && isSensitiveKey(keyHint)) return JSON.stringify('[redacted-sensitive-value]')
  if (value === undefined) return JSON.stringify(null)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(redactSensitiveText(value))
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key], key)}`).join(',')}}`
  }
  return JSON.stringify(redactSensitiveText(String(value)))
}

function stringifyBounded(value: unknown, maxChars = FIELD_MAX_CHARS): string {
  const raw = typeof value === 'string' ? value : stableJsonStringify(value)
  const redacted = normalizeWhitespace(redactSensitiveText(raw))
  if (redacted.length <= maxChars) return redacted
  const markerReserve = 40
  const prefixLength = Math.max(0, maxChars - markerReserve)
  return `${redacted.slice(0, prefixLength)}\n[truncated ${redacted.length - prefixLength} chars]`
}

function latestContent(messages: Message[], role: Message['role']): string | undefined {
  const message = [...messages]
    .filter((candidate) => candidate.role === role && candidate.content.trim())
    .sort(compareCreatedThenId)
    .at(-1)
  return message ? stringifyBounded(message.content, 1200) : undefined
}

function parseStructuredDetail(detail: string): unknown {
  try {
    return JSON.parse(detail) as unknown
  } catch {
    return detail
  }
}

function boundedJsonValue(value: unknown, maxChars: number): unknown {
  const rendered = stableJsonStringify(value)
  if (rendered.length <= maxChars) return value
  return stringifyBounded(rendered, maxChars)
}

function renderStep(step: RunStep): string | undefined {
  if (step.type !== 'tool_call' && step.type !== 'tool_result') return undefined
  const payload: Record<string, unknown> = {
    type: step.type,
    status: step.status,
    title: stringifyBounded(step.title, 240)
  }
  if (step.summary) payload.summary = stringifyBounded(step.summary, 500)
  if (step.detail) payload.detail = boundedJsonValue(parseStructuredDetail(step.detail), 1400)
  return stableJsonStringify(payload)
}

function clampSummary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 0) return ''

  const hasClosing = value.endsWith(CONTEXT_CLOSE)
  const suffix = hasClosing ? CONTEXT_CLOSE : ''
  const body = hasClosing ? value.slice(0, -CONTEXT_CLOSE.length) : value
  let omitted = body.length
  let marker = `\n[truncated ${omitted} chars]`
  let prefixLength = maxChars - suffix.length - marker.length

  for (let index = 0; index < 4; index += 1) {
    if (prefixLength <= 0) break
    omitted = body.length - prefixLength
    marker = `\n[truncated ${omitted} chars]`
    const nextPrefixLength = maxChars - suffix.length - marker.length
    if (nextPrefixLength === prefixLength) break
    prefixLength = nextPrefixLength
  }

  if (prefixLength <= 0) {
    const compact = `${marker}${suffix}`
    return compact.length <= maxChars ? compact : compact.slice(0, maxChars)
  }

  return `${body.slice(0, prefixLength)}${marker}${suffix}`
}

export function buildRunContextSummary(input: BuildRunContextSummaryInput): string | undefined {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS
  const user = latestContent(input.messages, 'user')
  const assistant = latestContent(input.messages, 'assistant')
  const toolSections = [...input.steps]
    .sort(compareCreatedThenId)
    .map(renderStep)
    .filter((section): section is string => Boolean(section))

  const hasUsefulContext = Boolean(user || assistant || toolSections.length || input.run.error)
  if (!hasUsefulContext) return undefined

  const lines = [`<hesper_run_context run_id="${input.run.id}">`, 'purpose: previous_run_continuity_not_new_user_request']
  if (user) lines.push('latest_user_request:', user)
  if (assistant) lines.push('latest_assistant_result:', assistant)
  if (input.run.status === 'failed' && input.run.error) {
    lines.push('run_error:', stringifyBounded(input.run.error.message, 1200))
  }
  if (toolSections.length) {
    lines.push('tool_activity:')
    lines.push(...toolSections)
  }
  lines.push('</hesper_run_context>')
  return clampSummary(lines.join('\n'), maxChars)
}
