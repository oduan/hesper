import { describe, expect, it } from 'vitest'
import { defaultRetryPolicy, getRetryDelayMs, isRetryableRunError } from '../retry-policy'

describe('retry policy', () => {
  it('allows up to five retry attempts for retryable errors', () => {
    expect(defaultRetryPolicy.maxRetries).toBe(5)
    expect(isRetryableRunError({ code: 'stream_interrupted', message: 'lost', retryable: true })).toBe(true)
    expect(isRetryableRunError({ code: 'tool_error', message: 'bad tool', retryable: false })).toBe(false)
  })

  it('uses exponential backoff', () => {
    expect(getRetryDelayMs(defaultRetryPolicy, 0)).toBe(1500)
    expect(getRetryDelayMs(defaultRetryPolicy, 1)).toBe(2400)
    expect(getRetryDelayMs(defaultRetryPolicy, 2)).toBe(3840)
  })
})
