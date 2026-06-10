import type { Persistence } from '@hesper/persistence'
import { nowIso } from '@hesper/shared'

export type CredentialVaultCodec = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Uint8Array
  decryptString(value: Uint8Array): string
}

export type ProviderCredentialStatus = {
  providerId: string
  apiKeyRef: string
  hasApiKey: boolean
  encryptionAvailable: boolean
  warning?: string
  updatedAt?: string
}

export type SaveProviderApiKeyInput = {
  providerId: string
  apiKey: string
}

export type ProviderCredentialInput = {
  providerId: string
}

export type CredentialVaultService = {
  getProviderApiKeyStatus(input: ProviderCredentialInput): Promise<ProviderCredentialStatus>
  saveProviderApiKey(input: SaveProviderApiKeyInput): Promise<ProviderCredentialStatus>
  deleteProviderApiKey(input: ProviderCredentialInput): Promise<ProviderCredentialStatus>
  readProviderApiKey(providerId: string): Promise<string | undefined>
}

export function providerApiKeyRef(providerId: string): string {
  return `provider:${providerId}:api-key`
}

export function createUnavailableCredentialCodec(): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('Secure credential storage is unavailable')
    },
    decryptString: () => {
      throw new Error('Secure credential storage is unavailable')
    }
  }
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
}

function decodeBase64(value: string): Uint8Array {
  return Buffer.from(value, 'base64')
}

function unavailableWarning(): string {
  return 'Secure credential storage is unavailable on this system. API keys were not saved.'
}

function assertProviderId(providerId: string): void {
  if (!providerId.trim()) throw new Error('providerId is required')
}

function assertApiKey(apiKey: string): void {
  if (!apiKey.trim()) throw new Error('apiKey is required')
}

export function createCredentialVaultService(options: {
  persistence: Persistence
  codec?: CredentialVaultCodec
  now?: () => string
}): CredentialVaultService {
  const codec = options.codec ?? createUnavailableCredentialCodec()
  const now = options.now ?? nowIso

  const statusFor = async (providerId: string): Promise<ProviderCredentialStatus> => {
    assertProviderId(providerId)
    const apiKeyRef = providerApiKeyRef(providerId)
    const record = await options.persistence.credentialRecords.get(apiKeyRef)
    const encryptionAvailable = codec.isEncryptionAvailable()
    return {
      providerId,
      apiKeyRef,
      hasApiKey: Boolean(record),
      encryptionAvailable,
      ...(encryptionAvailable ? {} : { warning: unavailableWarning() }),
      ...(record?.updatedAt ? { updatedAt: record.updatedAt } : {})
    }
  }

  return {
    async getProviderApiKeyStatus(input) {
      return statusFor(input.providerId)
    },
    async saveProviderApiKey(input) {
      assertProviderId(input.providerId)
      assertApiKey(input.apiKey)
      if (!codec.isEncryptionAvailable()) {
        throw new Error(unavailableWarning())
      }

      const apiKeyRef = providerApiKeyRef(input.providerId)
      const existing = await options.persistence.credentialRecords.get(apiKeyRef)
      const timestamp = now()
      const encryptedValueBase64 = encodeBase64(codec.encryptString(input.apiKey))
      await options.persistence.credentialRecords.save({
        id: apiKeyRef,
        kind: 'provider-api-key',
        subjectId: input.providerId,
        encryptedValueBase64,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      })
      return statusFor(input.providerId)
    },
    async deleteProviderApiKey(input) {
      assertProviderId(input.providerId)
      await options.persistence.credentialRecords.delete(providerApiKeyRef(input.providerId))
      return statusFor(input.providerId)
    },
    async readProviderApiKey(providerId) {
      assertProviderId(providerId)
      const record = await options.persistence.credentialRecords.get(providerApiKeyRef(providerId))
      if (!record) return undefined
      if (!codec.isEncryptionAvailable()) {
        throw new Error('Secure credential storage is unavailable; cannot decrypt provider API key')
      }
      return codec.decryptString(decodeBase64(record.encryptedValueBase64))
    }
  }
}
