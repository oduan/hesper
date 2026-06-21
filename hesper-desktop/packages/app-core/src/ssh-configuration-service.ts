import type { Persistence } from '@hesper/persistence'
import {
  createId as sharedCreateId,
  nowIso,
  sshCommandResultSchema,
  sshExecutionSchema,
  sshKeySchema,
  sshServerAgentSummarySchema,
  sshServerSchema,
  type RunError,
  type SshCommandResult,
  type SshCommandStatus,
  type SshExecution,
  type SshExecutionStatus,
  type SshKey,
  type SshServer,
  type SshServerAgentSummary
} from '@hesper/shared'
import type { CredentialVaultService } from './credential-vault-service'

export type CreateSshKeyInput = {
  name: string
  privateKey: string
  passphrase?: string
  note?: string
}

export type CreateSshServerInput = {
  name: string
  host: string
  port?: number
  username: string
  keyId: string
  note?: string
}

export type UpdateSshServerInput = {
  id: string
  name?: string
  host?: string
  port?: number
  username?: string
  keyId?: string
  note?: string | null
}

export type RunSshCommandsInput = {
  sessionId: string
  runId: string
  serverId: string
  commands: string[]
  stopOnError?: boolean
  timeoutMs?: number
  wait?: boolean
}

export type ListSshExecutionsInput = {
  sessionId: string
  status?: SshExecutionStatus
}

export type GetSshExecutionOutputInput = {
  sessionId: string
  executionId: string
}

export type SshExecutionListItem = {
  id: string
  sessionId: string
  runId: string
  serverId: string
  serverName: string
  status: SshExecutionStatus
  commandCount: number
  completedCommandCount: number
  startedAt: string
  updatedAt: string
  completedAt?: string
  error?: RunError
}

export type SshExecutionOutput = {
  execution: SshExecution
  commands: SshCommandResult[]
}

export type SshRunCommandsResult = SshExecutionOutput & {
  wait: boolean
}

export type SshClientCommandStartEvent = {
  index: number
  command: string
}

export type SshClientOutputEvent = {
  index: number
  chunk: string
}

export type SshClientCommandCompleteEvent = {
  index: number
  exitCode?: number
  signal?: string
  durationMs?: number
  status?: Extract<SshCommandStatus, 'succeeded' | 'failed' | 'cancelled'>
}

export type SshClientCommandSkippedEvent = {
  index: number
  reason?: string
}

export type SshClientRunInput = {
  server: Pick<SshServer, 'id' | 'name' | 'host' | 'port' | 'username'>
  privateKey: string
  passphrase?: string
  commands: string[]
  stopOnError: boolean
  timeoutMs: number
  onCommandStart(event: SshClientCommandStartEvent): Promise<void> | void
  onStdout(event: SshClientOutputEvent): Promise<void> | void
  onStderr(event: SshClientOutputEvent): Promise<void> | void
  onCommandComplete(event: SshClientCommandCompleteEvent): Promise<void> | void
  onCommandSkipped(event: SshClientCommandSkippedEvent): Promise<void> | void
  onCommandCancelled(event: { index: number; reason?: string }): Promise<void> | void
}

export type SshClientAdapter = {
  run(input: SshClientRunInput): Promise<void>
}

export type SshConfigurationService = {
  listKeys(): Promise<SshKey[]>
  getKey(id: string): Promise<SshKey | undefined>
  createKey(input: CreateSshKeyInput): Promise<SshKey>
  deleteKey(id: string): Promise<void>
  listServers(): Promise<SshServer[]>
  getServer(id: string): Promise<SshServer | undefined>
  createServer(input: CreateSshServerInput): Promise<SshServer>
  updateServer(input: UpdateSshServerInput): Promise<SshServer>
  deleteServer(id: string): Promise<void>
  listServersForAgent(): Promise<SshServerAgentSummary[]>
  runCommands(input: RunSshCommandsInput): Promise<SshRunCommandsResult>
  listExecutions(input: ListSshExecutionsInput): Promise<SshExecutionListItem[]>
  getExecutionOutput(input: GetSshExecutionOutputInput): Promise<SshExecutionOutput>
  waitForIdle(executionId?: string): Promise<void>
}

