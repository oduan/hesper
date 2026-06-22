import { describe, expect, it } from 'vitest'
import { appThemeIds, defaultAppThemeId, isAppThemeId, themeModeValues } from '../theme-settings'

describe('theme settings', () => {
  it('defines the supported built-in application theme ids', () => {
    expect(appThemeIds).toEqual(['catppuccin', 'dracula', 'tokyo-night'])
    expect(defaultAppThemeId).toBe('catppuccin')
  })

  it('checks application theme ids at runtime', () => {
    expect(isAppThemeId('catppuccin')).toBe(true)
    expect(isAppThemeId('dracula')).toBe(true)
    expect(isAppThemeId('tokyo-night')).toBe(true)
    expect(isAppThemeId('solarized')).toBe(false)
    expect(isAppThemeId(undefined)).toBe(false)
  })

  it('shares theme mode values for schema boundaries', () => {
    expect(themeModeValues).toEqual(['system', 'light', 'dark'])
  })
})
