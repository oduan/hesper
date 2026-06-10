export type ThemeMode = 'system' | 'light' | 'dark'

export type AppSettings = {
  defaultModelId: string
  defaultOutputMode: 'markdown' | 'html'
  themeMode: ThemeMode
}

export type SettingsService = {
  getSettings(): AppSettings
  updateSettings(patch: Partial<AppSettings>): AppSettings
}

const defaults: AppSettings = {
  defaultModelId: 'mock/hesper-fast',
  defaultOutputMode: 'markdown',
  themeMode: 'system'
}

export function createSettingsService(initial?: Partial<AppSettings>): SettingsService {
  let current: AppSettings = { ...defaults, ...initial }
  return {
    getSettings: () => ({ ...current }),
    updateSettings: (patch) => {
      current = { ...current, ...patch }
      return { ...current }
    }
  }
}
