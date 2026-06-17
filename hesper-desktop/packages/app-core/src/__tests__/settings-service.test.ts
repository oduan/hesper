import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { createSettingsService } from '../settings-service'

describe('createSettingsService', () => {
  it('returns the expected defaults', async () => {
    const persistence = await createInMemoryPersistence()
    const settings = await createSettingsService({ persistence }).getSettings()

    expect(settings).toEqual({
      defaultModelId: 'mock/hesper-fast',
      defaultOutputMode: 'markdown',
      themeMode: 'system'
    })
  })

  it('loads updated settings from persistence for new service instances', async () => {
    const persistence = await createInMemoryPersistence()
    const first = createSettingsService({ persistence })

    await first.updateSettings({
      defaultModelId: 'deepseek-chat',
      defaultOutputMode: 'html',
      themeMode: 'dark'
    })

    const second = createSettingsService({ persistence })
    await expect(second.getSettings()).resolves.toEqual({
      defaultModelId: 'deepseek-chat',
      defaultOutputMode: 'html',
      themeMode: 'dark'
    })
  })
})
