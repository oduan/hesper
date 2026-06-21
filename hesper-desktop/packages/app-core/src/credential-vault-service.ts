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

export type ToolCredentialStatus = {
  toolId: string
  apiKeyRef: string
  hasApiKey: boolean
  encryptionAvailable: boolean
  warning?: string
  updatedAt?: string
}

export type SshSecretStatus = {
  keyId: string
  credentialRef: string
  hasSecret: boolean
  encryptionAvailable: boolean
  warning?: string
  updatedAt?: string
}

export type SaveProviderApiKeyInput = {
  providerId: string
  apiKey: string
}

export type SaveToolApiKeyInput = {
  toolId: string
  apiKey: string
}

export type SaveSshPrivateKeyInput = {
  keyId: string
  privateKey: string
}

export type SaveSshPassphraseInput = {
  keyId: string
  passphrase: string
}

export type ProviderCredentialInput = {
  providerId: string
}

export type ToolCredentialInput = {
  toolId: string
}

export type SshKeySecretInput = {
  keyId: string
}

export type CredentialVaultService = {
  getProviderApiKeyStatus(input: ProviderCredentialInput): Promise<ProviderCredentialStatus>
  saveProviderApiKey(input: SaveProviderApiKeyInput): Promise<ProviderCredentialStatus>
  deleteProviderApiKey(input: ProviderCredentialInput): Promise<ProviderCredentialStatus>
  readProviderApiKey(providerId: string): Promise<string | undefined>
  getToolApiKeyStatus(input: ToolCredentialInput): Promise<ToolCredentialStatus>
  saveToolApiKey(input: SaveToolApiKeyInput): Promise<ToolCredentialStatus>
  deleteToolApiKey(input: ToolCredentialInput): Promise<ToolCredentialStatus>
  readToolApiKey(toolId: string): Promise<string | undefined>
  getSshPrivateKeyStatus(input: SshKeySecretInput): Promise<SshSecretStatus>
  saveSshPrivateKey(input: SaveSshPrivateKeyInput): Promise<SshSecretStatus>
  deleteSshPrivateKey(input: SshKeySecretInput): Promise<SshSecretStatus>
  readSshPrivateKey(keyId: string): Promise<string | undefined>
  getSshPassphraseStatus(input: SshKeySecretInput): Promise<SshSecretStatus>
  saveSshPassphrase(input: SaveSshPassphraseInput): Promise<SshSecretStatus>
  deleteSshPassphrase(input: SshKeySecretInput): Promise<SshSecretStatus>
  readSshPassphrase(keyId: string): Promise<string | undefined>
}

export function providerApiKeyRef(providerId: string): string {
  return `provider:${providerId}:api-key`
}

export function toolApiKeyRef(toolId: string): string {
  return `tool:${toolId}:api-key`
}

export function sshPrivateKeyRef(keyId: string): string {
  return `ssh-key:${keyId}:private-key`
}

