import { describe, expect, it } from 'vitest'
import { hesperApi } from '../src/ipc-client'

describe('ipc-client fallback', () => {
  it('provides a safe fallback api when window.hesper is unavailable', async () => {
    const sessions = await hesperApi.sessions.list()
    const created = await hesperApi.sessions.create({ title: 'Fallback' })

    expect(sessions).toEqual([])
    expect(created.title).toBe('Fallback')
    expect(created.status).toBe('active')
  })
})
