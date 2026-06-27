import { describe, expect, it } from 'vitest'
import { builtinThemes, createThemeVariables, darkTheme, lightTheme, resolveThemeVariant, themeTokens } from '../theme'

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

  it('falls Hesper dark mode requests back to the light variant', () => {
    const variant = resolveThemeVariant('hesper', 'dark')
    const variables = vars(createThemeVariables({ themeId: 'hesper', mode: 'dark', fontSize: 14 }))

    expect(variant.id).toBe('light')
    expect(variant.colorScheme).toBe('light')
    expect(variables.colorScheme).toBe('light')
    expect(variables['--hesper-color-background']).toBe('#f6f8fb')
  })

  it('generates Hesper light CSS variables', () => {
    const variables = vars(createThemeVariables({ themeId: 'hesper', mode: 'light', fontSize: 14 }))

    expect(variables.colorScheme).toBe('light')
    expect(variables['--hesper-font-size']).toBe('14px')
    expect(variables['--hesper-color-background']).toBe('#f6f8fb')
    expect(variables['--hesper-color-surface']).toBe('#f3f6f9')
    expect(variables['--hesper-color-surface-muted']).toBe('#f0f4f8')
    expect(variables['--hesper-color-text']).toBe('#232a33')
    expect(variables['--hesper-color-text-muted']).toBe('#667282')
    expect(variables['--hesper-color-border']).toBe('#e2e8f0')
    expect(variables['--hesper-color-border-subtle']).toBe('rgba(226, 232, 240, 0.38)')
    expect(variables['--hesper-color-accent']).toBe('#c3ccd6')
    expect(variables['--hesper-color-accent-contrast']).toBe('#232a33')
    expect(variables['--hesper-color-hover']).toBe('rgba(38, 49, 61, 0.07)')
    expect(variables['--hesper-color-soft-control']).toBe('rgba(195, 204, 214, 0.14)')
    expect(variables['--hesper-color-shadow']).toBe('rgba(95, 111, 130, 0.08)')
    expect(variables['--hesper-color-preview-background']).toBe('#f6f8fb')
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

  it('exports semantic theme tokens with Hesper light fallbacks and keeps darkTheme as a compatibility alias', () => {
    expect(darkTheme).toBe(themeTokens)
    expect(lightTheme.color.background).toBe('#f6f8fb')
    expect(lightTheme.color.accent).toBe('#c3ccd6')
    expect(lightTheme.radius).toEqual({ sm: '5px', md: '7px', lg: '9px', xl: '12px' })
    expect(themeTokens.radius).toEqual({ sm: '5px', md: '7px', lg: '9px', xl: '12px' })
    expect(themeTokens.color.accentContrast).toBe('var(--hesper-color-accent-contrast, #232a33)')
    expect(themeTokens.color.previewBackground).toBe('var(--hesper-color-preview-background, #f6f8fb)')
    expect(themeTokens.color.scrollbarThumbActive).toBe('var(--hesper-color-scrollbar-thumb-active, rgba(102, 114, 130, 0.28))')
  })
})
