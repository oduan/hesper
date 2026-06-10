import type { CredentialVaultCodec } from '@hesper/app-core'
import type { safeStorage } from 'electron'

export type ElectronSafeStorage = Pick<typeof safeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>

export function createElectronSafeStorageCredentialCodec(storage: ElectronSafeStorage): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => storage.isEncryptionAvailable(),
    encryptString: (value) => storage.encryptString(value),
    decryptString: (value) => storage.decryptString(Buffer.from(value))
  }
}
