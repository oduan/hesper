import type { CSSProperties } from 'react'

export type ThemeTokens = {
  color: {
    background: string
    surface: string
    surfaceMuted: string
    text: string
    textMuted: string
    border: string
    accent: string
    success: string
    danger: string
    warning: string
  }
  radius: { sm: string; md: string; lg: string; xl: string }
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string }
  typography: { body: string | number; tiny: number }
}

export type ThemeMode = 'light' | 'dark'

const radius = { sm: '8px', md: '12px', lg: '16px', xl: '20px' }
const spacing = { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' }

const lightPalette = {
  // Catppuccin Latte
  background: '#dce0e8',
  surface: '#eff1f5',
  surfaceMuted: '#e6e9ef',
  text: '#4c4f69',
  textMuted: '#6c6f85',
  border: '#bcc0cc',
  accent: '#8839ef',
  success: '#40a02b',
  danger: '#d20f39',
  warning: '#df8e1d',
  hover: 'rgba(76, 79, 105, 0.10)',
  softControl: 'rgba(136, 57, 239, 0.12)',
  toolToggle: '#40a02b',
  toolToggleSoft: 'rgba(64, 160, 43, 0.14)',
  scrollbarThumb: 'rgba(76, 79, 105, 0.18)',
  scrollbarThumbHover: 'rgba(76, 79, 105, 0.34)'
}

const darkPalette = {
  // Tokyo Night
  background: '#1a1b26',
  surface: '#16161e',
  surfaceMuted: '#24283b',
  text: '#c0caf5',
  textMuted: '#737aa2',
  border: '#414868',
  accent: '#7aa2f7',
  success: '#9ece6a',
  danger: '#f7768e',
  warning: '#e0af68',
  hover: 'rgba(122, 162, 247, 0.12)',
  softControl: 'rgba(122, 162, 247, 0.14)',
  toolToggle: '#7aa2f7',
  toolToggleSoft: 'rgba(122, 162, 247, 0.14)',
  scrollbarThumb: 'rgba(192, 202, 245, 0.18)',
  scrollbarThumbHover: 'rgba(192, 202, 245, 0.34)'
}

const colorVariableNames: Record<keyof typeof darkPalette, string> = {
  background: 'background',
  surface: 'surface',
  surfaceMuted: 'surface-muted',
  text: 'text',
  textMuted: 'text-muted',
  border: 'border',
  accent: 'accent',
  success: 'success',
  danger: 'danger',
  warning: 'warning',
  hover: 'hover',
  softControl: 'soft-control',
  toolToggle: 'tool-toggle',
  toolToggleSoft: 'tool-toggle-soft',
  scrollbarThumb: 'scrollbar-thumb',
  scrollbarThumbHover: 'scrollbar-thumb-hover'
}

const cssColor = (name: keyof typeof darkPalette, fallback: string) => `var(--hesper-color-${colorVariableNames[name]}, ${fallback})`

export const lightTheme: ThemeTokens = {
  color: {
    background: lightPalette.background,
    surface: lightPalette.surface,
    surfaceMuted: lightPalette.surfaceMuted,
    text: lightPalette.text,
    textMuted: lightPalette.textMuted,
    border: lightPalette.border,
    accent: lightPalette.accent,
    success: lightPalette.success,
    danger: lightPalette.danger,
    warning: lightPalette.warning
  },
  radius,
  spacing,
  typography: { body: 14, tiny: 9 }
}

export const darkTheme: ThemeTokens = {
  color: {
    background: cssColor('background', darkPalette.background),
    surface: cssColor('surface', darkPalette.surface),
    surfaceMuted: cssColor('surfaceMuted', darkPalette.surfaceMuted),
    text: cssColor('text', darkPalette.text),
    textMuted: cssColor('textMuted', darkPalette.textMuted),
    border: cssColor('border', darkPalette.border),
    accent: cssColor('accent', darkPalette.accent),
    success: cssColor('success', darkPalette.success),
    danger: cssColor('danger', darkPalette.danger),
    warning: cssColor('warning', darkPalette.warning)
  },
  radius,
  spacing,
  typography: { body: 'var(--hesper-font-size, 14px)', tiny: 9 }
}

type ThemePalette = typeof darkPalette

const paletteForMode = (mode: ThemeMode): ThemePalette => (mode === 'light' ? lightPalette : darkPalette)

export function createThemeVariables(mode: ThemeMode, fontSize: number): CSSProperties {
  const palette = paletteForMode(mode)
  return {
    colorScheme: mode,
    '--hesper-font-size': `${fontSize}px`,
    '--hesper-color-background': palette.background,
    '--hesper-color-surface': palette.surface,
    '--hesper-color-surface-muted': palette.surfaceMuted,
    '--hesper-color-text': palette.text,
    '--hesper-color-text-muted': palette.textMuted,
    '--hesper-color-border': palette.border,
    '--hesper-color-accent': palette.accent,
    '--hesper-color-success': palette.success,
    '--hesper-color-danger': palette.danger,
    '--hesper-color-warning': palette.warning,
    '--hesper-color-hover': palette.hover,
    '--hesper-color-soft-control': palette.softControl,
    '--hesper-color-tool-toggle': palette.toolToggle,
    '--hesper-color-tool-toggle-soft': palette.toolToggleSoft,
    '--hesper-color-scrollbar-thumb': palette.scrollbarThumb,
    '--hesper-color-scrollbar-thumb-hover': palette.scrollbarThumbHover
  } as CSSProperties
}
