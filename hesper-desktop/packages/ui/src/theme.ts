import type { CSSProperties } from 'react'

export type ThemeMode = 'light' | 'dark'

export type ThemePalette = {
  background: string
  surface: string
  surfaceMuted: string
  text: string
  textMuted: string
  border: string
  accent: string
  accentContrast: string
  success: string
  danger: string
  warning: string
  hover: string
  softControl: string
  toolToggle: string
  toolToggleSoft: string
  dangerSoft: string
  dangerStrong: string
  successSoft: string
  warningSoft: string
  borderSubtle: string
  neutralSoft: string
  codeBackground: string
  shadow: string
  previewBackground: string
  scrollbarThumb: string
  scrollbarThumbHover: string
  scrollbarThumbActive: string
}

export type ThemeTokens = {
  color: ThemePalette
  radius: { sm: string; md: string; lg: string; xl: string }
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string }
  typography: { body: string | number; tiny: number }
}

export type BuiltinThemeVariant = {
  id: ThemeMode
  label: string
  colorScheme: ThemeMode
  palette: ThemePalette
}

export type BuiltinTheme = {
  id: string
  label: string
  variants: BuiltinThemeVariant[]
}

const radius = { sm: '8px', md: '12px', lg: '16px', xl: '20px' }
const spacing = { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' }

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace('#', '')
  const value = normalized.length === 3 ? normalized.split('').map((char) => `${char}${char}`).join('') : normalized
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)]
}

