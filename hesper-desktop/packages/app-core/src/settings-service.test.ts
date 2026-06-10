import { describe, expect, it } from 'vitest'
import { createSettingsService } from './settings-service'

describe('createSettingsService', () => {
  it('returns the expected defaults', () => {
    const settings = createSettingsService().getSettings()

    expect(settings).toEqual({
      defaultModelId: 'mock/hesper-fast',
      defaultOutputMode: 'markdown',
      themeMode: 'system'
    })
  })
})
