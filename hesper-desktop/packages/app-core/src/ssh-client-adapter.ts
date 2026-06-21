import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import type { SshClientAdapter, SshClientRunInput } from './ssh-configuration-service'

type SshCommandCallbackResult = Parameters<SshClientRunInput['onCommandComplete']>[0]

const stopOnErrorSkippedReason = 'Previous command failed and stopOnError=true'
const executionAbortedMessage = 'SSH execution timed out or was aborted'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wrapSshClientError(error: unknown): Error {
  const message = errorMessage(error)
  return new Error(message.startsWith('SSH client failed:') ? message : `SSH client failed: ${message}`)
}

function chunkToText(chunk: unknown): string {
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf8')
  return String(chunk)
}

function commandAt(input: SshClientRunInput, index: number): string {
  const command = input.commands[index]
  if (command === undefined) throw new Error(`SSH command index is out of range: ${index}`)
  return command
}

function createExecutionAbort(input: SshClientRunInput): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined

  const abortExecution = () => {
    if (!controller.signal.aborted) controller.abort(new Error(executionAbortedMessage))
  }

  if (input.signal?.aborted) {
    abortExecution()
  } else {
    input.signal?.addEventListener('abort', abortExecution, { once: true })
  }

  if (input.timeoutMs > 0) {
    timeout = setTimeout(abortExecution, input.timeoutMs)
    timeout.unref?.()
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeout !== undefined) clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abortExecution)
    }
  }
}

function connectClient(client: Client, input: SshClientRunInput): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      client.off('ready', onReady)
      client.off('error', onError)
      client.off('close', onClose)
      input.signal?.removeEventListener('abort', onAbort)
    }

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const onReady = () => settle(resolve)
    const onError = (error: Error) => settle(() => reject(error))
    const onClose = () => settle(() => reject(new Error('SSH connection closed before ready')))
    const onAbort = () => {
      settle(() => reject(new Error(executionAbortedMessage)))
      client.destroy()
    }

    if (input.signal?.aborted) {
      onAbort()
      return
    }

    client.once('ready', onReady)
    client.once('error', onError)
    client.once('close', onClose)
    input.signal?.addEventListener('abort', onAbort, { once: true })

    const config: ConnectConfig = {
      host: input.host,
      port: input.port,
      username: input.username,
      privateKey: input.privateKey,
      readyTimeout: 0,
      ...(input.passphrase !== undefined ? { passphrase: input.passphrase } : {})
    }

    try {
      client.connect(config)
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

function runSingleCommand(client: Client, input: SshClientRunInput, index: number): Promise<'succeeded' | 'failed'> {
  const command = commandAt(input, index)
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const startResult: SshCommandCallbackResult = {
    executionId: input.executionId,
    index,
    command,
    status: 'running',
    stdout: '',
    stderr: '',
    startedAt
  }

  return Promise.resolve(input.onCommandStart(startResult)).then(() => new Promise<'succeeded' | 'failed'>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let stream: ClientChannel | undefined
    let settled = false
    let callbackQueue = Promise.resolve()

    const cleanup = () => {
      input.signal?.removeEventListener('abort', onAbort)
    }

    const rejectOnce = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const enqueueCallback = (operation: () => Promise<void> | void) => {
      callbackQueue = callbackQueue.then(operation)
      void callbackQueue.catch(rejectOnce)
    }

    const appendStdout = (chunk: unknown) => {
      const text = chunkToText(chunk)
      stdout += text
      enqueueCallback(() => input.onStdout(index, text))
    }

    const appendStderr = (chunk: unknown) => {
      const text = chunkToText(chunk)
      stderr += text
      enqueueCallback(() => input.onStderr(index, text))
    }

    const complete = (code: number | null | undefined, exitSignal: string | null | undefined) => {
      if (settled) return
      settled = true
      cleanup()

      const completedAtMs = Date.now()
      const completedAt = new Date(completedAtMs).toISOString()
      const exitCode = typeof code === 'number' ? code : undefined
      const status = exitCode === 0 ? 'succeeded' : 'failed'
      const result: SshCommandCallbackResult = {
        executionId: input.executionId,
        index,
        command,
        status,
        stdout,
        stderr,
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(typeof exitSignal === 'string' && exitSignal ? { signal: exitSignal } : {}),
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAtMs - startedAtMs)
      }

      void callbackQueue
        .then(() => input.onCommandComplete(result))
        .then(() => resolve(status), reject)
    }

    const onAbort = () => {
      const currentStream = stream
      rejectOnce(new Error(executionAbortedMessage))
      currentStream?.close()
      client.destroy()
    }

    if (input.signal?.aborted) {
      onAbort()
      return
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      client.exec(command, (error, channel) => {
        if (error) {
          rejectOnce(error)
          return
        }

        stream = channel
        channel.on('data', appendStdout)
        channel.stderr.on('data', appendStderr)
        channel.once('error', rejectOnce)
        channel.once('close', (code: number | null, exitSignal: string | undefined) => complete(code, exitSignal))
      })
    } catch (error) {
      rejectOnce(error)
    }
  }))
}

async function skipRemainingCommands(input: SshClientRunInput, startIndex: number): Promise<void> {
  for (let index = startIndex; index < input.commands.length; index += 1) {
    const command = commandAt(input, index)
    await input.onCommandSkipped({
      executionId: input.executionId,
      index,
      command,
      status: 'skipped',
      stdout: '',
      stderr: '',
      completedAt: new Date().toISOString(),
      skippedReason: stopOnErrorSkippedReason
    })
  }
}

export function createSsh2ClientAdapter(): SshClientAdapter {
  return {
    async runCommands(input) {
      const client = new Client()
      const executionAbort = createExecutionAbort(input)
      const executionInput: SshClientRunInput = { ...input, signal: executionAbort.signal }
      try {
        await connectClient(client, executionInput)

        for (let index = 0; index < executionInput.commands.length; index += 1) {
          const status = await runSingleCommand(client, executionInput, index)
          if (status === 'failed' && executionInput.stopOnError) {
            await skipRemainingCommands(executionInput, index + 1)
            return
          }
        }
      } catch (error) {
        throw wrapSshClientError(error)
      } finally {
        executionAbort.cleanup()
        client.end()
      }
    }
  }
}
