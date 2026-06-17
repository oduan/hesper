import type { Persistence } from '@hesper/persistence'

export type ThemeMode = 'system' | 'light' | 'dark'

export type AppSettings = {
  defaultModelId: string
  defaultOutputMode: 'markdown' | 'html'
  themeMode: ThemeMode
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
  defaultModelId: 'mock/hesper-fast',
  defaultOutputMode: 'markdown',
  themeMode: 'system'
}

export function createSettingsService(options: SettingsServiceOptions): SettingsService {
  const now = options.now ?? (() => new Date())
  const loadSettings = async (): Promise<AppSettings> => {
    const persisted = await options.persistence.settings.get()
    return {
      ...defaults,
      ...options.initial,
      ...(persisted
        ? {
            defaultModelId: persisted.defaultModelId,
            defaultOutputMode: persisted.defaultOutputMode,
            themeMode: persisted.themeMode
          }
        : {})
    }
  }

  return {
    getSettings: () => loadSettings(),
    updateSettings: async (patch) => {
      const next = { ...(await loadSettings()), ...patch }
      await options.persistence.settings.save({ ...next, updatedAt: now().toISOString() })
      return next
    }
  }
}
