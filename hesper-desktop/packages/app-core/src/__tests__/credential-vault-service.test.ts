import { createInMemoryPersistence, exportDatabaseBytes } from '@hesper/persistence'
import { describe, expect, it, vi } from 'vitest'
import { createCredentialVaultService, createUnavailableCredentialCodec, type CredentialVaultCodec } from '../credential-vault-service'

function createMockCodec(): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
    decryptString: (value) => [...Buffer.from(value).toString('utf8')].reverse().join('')
  }
}

describe('createCredentialVaultService', () => {
  it('round-trips provider API keys through encrypted persistence records', async () => {
    const persistence = await createInMemoryPersistence()
    const vault = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => '2026-06-10T03:00:00.000Z' })

    const status = await vault.saveProviderApiKey({ providerId: 'provider-deepseek', apiKey: 'sk-test-secret' })

    expect(status).toEqual({
      providerId: 'provider-deepseek',
      apiKeyRef: 'provider:provider-deepseek:api-key',
      hasApiKey: true,
      encryptionAvailable: true,
      updatedAt: '2026-06-10T03:00:00.000Z'
    })
    expect(await vault.readProviderApiKey('provider-deepseek')).toBe('sk-test-secret')
    expect(JSON.stringify(await persistence.credentialRecords.list())).not.toContain('sk-test-secret')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('sk-test-secret')
  })

  it('round-trips tool API keys through encrypted persistence records', async () => {
    const persistence = await createInMemoryPersistence()
    const vault = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => '2026-06-10T03:00:00.000Z' })

    const status = await vault.saveToolApiKey({ toolId: 'web.search', apiKey: 'tinyfish-secret' })

    expect(status).toEqual({
      toolId: 'web.search',
      apiKeyRef: 'tool:web.search:api-key',
      hasApiKey: true,
      encryptionAvailable: true,
      updatedAt: '2026-06-10T03:00:00.000Z'
    })
    expect(await vault.getToolApiKeyStatus({ toolId: 'web.search' })).toMatchObject({ hasApiKey: true })
    expect(await vault.readToolApiKey('web.search')).toBe('tinyfish-secret')
    expect(JSON.stringify(await persistence.credentialRecords.list())).not.toContain('tinyfish-secret')
    await expect(vault.deleteToolApiKey({ toolId: 'web.search' })).resolves.toMatchObject({ hasApiKey: false })
  })

  it('never exposes the decrypted value through status or delete results', async () => {
    const persistence = await createInMemoryPersistence()
    const vault = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => '2026-06-10T03:00:00.000Z' })

    const saved = await vault.saveProviderApiKey({ providerId: 'provider-openai', apiKey: 'sk-hidden' })
    const deleted = await vault.deleteProviderApiKey({ providerId: 'provider-openai' })

    expect(JSON.stringify(saved)).not.toContain('sk-hidden')
    expect(JSON.stringify(deleted)).not.toContain('sk-hidden')
    expect(deleted).toMatchObject({ hasApiKey: false, encryptionAvailable: true })
  })

  it('refuses to save when secure storage is unavailable', async () => {
    const persistence = await createInMemoryPersistence()
    const vault = createCredentialVaultService({ persistence, codec: createUnavailableCredentialCodec() })

    await expect(vault.saveProviderApiKey({ providerId: 'provider-openai', apiKey: 'sk-test' })).rejects.toThrow(/unavailable/)
    await expect(vault.getProviderApiKeyStatus({ providerId: 'provider-openai' })).resolves.toMatchObject({
      providerId: 'provider-openai',
      hasApiKey: false,
      encryptionAvailable: false,
      warning: expect.stringMatching(/unavailable/)
    })
  })

  it('does not encrypt blank provider ids or blank keys', async () => {
    const persistence = await createInMemoryPersistence()
    const codec = createMockCodec()
    const encryptSpy = vi.spyOn(codec, 'encryptString')
    const vault = createCredentialVaultService({ persistence, codec })

    await expect(vault.saveProviderApiKey({ providerId: '', apiKey: 'sk-test' })).rejects.toThrow(/providerId/)
    await expect(vault.saveProviderApiKey({ providerId: 'provider-openai', apiKey: ' ' })).rejects.toThrow(/apiKey/)
    expect(encryptSpy).not.toHaveBeenCalled()
  })

  it('round-trips SSH private keys and passphrases through encrypted records', async () => {
    const persistence = await createInMemoryPersistence()
    const vault = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => '2026-06-21T05:00:00.000Z' })

    const privateKeyStatus = await vault.saveSshPrivateKey({ keyId: 'ssh-key-1', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----' })
    const passphraseStatus = await vault.saveSshPassphrase({ keyId: 'ssh-key-1', passphrase: 'ssh-passphrase-secret' })

    expect(privateKeyStatus).toEqual({
      keyId: 'ssh-key-1',
      credentialRef: 'ssh-key:ssh-key-1:private-key',
      hasSecret: true,
      encryptionAvailable: true,
      updatedAt: '2026-06-21T05:00:00.000Z'
    })
    expect(passphraseStatus).toMatchObject({ keyId: 'ssh-key-1', hasSecret: true })
    expect(await vault.readSshPrivateKey('ssh-key-1')).toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(await vault.readSshPassphrase('ssh-key-1')).toBe('ssh-passphrase-secret')
    expect(JSON.stringify(await persistence.credentialRecords.list())).not.toContain('ssh-passphrase-secret')
    expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('BEGIN OPENSSH PRIVATE KEY')
  })

  it('deletes SSH private keys and passphrases without returning secret material', async () => {
    const persistence = await createInMemoryPersistence()
    const vault = createCredentialVaultService({ persistence, codec: createMockCodec() })

    await vault.saveSshPrivateKey({ keyId: 'ssh-key-1', privateKey: 'private-key-secret' })
    await vault.saveSshPassphrase({ keyId: 'ssh-key-1', passphrase: 'passphrase-secret' })

    const privateDeleted = await vault.deleteSshPrivateKey({ keyId: 'ssh-key-1' })
    const passphraseDeleted = await vault.deleteSshPassphrase({ keyId: 'ssh-key-1' })

    expect(JSON.stringify(privateDeleted)).not.toContain('private-key-secret')
    expect(JSON.stringify(passphraseDeleted)).not.toContain('passphrase-secret')
    expect(await vault.readSshPrivateKey('ssh-key-1')).toBeUndefined()
    expect(await vault.readSshPassphrase('ssh-key-1')).toBeUndefined()
  })
})