const rgba = (hex: string, alpha: number) => {
  const [red, green, blue] = hexToRgb(hex)
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`
}

type PaletteSeed = {
  background: string
  surface: string
  surfaceMuted: string
  text: string
  textMuted: string
  border: string
  accent: string
  accentContrast: string
  success: string
  danger: string
  warning: string
  hoverSource?: string
  hoverAlpha?: number
  toolToggle?: string
  codeBackground?: string
  previewBackground?: string
  scrollbarSource?: string
  scrollbarHoverAlpha?: number
  scrollbarActiveAlpha?: number
  shadowSource?: string
  shadowAlpha?: number
}

const derivePalette = ({
  hoverSource,
  hoverAlpha = 0.12,
  toolToggle,
  codeBackground,
  previewBackground,
  scrollbarSource,
  scrollbarHoverAlpha = 0.24,
  scrollbarActiveAlpha = 0.38,
  shadowSource,
  shadowAlpha = 0.18,
  ...seed
}: PaletteSeed): ThemePalette => {
  const toggleColor = toolToggle ?? seed.accent
  const scrollbarColor = scrollbarSource ?? seed.text
  return {
    ...seed,
    hover: rgba(hoverSource ?? seed.accent, hoverAlpha),
    softControl: rgba(seed.accent, 0.14),
    toolToggle: toggleColor,
    toolToggleSoft: rgba(toggleColor, 0.14),
    dangerSoft: rgba(seed.danger, 0.14),
    dangerStrong: seed.danger,
    successSoft: rgba(seed.success, 0.16),
    warningSoft: rgba(seed.warning, 0.16),
    borderSubtle: rgba(seed.border, 0.38),
    neutralSoft: rgba(seed.text, 0.10),
    codeBackground: codeBackground ?? seed.background,
    shadow: rgba(shadowSource ?? seed.text, shadowAlpha),
    previewBackground: previewBackground ?? seed.surface,
    scrollbarThumb: rgba(scrollbarColor, 0.10),
    scrollbarThumbHover: rgba(scrollbarColor, scrollbarHoverAlpha),
    scrollbarThumbActive: rgba(scrollbarColor, scrollbarActiveAlpha)
  }
}

const hesperLightPalette = derivePalette({
  background: '#f4f4f2',
  surface: '#ececea',
  surfaceMuted: '#e4e4e1',
  text: '#242421',
  textMuted: '#70706a',
  border: '#d2d2ce',
  accent: '#b8b8b2',
  accentContrast: '#242421',
  success: '#4f8a5b',
  danger: '#b15a55',
  warning: '#a77f3f',
  hoverSource: '#242421',
  hoverAlpha: 0.08,
  toolToggle: '#8a8a84',
  codeBackground: '#ececea',
  previewBackground: '#f4f4f2',
  scrollbarSource: '#70706a',
  scrollbarHoverAlpha: 0.18,
  scrollbarActiveAlpha: 0.30,
  shadowSource: '#484843',
  shadowAlpha: 0.12
})

const catppuccinLattePalette = derivePalette({
  // Catppuccin Latte: https://github.com/catppuccin/catppuccin
  background: '#dce0e8', // crust
  surface: '#eff1f5', // base
  surfaceMuted: '#e6e9ef', // mantle
  text: '#4c4f69',
  textMuted: '#6c6f85',
  border: '#bcc0cc', // surface1
  accent: '#bcc0cc', // neutral gray
  accentContrast: '#4c4f69',
  success: '#40a02b', // green
  danger: '#d20f39', // red
  warning: '#df8e1d', // yellow
  hoverAlpha: 0.10,
  toolToggle: '#40a02b',
  codeBackground: '#eff1f5',
  previewBackground: '#eff1f5',
  scrollbarSource: '#4c4f69',
  scrollbarHoverAlpha: 0.22,
  scrollbarActiveAlpha: 0.36,
  shadowSource: '#4c4f69'
})

const catppuccinMochaPalette = derivePalette({
  // Catppuccin Mocha: https://github.com/catppuccin/catppuccin
  background: '#11111b', // crust
  surface: '#1e1e2e', // base
  surfaceMuted: '#181825', // mantle
  text: '#cdd6f4',
  textMuted: '#a6adc8',
  border: '#313244', // surface0
  accent: '#a6adc8', // neutral gray
  accentContrast: '#11111b',
  success: '#a6e3a1', // green
  danger: '#f38ba8', // red
  warning: '#f9e2af', // yellow
  codeBackground: '#11111b',
  previewBackground: '#11111b'
})

const draculaPalette = derivePalette({
  // Dracula official OSS palette: https://github.com/dracula/dracula-theme
  background: '#282a36',
  surface: '#343746',
  surfaceMuted: '#44475a',
  text: '#f8f8f2',
  textMuted: '#6272a4',
  border: '#44475a',
  accent: '#bd93f9',
  accentContrast: '#282a36',
  success: '#50fa7b',
  danger: '#ff5555',
  warning: '#f1fa8c',
  toolToggle: '#8be9fd',
  codeBackground: '#282a36',
  previewBackground: '#282a36'
})

const tokyoNightPalette = derivePalette({
  // Tokyo Night Night palette: https://github.com/folke/tokyonight.nvim
  background: '#1a1b26',
  surface: '#16161e',
  surfaceMuted: '#24283b',
  text: '#c0caf5',
  textMuted: '#737aa2',
  border: '#414868',
  accent: '#7aa2f7',
  accentContrast: '#16161e',
  success: '#9ece6a',
  danger: '#f7768e',
  warning: '#e0af68',
  codeBackground: '#16161e',
  previewBackground: '#16161e'
})

export const builtinThemes = {
  hesper: {
    id: 'hesper',
    label: 'Hesper',
    variants: [{ id: 'light', label: 'Light', colorScheme: 'light', palette: hesperLightPalette }]
  },
  catppuccin: {
    id: 'catppuccin',
    label: 'Catppuccin',
    variants: [
      { id: 'light', label: 'Latte', colorScheme: 'light', palette: catppuccinLattePalette },
      { id: 'dark', label: 'Mocha', colorScheme: 'dark', palette: catppuccinMochaPalette }
    ]
  },
  dracula: {
    id: 'dracula',
    label: 'Dracula',
    variants: [{ id: 'dark', label: 'Dracula', colorScheme: 'dark', palette: draculaPalette }]
  },
  'tokyo-night': {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    variants: [{ id: 'dark', label: 'Night', colorScheme: 'dark', palette: tokyoNightPalette }]
  }
} satisfies Record<string, BuiltinTheme>

export type BuiltinThemeId = keyof typeof builtinThemes

const defaultThemeId = 'hesper' satisfies BuiltinThemeId

const isBuiltinThemeId = (themeId: string): themeId is BuiltinThemeId => themeId in builtinThemes

export function resolveThemeVariant(themeId: BuiltinThemeId, mode: ThemeMode): BuiltinThemeVariant
export function resolveThemeVariant(themeId: string, mode: ThemeMode): BuiltinThemeVariant
export function resolveThemeVariant(themeId: string, mode: ThemeMode): BuiltinThemeVariant {
  const theme = builtinThemes[isBuiltinThemeId(themeId) ? themeId : defaultThemeId]
  const [firstVariant] = theme.variants
  const variant = theme.variants.find((candidate) => candidate.id === mode) ?? theme.variants.find((candidate) => candidate.id === 'dark') ?? firstVariant

  if (!variant) {
    throw new Error(`Built-in theme "${theme.id}" has no variants`)
  }

  return variant
}

const colorVariableNames: Record<keyof ThemePalette, string> = {
  background: 'background',
  surface: 'surface',
  surfaceMuted: 'surface-muted',
  text: 'text',
  textMuted: 'text-muted',
  border: 'border',
  accent: 'accent',
  accentContrast: 'accent-contrast',
  success: 'success',
  danger: 'danger',
  warning: 'warning',
  hover: 'hover',
  softControl: 'soft-control',
  toolToggle: 'tool-toggle',
  toolToggleSoft: 'tool-toggle-soft',
  dangerSoft: 'danger-soft',
  dangerStrong: 'danger-strong',
  successSoft: 'success-soft',
  warningSoft: 'warning-soft',
  borderSubtle: 'border-subtle',
  neutralSoft: 'neutral-soft',
  codeBackground: 'code-background',
  shadow: 'shadow',
  previewBackground: 'preview-background',
  scrollbarThumb: 'scrollbar-thumb',
  scrollbarThumbHover: 'scrollbar-thumb-hover',
  scrollbarThumbActive: 'scrollbar-thumb-active'
}

const themePaletteKeys = Object.keys(colorVariableNames) as (keyof ThemePalette)[]

const cssColor = (name: keyof ThemePalette, fallback: string) => `var(--hesper-color-${colorVariableNames[name]}, ${fallback})`

const semanticColors = (fallbackPalette: ThemePalette): ThemePalette =>
  themePaletteKeys.reduce((colors, key) => {
    colors[key] = cssColor(key, fallbackPalette[key])
    return colors
  }, {} as ThemePalette)

export const lightTheme: ThemeTokens = {
  color: catppuccinLattePalette,
  radius,
  spacing,
  typography: { body: 14, tiny: 9 }
}

export const themeTokens: ThemeTokens = {
  color: semanticColors(catppuccinMochaPalette),
  radius,
  spacing,
  typography: { body: 'var(--hesper-font-size, 14px)', tiny: 9 }
}

export const darkTheme = themeTokens

type CreateThemeVariablesOptions = {
  themeId: BuiltinThemeId | string
  mode: ThemeMode
  fontSize: number
}

const paletteForLegacyMode = (mode: ThemeMode): { colorScheme: ThemeMode; palette: ThemePalette } => ({
  colorScheme: mode,
  palette: mode === 'light' ? catppuccinLattePalette : tokyoNightPalette
})

const variablesForPalette = (palette: ThemePalette, colorScheme: ThemeMode, fontSize: number): CSSProperties => {
  const variables = themePaletteKeys.reduce(
    (styles, key) => ({
      ...styles,
      [`--hesper-color-${colorVariableNames[key]}`]: palette[key]
    }),
    {
      colorScheme,
      '--hesper-font-size': `${fontSize}px`
    } as Record<string, string>
  )

  return variables as CSSProperties
}

export function createThemeVariables(mode: ThemeMode, fontSize: number): CSSProperties
export function createThemeVariables(options: CreateThemeVariablesOptions): CSSProperties
export function createThemeVariables(modeOrOptions: ThemeMode | CreateThemeVariablesOptions, fontSize?: number): CSSProperties {
  if (typeof modeOrOptions === 'string') {
    const { colorScheme, palette } = paletteForLegacyMode(modeOrOptions)
    return variablesForPalette(palette, colorScheme, fontSize ?? 14)
  }

  const variant = resolveThemeVariant(modeOrOptions.themeId, modeOrOptions.mode)
  return variablesForPalette(variant.palette, variant.colorScheme, modeOrOptions.fontSize)
}
