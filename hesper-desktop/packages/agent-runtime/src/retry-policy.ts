import type { RunError } from '@hesper/shared'

export type RetryPolicy = {
  maxRetries: number
  initialDelayMs: number
  backoffMultiplier: number
  retryableErrors: RunError['code'][]
}

export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 1500,
  backoffMultiplier: 1.6,
  retryableErrors: ['network_error', 'timeout', 'rate_limit_transient', 'stream_interrupted']
}

export function isRetryableRunError(error: RunError, policy = defaultRetryPolicy): boolean {
  return error.retryable && policy.retryableErrors.includes(error.code)
}

export function getRetryDelayMs(policy: RetryPolicy, retryCount: number): number {
  return Math.round(policy.initialDelayMs * policy.backoffMultiplier ** retryCount)
}
