import { describe, expect, it } from 'vitest'
import { builtinThemes, createThemeVariables, darkTheme, resolveThemeVariant, themeTokens } from '../theme'

type ThemeVariableMap = Record<string, string | number | undefined>

const vars = (value: unknown) => value as ThemeVariableMap

describe('built-in theme registry', () => {
  it('exposes supported built-in themes and variants', () => {
    expect(Object.keys(builtinThemes)).toEqual(['hesper', 'catppuccin', 'dracula', 'tokyo-night'])
    expect(builtinThemes.hesper.variants.map((variant) => variant.id)).toEqual(['light'])
    expect(builtinThemes.catppuccin.variants.map((variant) => variant.id)).toEqual(['light', 'dark'])
    expect(builtinThemes.dracula.variants.map((variant) => variant.id)).toEqual(['dark'])
    expect(builtinThemes['tokyo-night'].variants.map((variant) => variant.id)).toEqual(['dark'])
  })

  it('falls back to a dark variant when a theme does not support light mode', () => {
    const draculaVariant = resolveThemeVariant('dracula', 'light')
    const tokyoNightVariables = vars(createThemeVariables({ themeId: 'tokyo-night', mode: 'light', fontSize: 14 }))

    expect(draculaVariant.id).toBe('dark')
    expect(draculaVariant.colorScheme).toBe('dark')
    expect(tokyoNightVariables.colorScheme).toBe('dark')
  })

  it('generates Hesper light CSS variables', () => {
    const variables = vars(createThemeVariables({ themeId: 'hesper', mode: 'light', fontSize: 14 }))

    expect(variables.colorScheme).toBe('light')
    expect(variables['--hesper-font-size']).toBe('14px')
    expect(variables['--hesper-color-background']).toBe('#f4f4f2')
    expect(variables['--hesper-color-surface']).toBe('#ececea')
    expect(variables['--hesper-color-surface-muted']).toBe('#e4e4e1')
    expect(variables['--hesper-color-text']).toBe('#242421')
    expect(variables['--hesper-color-text-muted']).toBe('#70706a')
    expect(variables['--hesper-color-accent']).toBe('#b8b8b2')
    expect(variables['--hesper-color-accent-contrast']).toBe('#242421')
    expect(variables['--hesper-color-hover']).toBe('rgba(36, 36, 33, 0.08)')
    expect(variables['--hesper-color-soft-control']).toBe('rgba(184, 184, 178, 0.14)')
    expect(variables['--hesper-color-shadow']).toBe('rgba(72, 72, 67, 0.12)')
    expect(variables['--hesper-color-preview-background']).toBe('#f4f4f2')
  })

  it('generates Catppuccin Latte CSS variables with a neutral gray accent', () => {
    const variables = vars(createThemeVariables({ themeId: 'catppuccin', mode: 'light', fontSize: 14 }))

    expect(variables.colorScheme).toBe('light')
    expect(variables['--hesper-font-size']).toBe('14px')
    expect(variables['--hesper-color-background']).toBe('#dce0e8')
    expect(variables['--hesper-color-surface']).toBe('#eff1f5')
    expect(variables['--hesper-color-surface-muted']).toBe('#e6e9ef')
    expect(variables['--hesper-color-text']).toBe('#4c4f69')
    expect(variables['--hesper-color-text-muted']).toBe('#6c6f85')
    expect(variables['--hesper-color-accent']).not.toBe('#8839ef')
    expect(variables['--hesper-color-accent']).toBe('#bcc0cc')
    expect(variables['--hesper-color-accent-contrast']).toBe('#4c4f69')
    expect(variables['--hesper-color-hover']).toBe('rgba(188, 192, 204, 0.10)')
    expect(variables['--hesper-color-danger-soft']).toBe('rgba(210, 15, 57, 0.14)')
    expect(variables['--hesper-color-shadow']).toBe('rgba(76, 79, 105, 0.18)')
    expect(variables['--hesper-color-scrollbar-thumb-active']).toBe('rgba(76, 79, 105, 0.36)')
  })

  it('generates Catppuccin Mocha CSS variables with a neutral gray accent', () => {
    const variables = vars(createThemeVariables({ themeId: 'catppuccin', mode: 'dark', fontSize: 14 }))

    expect(variables.colorScheme).toBe('dark')
    expect(variables['--hesper-color-background']).toBe('#11111b')
    expect(variables['--hesper-color-surface']).toBe('#1e1e2e')
    expect(variables['--hesper-color-surface-muted']).toBe('#181825')
    expect(variables['--hesper-color-text']).toBe('#cdd6f4')
    expect(variables['--hesper-color-text-muted']).toBe('#a6adc8')
    expect(variables['--hesper-color-accent']).not.toBe('#cba6f7')
    expect(variables['--hesper-color-accent']).toBe('#a6adc8')
    expect(variables['--hesper-color-accent-contrast']).toBe('#11111b')
    expect(variables['--hesper-color-hover']).toBe('rgba(166, 173, 200, 0.12)')
    expect(variables['--hesper-color-success-soft']).toBe('rgba(166, 227, 161, 0.16)')
    expect(variables['--hesper-color-preview-background']).toBe('#11111b')
    expect(variables['--hesper-color-code-background']).toBe('#11111b')
  })

  it('keeps the old createThemeVariables signature compatible', () => {
    const variables = vars(createThemeVariables('dark', 15))

    expect(variables.colorScheme).toBe('dark')
    expect(variables['--hesper-font-size']).toBe('15px')
    expect(variables['--hesper-color-background']).toBe('#1a1b26')
    expect(variables['--hesper-color-accent']).toBe('#7aa2f7')
  })

  it('exports semantic theme tokens and keeps darkTheme as a compatibility alias', () => {
    expect(darkTheme).toBe(themeTokens)
    expect(themeTokens.color.accentContrast).toBe('var(--hesper-color-accent-contrast, #11111b)')
    expect(themeTokens.color.previewBackground).toBe('var(--hesper-color-preview-background, #11111b)')
    expect(themeTokens.color.scrollbarThumbActive).toBe('var(--hesper-color-scrollbar-thumb-active, rgba(205, 214, 244, 0.38))')
  })
})
