import { describe, expect, it, vi } from 'vitest'
import { installNavigationGuards, resolveRendererLoadTarget } from '../electron/renderer-security'

describe('desktop main renderer security', () => {
  it('ignores VITE_DEV_SERVER_URL when the app is packaged', () => {
    expect(
      resolveRendererLoadTarget({
        devServerUrl: 'http://evil.example.test:5173',
        isPackaged: true
      })
    ).toEqual({ kind: 'file' })
  })

  it('rejects non-localhost dev server URLs in development', () => {
    expect(() =>
      resolveRendererLoadTarget({
        devServerUrl: 'http://evil.example.test:5173',
        isPackaged: false
      })
    ).toThrow(/localhost|127\.0\.0\.1/)
  })

  it('allows localhost dev server URLs in development', () => {
    expect(
      resolveRendererLoadTarget({
        devServerUrl: 'http://127.0.0.1:5173',
        isPackaged: false
      })
    ).toEqual({ kind: 'url', url: 'http://127.0.0.1:5173/', origin: 'http://127.0.0.1:5173' })
  })

  it('prevents renderer navigation and window opens outside allowed origins', () => {
    let willNavigateHandler: ((event: { preventDefault: () => void }, url: string) => void) | undefined
    let openHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | undefined
    const preventDefault = vi.fn()
    const window = {
      webContents: {
        on: vi.fn((eventName: string, handler: typeof willNavigateHandler) => {
          if (eventName === 'will-navigate') willNavigateHandler = handler
        }),
        setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
          openHandler = handler
        })
      }
    }

    installNavigationGuards(window, ['http://127.0.0.1:5173'])

    willNavigateHandler?.({ preventDefault }, 'https://evil.example.test/phish')
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(openHandler?.({ url: 'https://evil.example.test/phish' })).toEqual({ action: 'deny' })
    expect(openHandler?.({ url: 'http://127.0.0.1:5173/settings' })).toEqual({ action: 'allow' })
  })

  it('denies file:// navigations and window opens when loading the packaged file renderer', () => {
    let willNavigateHandler: ((event: { preventDefault: () => void }, url: string) => void) | undefined
    let openHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | undefined
    const preventDefault = vi.fn()
    const window = {
      webContents: {
        on: vi.fn((eventName: string, handler: typeof willNavigateHandler) => {
          if (eventName === 'will-navigate') willNavigateHandler = handler
        }),
        setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
          openHandler = handler
        })
      }
    }

    installNavigationGuards(window, ['file://'])

    willNavigateHandler?.({ preventDefault }, 'file:///C:/Users/oisin/Documents/payload.html')
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(openHandler?.({ url: 'file:///C:/Users/oisin/Documents/payload.html' })).toEqual({ action: 'deny' })
    expect(openHandler?.({ url: 'file:///tmp/another-local-page.html' })).toEqual({ action: 'deny' })
  })
})