export type SshConfigurationServiceOptions = {
  persistence: Persistence
  credentialVault: CredentialVaultService
  adapter: SshClientAdapter
  now?: () => string
  createId?: (prefix: string) => string
}

const stripUndefined = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
const normalizeOptionalText = (value: string | undefined): string | undefined => value?.trim() || undefined
const commandFinished = (status: SshCommandResult['status']) => ['succeeded', 'failed', 'skipped', 'cancelled'].includes(status)

const activeCommandStatuses = new Set<SshCommandStatus>(['queued', 'running'])

function defaultCreateId(prefix: string): string {
  return sharedCreateId(prefix as Parameters<typeof sharedCreateId>[0])
}

function requireText(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  return trimmed
}

function requireId(id: string, label = 'id'): string {
  return requireText(id, label)
}

function normalizePort(port: number | undefined): number {
  const normalized = port ?? 22
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw new Error('port must be between 1 and 65535')
  }
  return normalized
}

function normalizeCommands(commands: string[]): string[] {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('commands must contain at least one command')
  }

  return commands.map((command, index) => {
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error(`commands[${index}] is required`)
    }
    if (command.includes('\0')) {
      throw new Error(`commands[${index}] cannot contain null bytes`)
    }
    return command
  })
}

function assertTimeoutMs(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error('timeoutMs must be a non-negative integer')
  }
  return timeoutMs
}

function ensureCommandIndex(commands: string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= commands.length) {
    throw new Error(`SSH command index is out of range: ${index}`)
  }
  const command = commands[index]
  if (command === undefined) {
    throw new Error(`SSH command index is out of range: ${index}`)
  }
  return command
}

function errorForAdapterFailure(): RunError {
  return {
    code: 'tool_error',
    message: 'SSH command execution failed',
    retryable: false
  }
}

function commandStatusFromComplete(event: SshClientCommandCompleteEvent): Extract<SshCommandStatus, 'succeeded' | 'failed' | 'cancelled'> {
  if (event.status) return event.status
  if (event.signal) return 'cancelled'
  return event.exitCode === 0 ? 'succeeded' : 'failed'
}

function finalExecutionStatus(results: SshCommandResult[]): Extract<SshExecutionStatus, 'succeeded' | 'failed' | 'cancelled'> {
  if (results.some((result) => result.status === 'failed')) return 'failed'
  if (results.some((result) => result.status === 'cancelled')) return 'cancelled'
  return 'succeeded'
}

