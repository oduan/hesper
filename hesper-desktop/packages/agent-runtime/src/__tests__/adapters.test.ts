import { describe, expect, it } from 'vitest'
import { normalizeUnknownError } from '../adapters'

describe('normalizeUnknownError', () => {
  it('redacts credential-shaped values from adapter error messages', () => {
    const error = normalizeUnknownError(new Error([
      'provider failed',
      'apiKey=sk-live-1234567890',
      'Bearer abcdefghijklmnopqrstuvwxyz123456',
      'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcd',
      'npm_abcdefghijklmnopqrstuvwxyz1234567890ABCD',
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
    ].join(' ')))

    expect(error.message).toContain('[redacted-sensitive-value]')
    expect(error.message).not.toContain('sk-live-1234567890')
    expect(error.message).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
    expect(error.message).not.toContain('github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcd')
    expect(error.message).not.toContain('npm_abcdefghijklmnopqrstuvwxyz1234567890ABCD')
    expect(error.message).not.toContain('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY')
  })

  it('normalizes 502 upstream Error messages to retryable network errors', () => {
    expect(normalizeUnknownError(new Error('502 Upstream service temporarily unavailable'))).toEqual({
      code: 'network_error',
      message: '502 Upstream service temporarily unavailable',
      retryable: true
    })
  })

  it('normalizes unknown provider upstream wrappers to retryable network errors', () => {
    expect(normalizeUnknownError({
      code: 'provider_error',
      message: 'Bad gateway from upstream provider',
      retryable: false
    })).toEqual({
      code: 'network_error',
      message: 'Bad gateway from upstream provider',
      retryable: true
    })
  })

  it('preserves non-secret provider guidance in normalized errors', () => {
    expect(normalizeUnknownError(new Error('Model provider needs an API key: openai')).message).toBe('Model provider needs an API key: openai')
  })
})