export function sshPassphraseRef(keyId: string): string {
  return `ssh-key:${keyId}:passphrase`
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

function assertToolId(toolId: string): void {
  if (!toolId.trim()) throw new Error('toolId is required')
}

function assertSshKeyId(keyId: string): void {
  if (!keyId.trim()) throw new Error('keyId is required')
}

function assertApiKey(apiKey: string): void {
  if (!apiKey.trim()) throw new Error('apiKey is required')
}

function assertPrivateKey(privateKey: string): void {
  if (!privateKey.trim()) throw new Error('privateKey is required')
}

function assertPassphrase(passphrase: string): void {
  if (!passphrase.trim()) throw new Error('passphrase is required')
}

export function createCredentialVaultService(options: {
  persistence: Persistence
  codec?: CredentialVaultCodec
  now?: () => string
}): CredentialVaultService {
  const codec = options.codec ?? createUnavailableCredentialCodec()
  const now = options.now ?? nowIso

  const credentialStatus = async (apiKeyRef: string) => {
    const record = await options.persistence.credentialRecords.get(apiKeyRef)
    const encryptionAvailable = codec.isEncryptionAvailable()
    return {
      apiKeyRef,
      hasApiKey: Boolean(record),
      encryptionAvailable,
      ...(encryptionAvailable ? {} : { warning: unavailableWarning() }),
      ...(record?.updatedAt ? { updatedAt: record.updatedAt } : {})
    }
  }

  const providerStatusFor = async (providerId: string): Promise<ProviderCredentialStatus> => {
    assertProviderId(providerId)
    return { providerId, ...await credentialStatus(providerApiKeyRef(providerId)) }
  }

  const toolStatusFor = async (toolId: string): Promise<ToolCredentialStatus> => {
    assertToolId(toolId)
    return { toolId, ...await credentialStatus(toolApiKeyRef(toolId)) }
  }

  const sshSecretStatusFor = async (keyId: string, credentialRef: string): Promise<SshSecretStatus> => {
    assertSshKeyId(keyId)
    const status = await credentialStatus(credentialRef)
    return {
      keyId,
      credentialRef,
      hasSecret: status.hasApiKey,
      encryptionAvailable: status.encryptionAvailable,
      ...(status.warning ? { warning: status.warning } : {}),
      ...(status.updatedAt ? { updatedAt: status.updatedAt } : {})
    }
  }

  const saveApiKey = async (kind: 'provider-api-key' | 'tool-api-key' | 'ssh-private-key' | 'ssh-passphrase', subjectId: string, apiKeyRef: string, apiKey: string): Promise<void> => {
    assertApiKey(apiKey)
    if (!codec.isEncryptionAvailable()) {
      throw new Error(unavailableWarning())
    }

    const existing = await options.persistence.credentialRecords.get(apiKeyRef)
    const timestamp = now()
    const encryptedValueBase64 = encodeBase64(codec.encryptString(apiKey))
    await options.persistence.credentialRecords.save({
      id: apiKeyRef,
      kind,
      subjectId,
      encryptedValueBase64,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    })
  }

  const readApiKey = async (apiKeyRef: string): Promise<string | undefined> => {
    const record = await options.persistence.credentialRecords.get(apiKeyRef)
    if (!record) return undefined
    if (!codec.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable; cannot decrypt API key')
    }
    return codec.decryptString(decodeBase64(record.encryptedValueBase64))
  }

  return {
    async getProviderApiKeyStatus(input) {
      return providerStatusFor(input.providerId)
    },
    async saveProviderApiKey(input) {
      assertProviderId(input.providerId)
      await saveApiKey('provider-api-key', input.providerId, providerApiKeyRef(input.providerId), input.apiKey)
      return providerStatusFor(input.providerId)
    },
    async deleteProviderApiKey(input) {
      assertProviderId(input.providerId)
      await options.persistence.credentialRecords.delete(providerApiKeyRef(input.providerId))
      return providerStatusFor(input.providerId)
    },
    async readProviderApiKey(providerId) {
      assertProviderId(providerId)
      return readApiKey(providerApiKeyRef(providerId))
    },
    async getToolApiKeyStatus(input) {
      return toolStatusFor(input.toolId)
    },
    async saveToolApiKey(input) {
      assertToolId(input.toolId)
      await saveApiKey('tool-api-key', input.toolId, toolApiKeyRef(input.toolId), input.apiKey)
      return toolStatusFor(input.toolId)
    },
    async deleteToolApiKey(input) {
      assertToolId(input.toolId)
      await options.persistence.credentialRecords.delete(toolApiKeyRef(input.toolId))
      return toolStatusFor(input.toolId)
    },
    async readToolApiKey(toolId) {
      assertToolId(toolId)
      return readApiKey(toolApiKeyRef(toolId))
    },
    async getSshPrivateKeyStatus(input) {
      return sshSecretStatusFor(input.keyId, sshPrivateKeyRef(input.keyId))
    },
    async saveSshPrivateKey(input) {
      assertSshKeyId(input.keyId)
      assertPrivateKey(input.privateKey)
      await saveApiKey('ssh-private-key', input.keyId, sshPrivateKeyRef(input.keyId), input.privateKey)
      return sshSecretStatusFor(input.keyId, sshPrivateKeyRef(input.keyId))
    },
    async deleteSshPrivateKey(input) {
      assertSshKeyId(input.keyId)
      await options.persistence.credentialRecords.delete(sshPrivateKeyRef(input.keyId))
      return sshSecretStatusFor(input.keyId, sshPrivateKeyRef(input.keyId))
    },
    async readSshPrivateKey(keyId) {
      assertSshKeyId(keyId)
      return readApiKey(sshPrivateKeyRef(keyId))
    },
    async getSshPassphraseStatus(input) {
      return sshSecretStatusFor(input.keyId, sshPassphraseRef(input.keyId))
    },
    async saveSshPassphrase(input) {
      assertSshKeyId(input.keyId)
      assertPassphrase(input.passphrase)
      await saveApiKey('ssh-passphrase', input.keyId, sshPassphraseRef(input.keyId), input.passphrase)
      return sshSecretStatusFor(input.keyId, sshPassphraseRef(input.keyId))
    },
    async deleteSshPassphrase(input) {
      assertSshKeyId(input.keyId)
      await options.persistence.credentialRecords.delete(sshPassphraseRef(input.keyId))
      return sshSecretStatusFor(input.keyId, sshPassphraseRef(input.keyId))
    },
    async readSshPassphrase(keyId) {
      assertSshKeyId(keyId)
      return readApiKey(sshPassphraseRef(keyId))
    }
  }
}
