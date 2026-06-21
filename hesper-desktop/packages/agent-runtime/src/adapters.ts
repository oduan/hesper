import type { AgentRuntimeEvent, Message, ModelRef, RunError } from '@hesper/shared'

export type AgentPromptInput = {
  runId: string
  sessionId: string
  prompt: string
  modelId: string
  modelRef?: ModelRef
  systemPrompt?: string
  enabledToolIds?: string[]
  workspacePath?: string
  historyMessages?: Message[]
  signal: AbortSignal
}

export type AgentAdapter = {
  run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void>
}

function shouldRedactLabeledValue(label: string, candidate: string): boolean {
  if (/password/i.test(label)) return true
  return candidate.length >= 8
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, '[redacted-sensitive-value]')
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
    .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, (candidate) => {
      return /[a-z]/.test(candidate) && /[A-Z]/.test(candidate) && /\d/.test(candidate)
        ? '[redacted-sensitive-value]'
        : candidate
    })
    .replace(/\b(api[_ -]?key|secret|token|password)\b\s*[:=]\s*["']?([^"'\s,;]+)/gi, (match, label: string, candidate: string) => {
      return shouldRedactLabeledValue(label, candidate) ? '[redacted-sensitive-value]' : match
    })
}

function isRunErrorLike(value: unknown): value is RunError {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'code' in value &&
      'message' in value &&
      'retryable' in value
  )
}

export function normalizeUnknownError(error: unknown): RunError {
  if (isRunErrorLike(error)) {
    return {
      code: error.code,
      message: redactSensitiveText(error.message),
      retryable: error.retryable
    }
  }

  if (error instanceof Error && /stream\s*interrupt/i.test(error.message)) {
    return { code: 'stream_interrupted', message: redactSensitiveText(error.message), retryable: true }
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return { code: 'timeout', message: redactSensitiveText(error.message), retryable: true }
  }
  if (error instanceof Error && /network|fetch|socket|econnreset|temporar/i.test(error.message)) {
    return { code: 'network_error', message: redactSensitiveText(error.message), retryable: true }
  }

  return {
    code: 'unknown',
    message: redactSensitiveText(error instanceof Error ? error.message : String(error)),
    retryable: false
  }
}
