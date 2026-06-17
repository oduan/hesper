type NavigationEvent = {
  preventDefault: () => void
}

type WindowOpenAction = { action: 'allow' | 'deny' }

type NavigationGuardWindow = {
  webContents: {
    on: (eventName: 'will-navigate', handler: (event: NavigationEvent, url: string) => void) => void
    setWindowOpenHandler: (handler: (details: { url: string }) => WindowOpenAction) => void
  }
}

export type RendererLoadTarget = { kind: 'file' } | { kind: 'url'; url: string; origin: string }

type ResolveRendererLoadTargetInput = {
  devServerUrl: string | undefined
  isPackaged: boolean
}

const LOCAL_DEV_HOSTS = new Set(['127.0.0.1', 'localhost'])

export function resolveRendererLoadTarget({ devServerUrl, isPackaged }: ResolveRendererLoadTargetInput): RendererLoadTarget {
  if (isPackaged || !devServerUrl) return { kind: 'file' }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(devServerUrl)
  } catch {
    throw new Error('VITE_DEV_SERVER_URL must be a valid http://127.0.0.1:* or http://localhost:* URL')
  }

  if (parsedUrl.protocol !== 'http:' || !parsedUrl.port || !LOCAL_DEV_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error('VITE_DEV_SERVER_URL must use http://127.0.0.1:* or http://localhost:* in development')
  }

  return { kind: 'url', url: parsedUrl.toString(), origin: parsedUrl.origin }
}

function normalizeAllowedOrigin(origin: string): string {
  return new URL(origin).origin
}

function resolveUrlOrigin(rawUrl: string): string | undefined {
  try {
    const parsedUrl = new URL(rawUrl)
    if (parsedUrl.protocol === 'file:') return undefined
    return parsedUrl.origin
  } catch {
    return undefined
  }
}

function isAllowedUrl(rawUrl: string, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = resolveUrlOrigin(rawUrl)
  return origin !== undefined && allowedOrigins.has(origin)
}

export function installNavigationGuards(window: NavigationGuardWindow, allowedOrigins: readonly string[]): void {
  const normalizedAllowedOrigins = new Set(allowedOrigins.map(normalizeAllowedOrigin))

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url, normalizedAllowedOrigins)) {
      event.preventDefault()
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    return { action: isAllowedUrl(url, normalizedAllowedOrigins) ? 'allow' : 'deny' }
  })
}
