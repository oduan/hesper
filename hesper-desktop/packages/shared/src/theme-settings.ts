export const appThemeIds = ['hesper', 'catppuccin', 'dracula', 'tokyo-night'] as const
export type AppThemeId = (typeof appThemeIds)[number]

export const defaultAppThemeId: AppThemeId = 'hesper'

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && (appThemeIds as readonly string[]).includes(value)
}

export const themeModeValues = ['system', 'light', 'dark'] as const
export type ThemeMode = (typeof themeModeValues)[number]
