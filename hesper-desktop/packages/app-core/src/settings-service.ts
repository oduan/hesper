import type { Persistence } from '@hesper/persistence'
import { defaultAppThemeId, type AppThemeId, type ThemeMode } from '@hesper/shared'

export type AppSettings = {
  defaultModelId: string
  defaultOutputMode: 'markdown' | 'html'
  themeMode: ThemeMode
  themeId: AppThemeId
  fontSize: number
  soul: string
}

export type SettingsService = {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
}

type SettingsServiceOptions = {
  persistence: Persistence
  initial?: Partial<AppSettings>
  now?: () => Date
}

const defaults: AppSettings = {
  defaultModelId: '',
  defaultOutputMode: 'markdown',
  themeMode: 'system',
  themeId: defaultAppThemeId,
  fontSize: 14,
  soul: ''
}

export function createSettingsService(options: SettingsServiceOptions): SettingsService {
  const now = options.now ?? (() => new Date())
  let updateChain: Promise<void> = Promise.resolve()

  const loadSettings = async (): Promise<AppSettings> => {
    const persisted = await options.persistence.settings.get()
    return {
      ...defaults,
      ...options.initial,
      ...(persisted
        ? {
            defaultModelId: persisted.defaultModelId,
            defaultOutputMode: persisted.defaultOutputMode,
            themeMode: persisted.themeMode,
            themeId: persisted.themeId,
            fontSize: persisted.fontSize,
            soul: persisted.soul
          }
        : {})
    }
  }

  const queueUpdate = async <T>(task: () => Promise<T>): Promise<T> => {
    const result = updateChain.then(task, task)
    updateChain = result.then(() => {}, () => {})
    return result
  }

  return {
    getSettings: () => loadSettings(),
    updateSettings: (patch) => queueUpdate(async () => {
      const next = { ...(await loadSettings()), ...patch }
      await options.persistence.settings.save({ ...next, updatedAt: now().toISOString() })
      return next
    })
  }
}
