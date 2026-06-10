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
    background: '#15161a',
    surface: '#202229',
    surfaceMuted: '#1b1d23',
    text: '#eef0f4',
    textMuted: '#a8adba',
    border: '#343843',
    accent: '#9b8cff',
    success: '#43c48c',
    danger: '#ff7b73',
    warning: '#d8a043'
  },
  radius: lightTheme.radius,
  spacing: lightTheme.spacing
}
