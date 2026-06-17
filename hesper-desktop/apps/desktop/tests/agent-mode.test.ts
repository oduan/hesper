import { describe, expect, it } from 'vitest'
import { resolveAgentMode } from '../electron/agent-mode'

describe('desktop agent mode', () => {
  it('uses the real pi-core runtime by default', () => {
    expect(resolveAgentMode({})).toBe('pi-core')
  })

  it('keeps mock mode only as an explicit override', () => {
    expect(resolveAgentMode({ HESPER_AGENT_MODE: 'mock' })).toBe('mock')
    expect(resolveAgentMode({ HESPER_AGENT_MODE: 'pi-core' })).toBe('pi-core')
  })
})
