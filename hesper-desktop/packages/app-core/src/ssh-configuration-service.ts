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
  publicKey: string
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

export type SshDeleteResult = {
  deleted: true
  id: string
}

export type SshExecutionListItem = {
  id: string
  serverId: string
  serverName: string
  status: SshExecutionStatus
  startedAt: string
  updatedAt: string
  completedAt?: string
  commandCount: number
  completedCommandCount: number
  error?: RunError
}

export type SshExecutionOutput = {
  executionId: string
  serverId: string
  serverName: string
  status: SshExecutionStatus
  startedAt: string
  updatedAt: string
  completedAt?: string
  results: SshCommandResult[]
}

export type SshRunCommandsResult = SshExecutionOutput & {
  wait: boolean
  stoppedOnError: boolean
}

export type SshClientRunInput = {
  executionId: string
  host: string
  port: number
  username: string
  privateKey: string
  passphrase?: string
  commands: string[]
  stopOnError: boolean
  timeoutMs: number
  signal?: AbortSignal
  onCommandStart(result: SshCommandResult): Promise<void> | void
  onStdout(index: number, chunk: string): Promise<void> | void
  onStderr(index: number, chunk: string): Promise<void> | void
  onCommandComplete(result: SshCommandResult): Promise<void> | void
  onCommandSkipped(result: SshCommandResult): Promise<void> | void
}

export type SshClientAdapter = {
  runCommands(input: SshClientRunInput): Promise<void>
}