export function createSshConfigurationService(options: SshConfigurationServiceOptions): SshConfigurationService {
  const now = options.now ?? nowIso
  const createId = options.createId ?? defaultCreateId
  const activeExecutions = new Map<string, Promise<void>>()

  const getExecutionForSession = async (input: GetSshExecutionOutputInput): Promise<SshExecution> => {
    const execution = await options.persistence.sshExecutions.get(requireId(input.executionId, 'executionId'))
    if (!execution || execution.sessionId !== input.sessionId) {
      throw new Error('SSH execution not found')
    }
    return execution
  }

  const getCommandResult = async (executionId: string, index: number, commands: string[]): Promise<SshCommandResult> => {
    const command = ensureCommandIndex(commands, index)
    const results = await options.persistence.sshCommandResults.listByExecution(executionId)
    return results.find((result) => result.index === index) ?? {
      executionId,
      index,
      command,
      status: 'queued',
      stdout: '',
      stderr: ''
    }
  }

  const saveCommandResult = async (result: SshCommandResult): Promise<void> => {
    await options.persistence.sshCommandResults.save(sshCommandResultSchema.parse(stripUndefined({ ...result })))
  }

  const saveExecution = async (execution: SshExecution): Promise<void> => {
    await options.persistence.sshExecutions.save(sshExecutionSchema.parse(stripUndefined({ ...execution })))
  }

  const touchExecution = async (executionId: string, status?: SshExecutionStatus): Promise<void> => {
    const execution = await options.persistence.sshExecutions.get(executionId)
    if (!execution) return
    await saveExecution({ ...execution, ...(status ? { status } : {}), updatedAt: now() })
  }

  const buildExecutionOutput = async (execution: SshExecution): Promise<SshExecutionOutput> => {
    const commands = (await options.persistence.sshCommandResults.listByExecution(execution.id)).sort((left, right) => left.index - right.index)
    return { execution, commands }
  }

  const failExecution = async (executionId: string, commands: string[]): Promise<void> => {
    const timestamp = now()
    const execution = await options.persistence.sshExecutions.get(executionId)
    if (!execution) return

    const results = await options.persistence.sshCommandResults.listByExecution(executionId)
    const hasFailedCommand = results.some((result) => result.status === 'failed')
    const firstUnfinished = results.find((result) => activeCommandStatuses.has(result.status))
    if (!hasFailedCommand && firstUnfinished) {
      await saveCommandResult(stripUndefined({
        ...firstUnfinished,
        status: 'failed' as const,
        stderr: firstUnfinished.stderr || 'SSH command execution failed',
        completedAt: timestamp
      }))
    }

    const latestResults = await options.persistence.sshCommandResults.listByExecution(executionId)
    for (const result of latestResults) {
      if (result.status === 'queued') {
        await saveCommandResult(stripUndefined({
          ...result,
          status: 'skipped' as const,
          completedAt: timestamp,
          skippedReason: 'execution failed'
        }))
      } else if (result.status === 'running') {
        await saveCommandResult(stripUndefined({
          ...result,
          status: 'failed' as const,
          stderr: result.stderr || 'SSH command execution failed',
          completedAt: timestamp
        }))
      }
    }

    await saveExecution(stripUndefined({
      ...execution,
      status: 'failed' as const,
      updatedAt: timestamp,
      completedAt: timestamp,
      error: errorForAdapterFailure()
    }))
  }

  const finalizeExecution = async (executionId: string): Promise<void> => {
    const execution = await options.persistence.sshExecutions.get(executionId)
    if (!execution) return
    const timestamp = now()
    const results = await options.persistence.sshCommandResults.listByExecution(executionId)
    const status = finalExecutionStatus(results)
    await saveExecution(stripUndefined({
      ...execution,
      status,
      updatedAt: timestamp,
      completedAt: timestamp
    }))
  }

  const startExecution = (input: {
    execution: SshExecution
    server: SshServer
    privateKey: string
    passphrase?: string
  }): void => {
    let firstCallbackError: unknown
    let operationQueue = Promise.resolve()
    const commands = input.execution.commands

    const enqueue = (operation: () => Promise<void>): Promise<void> => {
      const operationPromise = operationQueue.then(async () => {
        if (firstCallbackError) return
        try {
          await operation()
        } catch (error) {
          firstCallbackError = error
          throw error
        }
      })
      operationQueue = operationPromise.catch(() => undefined)
      return operationPromise
    }

    const drainOperations = async (): Promise<void> => {
      await operationQueue
      if (firstCallbackError) throw firstCallbackError
    }

    const runPromise = (async () => {
      try {
        const adapterInput: SshClientRunInput = {
          server: {
            id: input.server.id,
            name: input.server.name,
            host: input.server.host,
            port: input.server.port,
            username: input.server.username
          },
          privateKey: input.privateKey,
          ...(input.passphrase !== undefined ? { passphrase: input.passphrase } : {}),
          commands,
          stopOnError: input.execution.stopOnError,
          timeoutMs: input.execution.timeoutMs,
          onCommandStart: (event: SshClientCommandStartEvent) => enqueue(async () => {
            const command = ensureCommandIndex(commands, event.index)
            const current = await getCommandResult(input.execution.id, event.index, commands)
            await saveCommandResult({
              ...current,
              command: event.command || command,
              status: 'running',
              startedAt: current.startedAt ?? now()
            })
            await touchExecution(input.execution.id, 'running')
          }),
          onStdout: (event: SshClientOutputEvent) => enqueue(async () => {
            const current = await getCommandResult(input.execution.id, event.index, commands)
            await saveCommandResult({
              ...current,
              stdout: current.stdout + event.chunk
            })
            await touchExecution(input.execution.id)
          }),
          onStderr: (event: SshClientOutputEvent) => enqueue(async () => {
            const current = await getCommandResult(input.execution.id, event.index, commands)
            await saveCommandResult({
              ...current,
              stderr: current.stderr + event.chunk
            })
            await touchExecution(input.execution.id)
          }),
          onCommandComplete: (event: SshClientCommandCompleteEvent) => enqueue(async () => {
            const current = await getCommandResult(input.execution.id, event.index, commands)
            const status = commandStatusFromComplete(event)
            await saveCommandResult({
              ...current,
              status,
              ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
              ...(event.signal !== undefined ? { signal: event.signal } : {}),
              ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
              completedAt: now()
            })
            await touchExecution(input.execution.id)
          }),
          onCommandSkipped: (event: SshClientCommandSkippedEvent) => enqueue(async () => {
            const current = await getCommandResult(input.execution.id, event.index, commands)
            await saveCommandResult({
              ...current,
              status: 'skipped',
              ...(event.reason !== undefined ? { skippedReason: event.reason } : {}),
              completedAt: now()
            })
            await touchExecution(input.execution.id)
          }),
          onCommandCancelled: (event: { index: number; reason?: string }) => enqueue(async () => {
            const current = await getCommandResult(input.execution.id, event.index, commands)
            await saveCommandResult({
              ...current,
              status: 'cancelled',
              ...(event.reason !== undefined ? { signal: event.reason } : {}),
              completedAt: now()
            })
            await touchExecution(input.execution.id)
          })
        }
        await options.adapter.run(adapterInput)
        await drainOperations()
        await finalizeExecution(input.execution.id)
      } catch {
        try {
          await operationQueue
        } catch {
          // The execution is failed below with a sanitized error.
        }
        await failExecution(input.execution.id, commands)
      }
    })()

    const trackedPromise = runPromise.finally(() => {
      activeExecutions.delete(input.execution.id)
    })
    activeExecutions.set(input.execution.id, trackedPromise)
  }

  const service: SshConfigurationService = {
    async listKeys() {
      return options.persistence.sshKeys.list()
    },
    async getKey(id) {
      return options.persistence.sshKeys.get(requireId(id))
    },
    async createKey(input) {
      const id = createId('ssh-key')
      const timestamp = now()
      const name = requireText(input.name, 'name')
      const privateKey = requireText(input.privateKey, 'privateKey')
      const passphrase = normalizeOptionalText(input.passphrase)
      const note = normalizeOptionalText(input.note)

      await options.credentialVault.saveSshPrivateKey({ keyId: id, privateKey })
      if (passphrase) {
        await options.credentialVault.saveSshPassphrase({ keyId: id, passphrase })
      }

      const key = sshKeySchema.parse(stripUndefined({
        id,
        name,
        note,
        hasPassphrase: Boolean(passphrase),
        createdAt: timestamp,
        updatedAt: timestamp
      }))
      await options.persistence.sshKeys.save(key)
      return key
    },
    async deleteKey(id) {
      const keyId = requireId(id)
      const servers = await options.persistence.sshServers.listByKeyId(keyId)
      if (servers.length > 0) {
        throw new Error(`SSH key is used by ${servers.length} server(s)`)
      }
      await options.persistence.sshKeys.delete(keyId)
      await options.credentialVault.deleteSshPrivateKey({ keyId })
      await options.credentialVault.deleteSshPassphrase({ keyId })
    },
    async listServers() {
      return options.persistence.sshServers.list()
    },
    async getServer(id) {
      return options.persistence.sshServers.get(requireId(id))
    },
    async createServer(input) {
      const timestamp = now()
      const keyId = requireId(input.keyId, 'keyId')
      const key = await options.persistence.sshKeys.get(keyId)
      if (!key) throw new Error('SSH key not found')

      const server = sshServerSchema.parse(stripUndefined({
        id: createId('ssh-server'),
        name: requireText(input.name, 'name'),
        host: requireText(input.host, 'host'),
        port: normalizePort(input.port),
        username: requireText(input.username, 'username'),
        keyId,
        note: normalizeOptionalText(input.note),
        createdAt: timestamp,
        updatedAt: timestamp
      }))
      await options.persistence.sshServers.save(server)
      return server
    },
    async updateServer(input) {
      const id = requireId(input.id)
      const existing = await options.persistence.sshServers.get(id)
      if (!existing) throw new Error('SSH server not found')

      const keyId = input.keyId !== undefined ? requireId(input.keyId, 'keyId') : existing.keyId
      const key = await options.persistence.sshKeys.get(keyId)
      if (!key) throw new Error('SSH key not found')

      const note = Object.prototype.hasOwnProperty.call(input, 'note')
        ? normalizeOptionalText(input.note ?? undefined)
        : existing.note

      const server = sshServerSchema.parse(stripUndefined({
        ...existing,
        name: input.name !== undefined ? requireText(input.name, 'name') : existing.name,
        host: input.host !== undefined ? requireText(input.host, 'host') : existing.host,
        port: normalizePort(input.port ?? existing.port),
        username: input.username !== undefined ? requireText(input.username, 'username') : existing.username,
        keyId,
        note,
        updatedAt: now()
      }))
      await options.persistence.sshServers.save(server)
      return server
    },
    async deleteServer(id) {
      await options.persistence.sshServers.delete(requireId(id))
    },
    async listServersForAgent() {
      const servers = await options.persistence.sshServers.list()
      return servers.map((server) => sshServerAgentSummarySchema.parse(stripUndefined({
        id: server.id,
        name: server.name,
        note: server.note
      })))
    },
    async runCommands(input) {
      const sessionId = requireId(input.sessionId, 'sessionId')
      const runId = requireId(input.runId, 'runId')
      const serverId = requireId(input.serverId, 'serverId')
      const commands = normalizeCommands(input.commands)
      const stopOnError = input.stopOnError ?? true
      const timeoutMs = assertTimeoutMs(input.timeoutMs ?? 0)
      const wait = input.wait ?? true

      const server = await options.persistence.sshServers.get(serverId)
      if (!server) throw new Error('SSH server not found')
      const key = await options.persistence.sshKeys.get(server.keyId)
      if (!key) throw new Error('SSH key not found')
      const privateKey = await options.credentialVault.readSshPrivateKey(key.id)
      if (!privateKey) throw new Error('SSH private key not found')
      const passphrase = key.hasPassphrase ? await options.credentialVault.readSshPassphrase(key.id) : undefined

      const timestamp = now()
      const execution = sshExecutionSchema.parse(stripUndefined({
        id: createId('ssh-exec'),
        sessionId,
        runId,
        serverId: server.id,
        serverName: server.name,
        commands,
        stopOnError,
        timeoutMs,
        status: 'running' as const,
        startedAt: timestamp,
        updatedAt: timestamp
      }))
      await options.persistence.sshExecutions.save(execution)
      for (const [index, command] of commands.entries()) {
        await saveCommandResult({
          executionId: execution.id,
          index,
          command,
          status: 'queued',
          stdout: '',
          stderr: ''
        })
      }

      startExecution(passphrase !== undefined ? { execution, server, privateKey, passphrase } : { execution, server, privateKey })
      if (wait) {
        await service.waitForIdle(execution.id)
      }
      const latest = await getExecutionForSession({ sessionId, executionId: execution.id })
      return { ...await buildExecutionOutput(latest), wait }
    },
    async listExecutions(input) {
      const sessionId = requireId(input.sessionId, 'sessionId')
      const executions = await options.persistence.sshExecutions.listBySession(sessionId)
      const filtered = input.status ? executions.filter((execution) => execution.status === input.status) : executions
      const items: SshExecutionListItem[] = []
      for (const execution of filtered) {
        const results = await options.persistence.sshCommandResults.listByExecution(execution.id)
        items.push({
          id: execution.id,
          sessionId: execution.sessionId,
          runId: execution.runId,
          serverId: execution.serverId,
          serverName: execution.serverName,
          status: execution.status,
          commandCount: execution.commands.length,
          completedCommandCount: results.filter((result) => commandFinished(result.status)).length,
          startedAt: execution.startedAt,
          updatedAt: execution.updatedAt,
          ...(execution.completedAt !== undefined ? { completedAt: execution.completedAt } : {}),
          ...(execution.error !== undefined ? { error: execution.error } : {})
        })
      }
      return items
    },
    async getExecutionOutput(input) {
      const sessionId = requireId(input.sessionId, 'sessionId')
      const executionId = requireId(input.executionId, 'executionId')
      const execution = await getExecutionForSession({ sessionId, executionId })
      return buildExecutionOutput(execution)
    },
    async waitForIdle(executionId) {
      if (executionId !== undefined) {
        const promise = activeExecutions.get(requireId(executionId, 'executionId'))
        if (promise) await promise
        return
      }
      await Promise.all([...activeExecutions.values()])
    }
  }

  return service
}
