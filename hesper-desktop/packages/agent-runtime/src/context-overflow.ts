import type { RunError } from '@hesper/shared'

const CONTEXT_OVERFLOW_MESSAGE_PATTERNS = [
  /context length/i,
  /maximum context/i,
  /input is too long/i,
  /too many tokens/i,
  /token limit/i,
  /prompt is too long/i,
  /context window/i,
  /maximum context length/i
]

const CONTEXT_OVERFLOW_CODES = new Set(['context_overflow', 'context_length_exceeded', 'prompt_too_long', 'too_many_tokens'])
const MAX_OVERFLOW_RETRIES = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function messageFromError(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return undefined
}

function codeFromError(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

export function isContextOverflowError(error: RunError | unknown): boolean {
  const code = codeFromError(error)
  if (code && CONTEXT_OVERFLOW_CODES.has(code)) return true

  const message = messageFromError(error)
  return Boolean(message && CONTEXT_OVERFLOW_MESSAGE_PATTERNS.some((pattern) => pattern.test(message)))
}

export function nextOverflowAttempt(current: number): number | undefined {
  return current >= MAX_OVERFLOW_RETRIES ? undefined : current + 1
}
