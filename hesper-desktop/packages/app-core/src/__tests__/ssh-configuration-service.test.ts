import { createInMemoryPersistence } from '@hesper/persistence'
import type { SshCommandResult, SshCommandStatus } from '@hesper/shared'
import { describe, expect, it } from 'vitest'
import { createCredentialVaultService, type CredentialVaultCodec } from '../credential-vault-service'
import { createSshConfigurationService, type SshClientAdapter, type SshClientRunInput } from '../ssh-configuration-service'

function createMockCodec(): CredentialVaultCodec {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
    decryptString: (value) => [...Buffer.from(value).toString('utf8')].reverse().join('')
  }
}

const now = () => '2026-06-21T05:00:00.000Z'

function createDeterministicIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>()
  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)
    return `${prefix}-${next}`
  }
}

function commandResult(input: SshClientRunInput, index: number, command: string, status: SshCommandStatus, extra: Partial<SshCommandResult> = {}): SshCommandResult {
  return {
    executionId: input.executionId,
    index,
    command,
    status,
    stdout: '',
    stderr: '',
    ...extra
  }
}

const successfulAdapter: SshClientAdapter = {
  async runCommands(input) {
    for (const [index, command] of input.commands.entries()) {
      await input.onCommandStart(commandResult(input, index, command, 'running', { startedAt: now() }))
      await input.onStdout(index, `stdout:${command}\n`)
      await input.onCommandComplete(commandResult(input, index, command, 'succeeded', { exitCode: 0, completedAt: now() }))
    }
  }
}

async function createService(adapter: SshClientAdapter = successfulAdapter) {
  const persistence = await createInMemoryPersistence()
  const vault = createCredentialVaultService({ persistence, codec: createMockCodec(), now })
  const service = createSshConfigurationService({
    persistence,
    credentialVault: vault,
    adapter,
    now,
    createId: createDeterministicIdFactory()
  })
  return { persistence, vault, service }
}

async function createServer(adapter: SshClientAdapter = successfulAdapter) {
  const context = await createService(adapter)
  const key = await context.service.createKey({
    name: ' Production key ',
    privateKey: ' private-key-secret ',
    passphrase: ' passphrase-secret ',
    note: ' deploy key '
  })
  const server = await context.service.createServer({
    name: ' Production ',
    host: ' 10.0.0.8 ',
    port: 2222,
    username: ' deploy ',
    keyId: key.id,
    note: ' logs '
  })
  return { ...context, key, server }
}

