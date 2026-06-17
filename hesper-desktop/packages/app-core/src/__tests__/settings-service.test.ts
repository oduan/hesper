import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import { createSettingsService } from '../settings-service'

type ControlledSettingsPersistence = {
  settings: {
    get: ReturnType<typeof vi.fn>
    save: ReturnType<typeof vi.fn>
  }
}

async function waitForExpectation(assertion: () => void, timeoutMs = 1000) {
  const startedAt = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

function createControlledSettingsPersistence(initial?: Record<string, unknown>) {
  let current = initial ? { ...initial } : undefined
  let releaseFirstSave!: () => void
  const firstSaveGate = new Promise<void>((resolve) => {
    releaseFirstSave = resolve
  })
  let saveCount = 0

  const persistence: ControlledSettingsPersistence = {
    settings: {
      get: vi.fn(async () => (current ? { ...current } : undefined)),
      save: vi.fn(async (settings) => {
        saveCount += 1
        if (saveCount === 1) {
          await firstSaveGate
        }
        current = { ...settings }
      })
    }
  }

  return {
    persistence: persistence as any,
    getCurrent: () => current,
    getSpy: persistence.settings.get,
    saveSpy: persistence.settings.save,
    releaseFirstSave: () => releaseFirstSave()
  }
}

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

  it('serializes concurrent updates so patches are merged', async () => {
    const { persistence, getSpy, saveSpy, releaseFirstSave } = createControlledSettingsPersistence()
    const service = createSettingsService({ persistence })

    const firstUpdate = service.updateSettings({ defaultModelId: 'deepseek-chat' })
    await waitForExpectation(() => expect(saveSpy).toHaveBeenCalledTimes(1))

    const secondUpdate = service.updateSettings({ themeMode: 'dark' })
    expect(getSpy).toHaveBeenCalledTimes(1)

    releaseFirstSave()
    await Promise.all([firstUpdate, secondUpdate])

    await expect(service.getSettings()).resolves.toEqual({
      defaultModelId: 'deepseek-chat',
      defaultOutputMode: 'markdown',
      themeMode: 'dark'
    })
  })

  it('keeps later settings updates moving after an earlier save fails', async () => {
    let current = undefined as Record<string, unknown> | undefined
    let rejectFirstSave!: (reason: Error) => void
    let saveCalls = 0
    const firstSaveGate = new Promise<void>((_resolve, reject) => {
      rejectFirstSave = reject
    })
    const settings = {
      get: vi.fn(async () => (current ? { ...current } : undefined)),
      save: vi.fn(async (next: Record<string, unknown>) => {
        saveCalls += 1
        if (saveCalls === 1) {
          await firstSaveGate
        }
        current = { ...next }
      })
    }
    const service = createSettingsService({ persistence: { settings } as any })

    const firstUpdate = service.updateSettings({ defaultModelId: 'broken-model' })
    await waitForExpectation(() => expect(settings.save).toHaveBeenCalledTimes(1))

    const secondUpdate = service.updateSettings({ themeMode: 'dark' })
    expect(settings.get).toHaveBeenCalledTimes(1)

    rejectFirstSave(new Error('save failed'))
    await expect(firstUpdate).rejects.toThrow('save failed')

    await waitForExpectation(() => expect(settings.get).toHaveBeenCalledTimes(2))
    await expect(secondUpdate).resolves.toEqual({
      defaultModelId: 'mock/hesper-fast',
      defaultOutputMode: 'markdown',
      themeMode: 'dark'
    })
    await expect(service.getSettings()).resolves.toEqual({
      defaultModelId: 'mock/hesper-fast',
      defaultOutputMode: 'markdown',
      themeMode: 'dark'
    })
  })
})
