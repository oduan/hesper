import type { HesperDesktopApi } from '../../electron/ipc-contract'

declare global {
  interface Window {
    hesper: HesperDesktopApi
  }
}

export {}
