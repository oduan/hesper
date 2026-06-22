import { describe, expect, it, vi } from 'vitest'
import { startSkillService } from '../electron/skill-service-lifecycle'

describe('skill service lifecycle', () => {
  it('continues startup and starts auto scan when the initial refresh fails', async () => {
    const error = new Error('permission denied')
    const skillService = {
      refreshSkills: vi.fn(async () => {
        throw error
      }),
      startAutoScan: vi.fn()
    }
    const warn = vi.fn()

    await expect(startSkillService(skillService, warn)).resolves.toBeUndefined()

    expect(skillService.refreshSkills).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Failed to refresh skills during startup; continuing with the cached skill catalog.', error)
    expect(skillService.startAutoScan).toHaveBeenCalledTimes(1)
  })
})