export type SshConfigurationService = {
  listKeys(): Promise<SshKey[]>
  getKey(id: string): Promise<SshKey | undefined>
  createKey(input: CreateSshKeyInput): Promise<SshKey>
  deleteKey(id: string): Promise<SshDeleteResult>
  listServers(): Promise<SshServer[]>
  getServer(id: string): Promise<SshServer | undefined>
  createServer(input: CreateSshServerInput): Promise<SshServer>
  updateServer(input: UpdateSshServerInput): Promise<SshServer>
  deleteServer(id: string): Promise<SshDeleteResult>
  listServersForAgent(): Promise<SshServerAgentSummary[]>
  runCommands(input: RunSshCommandsInput): Promise<SshRunCommandsResult>
  listExecutions(input: ListSshExecutionsInput): Promise<{ executions: SshExecutionListItem[]; count: number }>
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

function finalExecutionStatus(results: SshCommandResult[]): Extract<SshExecutionStatus, 'succeeded' | 'failed' | 'cancelled'> {
  if (results.some((result) => result.status === 'failed')) return 'failed'
  if (results.some((result) => result.status === 'cancelled')) return 'cancelled'
  return 'succeeded'
}

function stoppedOnError(execution: SshExecution, results: SshCommandResult[]): boolean {
  return execution.stopOnError && results.some((result) => result.status === 'skipped')
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

  const normalizeCallbackResult = (executionId: string, commands: string[], result: SshCommandResult): SshCommandResult => {
    const command = ensureCommandIndex(commands, result.index)
    return sshCommandResultSchema.parse(stripUndefined({
      ...result,
      executionId,
      command: result.command || command,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? ''
    }))
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
    const results = (await options.persistence.sshCommandResults.listByExecution(execution.id)).sort((left, right) => left.index - right.index)
    return {
      executionId: execution.id,
      serverId: execution.serverId,
      serverName: execution.serverName,
      status: execution.status,
      startedAt: execution.startedAt,
      updatedAt: execution.updatedAt,
      ...(execution.completedAt !== undefined ? { completedAt: execution.completedAt } : {}),
      results
    }
  }

  const buildRunCommandsResult = async (execution: SshExecution, wait: boolean): Promise<SshRunCommandsResult> => {
    const output = await buildExecutionOutput(execution)
    return {
      ...output,
      wait,
      stoppedOnError: stoppedOnError(execution, output.results)
    }
  }

  const failExecution = async (executionId: string, commands: string[]): Promise<void> => {
    const timestamp = now()
    const execution = await options.persistence.sshExecutions.get(executionId)
    if (!execution) return

    const results = await options.persistence.sshCommandResults.listByExecution(executionId)
    const hasFailedCommand = results.some((result) => result.status === 'failed')
    const firstUnfinished = results.find((result) => activeCommandStatuses.has(result.status))
    if (!hasFailedCommand && firstUnfinished) {
      await saveCommandResult({
        ...firstUnfinished,
        status: 'failed',
        stderr: firstUnfinished.stderr || 'SSH command execution failed',
        completedAt: timestamp
      })
    }

    const latestResults = await options.persistence.sshCommandResults.listByExecution(executionId)
    for (const result of latestResults) {
      if (result.status === 'queued') {
        await saveCommandResult({
          ...result,
          status: 'skipped',
          completedAt: timestamp,
          skippedReason: 'execution failed'
        })
      } else if (result.status === 'running') {
        await saveCommandResult({
          ...result,
          status: 'failed',
          stderr: result.stderr || 'SSH command execution failed',
          completedAt: timestamp
        })
      }
    }

    await saveExecution({
      ...execution,
      status: 'failed',
      updatedAt: timestamp,
      completedAt: timestamp,
      error: errorForAdapterFailure()
    })
  }

  const finalizeExecution = async (executionId: string): Promise<void> => {
    const execution = await options.persistence.sshExecutions.get(executionId)
    if (!execution) return
    const timestamp = now()
    const results = await options.persistence.sshCommandResults.listByExecution(executionId)
    const status = finalExecutionStatus(results)
    await saveExecution({
      ...execution,
      status,
      updatedAt: timestamp,
      completedAt: timestamp
    })
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
          executionId: input.execution.id,
          host: input.server.host,
          port: input.server.port,
          username: input.server.username,
          privateKey: input.privateKey,
          ...(input.passphrase !== undefined ? { passphrase: input.passphrase } : {}),
          commands,
          stopOnError: input.execution.stopOnError,
          timeoutMs: input.execution.timeoutMs,
          onCommandStart: (result: SshCommandResult) => enqueue(async () => {
            const normalized = normalizeCallbackResult(input.execution.id, commands, result)
            const current = await getCommandResult(input.execution.id, normalized.index, commands)
            await saveCommandResult({
              ...current,
              ...normalized,
              stdout: normalized.stdout || current.stdout,
              stderr: normalized.stderr || current.stderr,
              startedAt: normalized.startedAt ?? current.startedAt ?? now()
            })
            await touchExecution(input.execution.id, 'running')
          }),
          onStdout: (index: number, chunk: string) => enqueue(async () => {
            const current = await getCommandResult(input.execution.id, index, commands)
            await saveCommandResult({
              ...current,
              status: current.status === 'queued' ? 'running' : current.status,
              stdout: current.stdout + chunk,
              startedAt: current.startedAt ?? now()
            })
            await touchExecution(input.execution.id, 'running')
          }),
          onStderr: (index: number, chunk: string) => enqueue(async () => {
            const current = await getCommandResult(input.execution.id, index, commands)
            await saveCommandResult({
              ...current,
              status: current.status === 'queued' ? 'running' : current.status,
              stderr: current.stderr + chunk,
              startedAt: current.startedAt ?? now()
            })
            await touchExecution(input.execution.id, 'running')
          }),
          onCommandComplete: (result: SshCommandResult) => enqueue(async () => {
            const normalized = normalizeCallbackResult(input.execution.id, commands, result)
            const current = await getCommandResult(input.execution.id, normalized.index, commands)
            const startedAt = normalized.startedAt ?? current.startedAt
            await saveCommandResult({
              ...current,
              ...normalized,
              stdout: normalized.stdout || current.stdout,
              stderr: normalized.stderr || current.stderr,
              ...(startedAt !== undefined ? { startedAt } : {}),
              completedAt: normalized.completedAt ?? now()
            })
            await touchExecution(input.execution.id)
          }),
          onCommandSkipped: (result: SshCommandResult) => enqueue(async () => {
            const normalized = normalizeCallbackResult(input.execution.id, commands, result)
            const current = await getCommandResult(input.execution.id, normalized.index, commands)
            const startedAt = normalized.startedAt ?? current.startedAt
            await saveCommandResult({
              ...current,
              ...normalized,
              status: 'skipped',
              stdout: normalized.stdout || current.stdout,
              stderr: normalized.stderr || current.stderr,
              ...(startedAt !== undefined ? { startedAt } : {}),
              completedAt: normalized.completedAt ?? now()
            })
            await touchExecution(input.execution.id)
          })
        }
        await options.adapter.runCommands(adapterInput)
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
      const publicKey = requireText(input.publicKey, 'publicKey')
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
        publicKey,
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
      return { deleted: true, id: keyId }
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
      const serverId = requireId(id)
      await options.persistence.sshServers.delete(serverId)
      return { deleted: true, id: serverId }
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
      if (key.hasPassphrase && !passphrase) throw new Error('SSH passphrase not found')

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
        status: 'running',
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
      return buildRunCommandsResult(latest, wait)
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
          serverId: execution.serverId,
          serverName: execution.serverName,
          status: execution.status,
          startedAt: execution.startedAt,
          updatedAt: execution.updatedAt,
          ...(execution.completedAt !== undefined ? { completedAt: execution.completedAt } : {}),
          commandCount: execution.commands.length,
          completedCommandCount: results.filter((result) => commandFinished(result.status)).length,
          ...(execution.error !== undefined ? { error: execution.error } : {})
        })
      }
      return { executions: items, count: items.length }
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
