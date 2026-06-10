import type { AgentRuntimeEvent, RunError } from '@hesper/shared'

export type AgentPromptInput = {
  runId: string
  sessionId: string
  prompt: string
  modelId: string
  workspacePath?: string
  signal: AbortSignal
}

export type AgentAdapter = {
  run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void>
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
      message: error.message,
      retryable: error.retryable
    }
  }

  if (error instanceof Error && /stream\s*interrupt/i.test(error.message)) {
    return { code: 'stream_interrupted', message: error.message, retryable: true }
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return { code: 'timeout', message: error.message, retryable: true }
  }
  if (error instanceof Error && /network|fetch|socket|econnreset|temporar/i.test(error.message)) {
    return { code: 'network_error', message: error.message, retryable: true }
  }

  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    retryable: false
  }
}
