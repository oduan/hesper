import { describe, expect, it } from 'vitest'
import { createId } from '../ids'

describe('ID helpers', () => {
  it('creates prefixed unique ids', () => {
    const a = createId('session')
    const b = createId('session')

    expect(a.startsWith('session-')).toBe(true)
    expect(b.startsWith('session-')).toBe(true)
    expect(a).not.toBe(b)
  })
})
