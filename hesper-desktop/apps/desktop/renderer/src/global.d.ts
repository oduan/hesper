import type { HesperDesktopApi } from '../../electron/ipc-contract'

declare global {
  interface Window {
    hesper: HesperDesktopApi
  }

  interface ImportMetaEnv {
    readonly MODE: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

export {}
