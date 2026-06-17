import { describe, expect, it } from 'vitest'
import { createHesperApi } from '../src/ipc-client'

describe('ipc-client fallback', () => {
  it('provides a safe fallback api when fallback is explicitly allowed', async () => {
    const api = createHesperApi({ allowFallback: true })
    const sessions = await api.sessions.list()
    const first = await api.sessions.create({ title: 'Fallback 1' })
    const second = await api.sessions.create({ title: 'Fallback 2' })

    expect(sessions).toEqual([])
    expect(first.title).toBe('Fallback 1')
    expect(second.title).toBe('Fallback 2')
    expect(first.status).toBe('active')
    expect(second.status).toBe('active')
    expect(first.id).not.toBe(second.id)
  })

  it('fails fast when preload api is unavailable outside fallback mode', () => {
    expect(() => createHesperApi({ allowFallback: false })).toThrowError('window.hesper preload API is unavailable')
  })
})
