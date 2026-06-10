import { describe, expect, it } from 'vitest'
import { err, isErr, isOk, ok, unwrap } from '../result'

describe('Result helpers', () => {
  it('unwraps ok values', () => {
    const value = ok(42)
    expect(isOk(value)).toBe(true)
    expect(unwrap(value)).toBe(42)
  })

  it('throws when unwrapping errors', () => {
    const value = err({ code: 'boom', message: 'Failed' })
    expect(isErr(value)).toBe(true)
    expect(() => unwrap(value)).toThrow('Failed')
  })
})
