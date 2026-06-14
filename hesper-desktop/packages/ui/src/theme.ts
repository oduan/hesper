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
}

export const lightTheme: ThemeTokens = {
  color: {
    background: '#f2efe8',
    surface: '#fffefb',
    surfaceMuted: '#f7f4ee',
    text: '#22211f',
    textMuted: '#6f6a62',
    border: '#ded7cc',
    accent: '#725cff',
    success: '#199b63',
    danger: '#d44f4b',
    warning: '#ac741b'
  },
  radius: { sm: '8px', md: '12px', lg: '16px', xl: '20px' },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' }
}

export const darkTheme: ThemeTokens = {
  color: {
    background: '#262a3b',
    surface: '#171a26',
    surfaceMuted: '#202434',
    text: '#e8ecfb',
    textMuted: '#969db8',
    border: 'rgba(255, 255, 255, 0.07)',
    accent: '#7f9ee8',
    success: '#68c69a',
    danger: '#ef817d',
    warning: '#d8b66b'
  },
  radius: lightTheme.radius,
  spacing: lightTheme.spacing
}