describe('createSshConfigurationService', () => {
  it('creates keys and servers without exposing secrets in list results', async () => {
    const { service, vault } = await createService()

    const key = await service.createKey({
      name: ' Production key ',
      privateKey: ' -----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY----- ',
      passphrase: ' ssh-passphrase-secret ',
      note: ' deploy key '
    })
    const server = await service.createServer({
      name: ' Production ',
      host: ' 10.0.0.8 ',
      port: 2222,
      username: ' deploy ',
      keyId: key.id,
      note: ' logs '
    })

    expect(key).toMatchObject({ id: 'ssh-key-1', name: 'Production key', note: 'deploy key', hasPassphrase: true })
    expect(await vault.readSshPrivateKey(key.id)).toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(await vault.readSshPassphrase(key.id)).toBe('ssh-passphrase-secret')
    expect(JSON.stringify(await service.listKeys())).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(JSON.stringify(await service.listKeys())).not.toContain('ssh-passphrase-secret')

    const agentServers = await service.listServersForAgent()
    expect(agentServers).toEqual([{ id: server.id, name: 'Production', note: 'logs' }])
    expect(Object.keys(agentServers[0]!)).toEqual(['id', 'name', 'note'])
    expect(JSON.stringify(agentServers)).not.toContain('10.0.0.8')
    expect(JSON.stringify(agentServers)).not.toContain('deploy')
  })

  it('refuses to delete a key used by a server', async () => {
    const { service, key, server } = await createServer()

    await expect(service.deleteKey(key.id)).rejects.toThrow('SSH key is used by 1 server(s)')
    await expect(service.deleteServer(server.id)).resolves.toEqual({ deleted: true, id: server.id })
    await expect(service.deleteKey(key.id)).resolves.toEqual({ deleted: true, id: key.id })
  })

  it('runs commands synchronously and skips remaining commands when stopOnError is true', async () => {
    const stopOnErrorAdapter: SshClientAdapter = {
      async runCommands(input) {
        for (const [index, command] of input.commands.entries()) {
          await input.onCommandStart(commandResult(input, index, command, 'running', { startedAt: now() }))
          await input.onStdout(index, `stdout:${command}\n`)
          if (command === 'fail-command') {
            await input.onStderr(index, 'simulated failure\n')
            await input.onCommandComplete(commandResult(input, index, command, 'failed', { exitCode: 2, completedAt: now() }))
            if (input.stopOnError) {
              for (let skippedIndex = index + 1; skippedIndex < input.commands.length; skippedIndex += 1) {
                const skippedCommand = input.commands[skippedIndex]!
                await input.onCommandSkipped(commandResult(input, skippedIndex, skippedCommand, 'skipped', {
                  completedAt: now(),
                  skippedReason: 'previous command failed'
                }))
              }
              return
            }
          } else {
            await input.onCommandComplete(commandResult(input, index, command, 'succeeded', { exitCode: 0, completedAt: now() }))
          }
        }
      }
    }
    const { service, server } = await createServer(stopOnErrorAdapter)

    const output = await service.runCommands({
      sessionId: 'session-1',
      runId: 'run-1',
      serverId: server.id,
      commands: ['whoami', 'fail-command', 'after-failure'],
      stopOnError: true,
      wait: true
    })

    expect(output.wait).toBe(true)
    expect(output.stoppedOnError).toBe(true)
    expect(output).toMatchObject({ status: 'failed', serverId: server.id, serverName: 'Production' })
    expect(output.results.map((command) => command.status)).toEqual(['succeeded', 'failed', 'skipped'])
    expect(output.results[0]).toMatchObject({ stdout: 'stdout:whoami\n', exitCode: 0 })
    expect(output.results[1]).toMatchObject({ stdout: 'stdout:fail-command\n', stderr: 'simulated failure\n', exitCode: 2 })
    expect(output.results[2]).toMatchObject({ stdout: '', stderr: '', skippedReason: 'previous command failed' })
  })

  it('starts background executions and returns current output while running', async () => {
    let resolveStdout: (() => void) | undefined
    const stdoutPersisted = new Promise<void>((resolve) => {
      resolveStdout = resolve
    })
    let releaseStdout: (() => void) | undefined
    const release = new Promise<void>((resolve) => {
      releaseStdout = resolve
    })
    const backgroundAdapter: SshClientAdapter = {
      async runCommands(input) {
        const command = input.commands[0]!
        await input.onCommandStart(commandResult(input, 0, command, 'running', { startedAt: now() }))
        await input.onStdout(0, 'first chunk\n')
        resolveStdout?.()
        await release
        await input.onStdout(0, 'second chunk\n')
        await input.onCommandComplete(commandResult(input, 0, command, 'succeeded', { exitCode: 0, completedAt: now() }))
      }
    }
    const { service, server } = await createServer(backgroundAdapter)

    const started = await service.runCommands({
      sessionId: 'session-bg',
      runId: 'run-bg',
      serverId: server.id,
      commands: ['tail -f app.log'],
      wait: false
    })

    expect(started.wait).toBe(false)
    expect(started).toMatchObject({ executionId: 'ssh-exec-1', serverId: server.id, serverName: 'Production', status: 'running', stoppedOnError: false })
    expect(started.results).toHaveLength(1)

    await stdoutPersisted
    const running = await service.getExecutionOutput({ sessionId: 'session-bg', executionId: started.executionId })
    expect(running.status).toBe('running')
    expect(running.results).toHaveLength(1)
    expect(running.results[0]).toMatchObject({ status: 'running', stdout: 'first chunk\n', stderr: '' })

    releaseStdout?.()
    await service.waitForIdle(started.executionId)

    const completed = await service.getExecutionOutput({ sessionId: 'session-bg', executionId: started.executionId })
    expect(completed.status).toBe('succeeded')
    expect(completed.results[0]).toMatchObject({ status: 'succeeded', stdout: 'first chunk\nsecond chunk\n', exitCode: 0 })
  })

  it('does not allow listing or reading executions from another session', async () => {
    const { service, server } = await createServer()
    const output = await service.runCommands({
      sessionId: 'session-owner',
      runId: 'run-owner',
      serverId: server.id,
      commands: ['hostname'],
      wait: true
    })

    await expect(service.listExecutions({ sessionId: 'session-other' })).resolves.toEqual({ executions: [], count: 0 })
    await expect(service.getExecutionOutput({ sessionId: 'session-other', executionId: output.executionId })).rejects.toThrow('SSH execution not found')
  })
})
