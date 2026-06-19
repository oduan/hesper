import type { ToolDefinition } from '@hesper/shared'
import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { mkdir, open, realpath, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { ToolExecutionContext, ToolExecutionResult, ToolExecutor } from './tool-runner'

const execFileAsync = promisify(execFile)

export type GitStatusOptions = {
  timeoutMs: number
  signal?: AbortSignal
}

export type RequestHttpUrl = (url: URL, addresses: string[], signal: AbortSignal, timeoutMs: number, maxFetchBytes: number) => Promise<FetchResult>

export type BuiltinToolExecutorOptions = {
  maxReadBytes?: number
  maxFetchBytes?: number
  gitTimeoutMs?: number
  fetchTimeoutMs?: number
  requestHttp?: RequestHttpUrl
  resolveHostname?: (hostname: string) => Promise<string[]>
  runGitStatus?: (workspacePath: string, options: GitStatusOptions) => Promise<string>
  showNotification?: (message: string) => Promise<void> | void
  now?: () => string
}

type LimitedTextResult = {
  text: string
  bytesRead: number
  truncated: boolean
}

type FetchResult = LimitedTextResult & {
  status: number
  contentType?: string | undefined
}

const defaultMaxReadBytes = 256 * 1024
const defaultMaxFetchBytes = 256 * 1024
const defaultGitTimeoutMs = 10_000
const defaultFetchTimeoutMs = 15_000

function argsObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Tool arguments must be an object')
  }
  return args as Record<string, unknown>
}

function stringArg(args: unknown, key: string): string {
  const value = argsObject(args)[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Tool argument must be a non-empty string: ${key}`)
  }
  return value
}

function requireWorkspace(context: ToolExecutionContext): string {
  const workspacePath = context.workspacePath?.trim()
  if (!workspacePath) {
    throw new Error('A selected workspace is required for this tool')
  }
  return resolve(workspacePath)
}

function isWithinWorkspace(workspacePath: string, candidatePath: string): boolean {
  const normalizedWorkspace = workspacePath.endsWith(sep) ? workspacePath : `${workspacePath}${sep}`
  return candidatePath === workspacePath || candidatePath.startsWith(normalizedWorkspace)
}

function lexicalWorkspacePath(context: ToolExecutionContext, requestedPath: string): string {
  const workspacePath = requireWorkspace(context)
  const candidatePath = resolve(workspacePath, requestedPath)
  const absoluteCandidate = isAbsolute(requestedPath) ? resolve(requestedPath) : candidatePath
  if (!isWithinWorkspace(workspacePath, absoluteCandidate)) {
    throw new Error(`Tool path is outside the selected workspace: ${requestedPath}`)
  }
  return absoluteCandidate
}

async function realWorkspacePath(context: ToolExecutionContext): Promise<string> {
  return realpath(requireWorkspace(context))
}

async function resolveExistingWorkspaceFile(context: ToolExecutionContext, requestedPath: string): Promise<string> {
  const lexicalPath = lexicalWorkspacePath(context, requestedPath)
  const workspacePath = await realWorkspacePath(context)
  const targetPath = await realpath(lexicalPath)
  if (!isWithinWorkspace(workspacePath, targetPath)) {
    throw new Error(`Tool path is outside the selected workspace: ${requestedPath}`)
  }
  return targetPath
}

async function resolveWritableWorkspaceFile(context: ToolExecutionContext, requestedPath: string): Promise<string> {
  const lexicalPath = lexicalWorkspacePath(context, requestedPath)
  const workspacePath = await realWorkspacePath(context)

  try {
    const existingTarget = await realpath(lexicalPath)
    if (!isWithinWorkspace(workspacePath, existingTarget)) {
      throw new Error(`Tool path is outside the selected workspace: ${requestedPath}`)
    }
    return existingTarget
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }

  const pendingSegments: string[] = []
  let parent = dirname(lexicalPath)
  let realParent: string | undefined
  while (!realParent) {
    try {
      realParent = await realpath(parent)
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
      const nextParent = dirname(parent)
      if (nextParent === parent) throw error
      pendingSegments.unshift(basename(parent))
      parent = nextParent
    }
  }

  const finalParent = resolve(realParent, ...pendingSegments)
  if (!isWithinWorkspace(workspacePath, finalParent)) {
    throw new Error(`Tool path is outside the selected workspace: ${requestedPath}`)
  }
  await mkdir(finalParent, { recursive: true })
  return resolve(finalParent, basename(lexicalPath))
}

async function readTextFile(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, maxReadBytes: number): Promise<ToolExecutionResult> {
  const filePath = await resolveExistingWorkspaceFile(context, stringArg(args, 'path'))
  const info = await stat(filePath)
  if (!info.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`)
  }

  const handle = await open(filePath, 'r')
  try {
    const readLimit = Math.min(info.size, maxReadBytes + 1)
    const buffer = Buffer.alloc(readLimit)
    const { bytesRead } = await handle.read(buffer, 0, readLimit, 0)
    const truncated = info.size > maxReadBytes || bytesRead > maxReadBytes
    const content = buffer.subarray(0, Math.min(bytesRead, maxReadBytes)).toString('utf8')
    return {
      content,
      details: { toolId: tool.id, path: filePath, bytes: info.size, truncated }
    }
  } finally {
    await handle.close()
  }
}

async function writeTextFile(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const filePath = await resolveWritableWorkspaceFile(context, stringArg(args, 'path'))
  const content = stringArg(args, 'content')
  await writeFile(filePath, content, 'utf8')
  const bytes = Buffer.byteLength(content, 'utf8')
  return {
    content: `Wrote ${bytes} bytes to ${filePath}`,
    details: { toolId: tool.id, path: filePath, bytes }
  }
}

async function defaultRunGitStatus(workspacePath: string, options: GitStatusOptions): Promise<string> {
  const safeWorkspacePath = await realpath(workspacePath)
  const result = await execFileAsync('git', ['-C', safeWorkspacePath, 'status', '--short', '--branch'], {
    timeout: options.timeoutMs,
    maxBuffer: 256 * 1024,
    ...(options.signal !== undefined ? { signal: options.signal } : {})
  })
  return result.stdout || result.stderr
}

async function gitStatus(tool: ToolDefinition, context: ToolExecutionContext, runGitStatus: (workspacePath: string, options: GitStatusOptions) => Promise<string>, timeoutMs: number): Promise<ToolExecutionResult> {
  const workspacePath = await realWorkspacePath(context)
  const content = await runGitStatus(workspacePath, { timeoutMs, ...(context.signal !== undefined ? { signal: context.signal } : {}) })
  return {
    content,
    details: { toolId: tool.id, workspacePath }
  }
}

function createChildSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (parent?.aborted) controller.abort()
  parent?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout)
      parent?.removeEventListener('abort', onAbort)
    }
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [first, second] = parts as [number, number, number, number]
  return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127)
}

function ipv4Bytes(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined
  const bytes = address.split('.').map((part) => Number.parseInt(part, 10))
  return bytes.length === 4 && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : undefined
}

function parseIpv6Hextets(address: string): number[] | undefined {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  if (isIP(normalized) !== 6) return undefined

  const parseSegment = (segment: string): number[] | undefined => {
    if (!segment) return []
    const parts = segment.split(':')
    const hextets: number[] = []
    for (const [index, part] of parts.entries()) {
      if (!part) return undefined
      if (part.includes('.')) {
        if (index !== parts.length - 1) return undefined
        const bytes = ipv4Bytes(part)
        if (!bytes) return undefined
        const [b0, b1, b2, b3] = bytes as [number, number, number, number]
        hextets.push((b0 << 8) | b1, (b2 << 8) | b3)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined
      hextets.push(Number.parseInt(part, 16))
    }
    return hextets
  }

  const doubleColonParts = normalized.split('::')
  if (doubleColonParts.length > 2) return undefined
  const head = parseSegment(doubleColonParts[0] ?? '')
  const tail = parseSegment(doubleColonParts[1] ?? '')
  if (!head || !tail) return undefined

  if (doubleColonParts.length === 2) {
    const missing = 8 - head.length - tail.length
    return missing >= 1 ? [...head, ...Array.from({ length: missing }, () => 0), ...tail] : undefined
  }

  return head.length === 8 ? head : undefined
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  const hextets = parseIpv6Hextets(address)
  if (!hextets || hextets.length !== 8) return undefined
  const isMapped = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff
  if (!isMapped) return undefined
  const value = (hextets[6] ?? 0) * 0x10000 + (hextets[7] ?? 0)
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ].join('.')
}

function isPrivateIpv6(address: string): boolean {
  const mappedIpv4 = ipv4FromMappedIpv6(address)
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4)
  const hextets = parseIpv6Hextets(address)
  if (!hextets) return true
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [number, number, number, number, number, number, number, number]
  const allButLastZero = [h0, h1, h2, h3, h4, h5, h6].every((part) => part === 0)
  const ipv4CompatiblePrivate = [h0, h1, h2, h3, h4, h5].every((part) => part === 0) && isPrivateIpv4([
    (h6 >>> 8) & 0xff,
    h6 & 0xff,
    (h7 >>> 8) & 0xff,
    h7 & 0xff
  ].join('.'))
  return hextets.every((part) => part === 0) || (allButLastZero && h7 === 1) || ipv4CompatiblePrivate || (h0 & 0xffc0) === 0xfe80 || (h0 & 0xfe00) === 0xfc00 || (h0 & 0xff00) === 0xff00
}

function isPrivateAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) return isPrivateIpv4(address)
  if (kind === 6) return isPrivateIpv6(address)
  return true
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

async function resolveHostnameWithTimeout(hostname: string, resolveHostname: (hostname: string) => Promise<string[]>, signal: AbortSignal): Promise<string[]> {
  if (signal.aborted) throw new Error('URL resolution timed out or was aborted')
  return Promise.race([
    resolveHostname(hostname),
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('URL resolution timed out or was aborted')), { once: true })
    })
  ])
}

async function resolvePublicHttpTarget(url: URL, resolveHostname: (hostname: string) => Promise<string[]>, signal: AbortSignal): Promise<string[]> {
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed')
  }

  const addresses = isIP(hostname) ? [hostname] : await resolveHostnameWithTimeout(hostname, resolveHostname, signal)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error('Private network URLs are not allowed')
  }
  return addresses
}

function mergeChunks(chunks: Uint8Array[], bytesRead: number, maxBytes: number): LimitedTextResult {
  const merged = new Uint8Array(bytesRead)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return {
    text: new TextDecoder().decode(merged.slice(0, maxBytes)),
    bytesRead,
    truncated: bytesRead > maxBytes
  }
}

function headerString(value: string | string[] | number | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'number') return String(value)
  return value
}

function fetchPinnedHttpUrl(url: URL, addresses: string[], signal: AbortSignal, timeoutMs: number, maxFetchBytes: number): Promise<FetchResult> {
  const address = addresses[0]
  if (!address) throw new Error('No public address resolved for URL')

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const settleResolve = (result: FetchResult) => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    const settleReject = (error: unknown) => {
      if (settled) return
      settled = true
      rejectPromise(error)
    }

    const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = requestImpl({
      protocol: url.protocol,
      hostname: address,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: { Host: url.host, 'User-Agent': 'hesper/0.1' },
      servername: url.hostname,
      timeout: timeoutMs
    }, (response) => {
      const status = response.statusCode ?? 0
      const contentType = headerString(response.headers['content-type'])
      if (status >= 300 && status < 400) {
        response.resume()
        settleReject(new Error('HTTP redirects are not allowed for web.fetch-url'))
        return
      }

      const chunks: Uint8Array[] = []
      let bytesRead = 0
      const resolveLimited = () => {
        settleResolve({ ...mergeChunks(chunks, bytesRead, maxFetchBytes), status, contentType })
        response.destroy()
        request.destroy()
      }
      response.on('data', (chunk: Buffer) => {
        if (settled || bytesRead > maxFetchBytes) return
        const remaining = maxFetchBytes + 1 - bytesRead
        if (chunk.byteLength > remaining) {
          chunks.push(chunk.subarray(0, remaining))
          bytesRead += remaining
          resolveLimited()
          return
        }
        chunks.push(chunk)
        bytesRead += chunk.byteLength
        if (bytesRead > maxFetchBytes) resolveLimited()
      })
      response.on('end', () => settleResolve({ ...mergeChunks(chunks, bytesRead, maxFetchBytes), status, contentType }))
      response.on('error', (error) => {
        if (bytesRead > maxFetchBytes) {
          settleResolve({ ...mergeChunks(chunks, bytesRead, maxFetchBytes), status, contentType })
          return
        }
        settleReject(error)
      })
    })

    const abort = () => request.destroy(new Error('web.fetch-url was aborted'))
    signal.addEventListener('abort', abort, { once: true })
    request.on('timeout', () => request.destroy(new Error('web.fetch-url timed out')))
    request.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      settleReject(error)
    })
    request.on('close', () => signal.removeEventListener('abort', abort))
    request.end()
  })
}

async function fetchUrl(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, requestHttp: RequestHttpUrl, resolveHostname: (hostname: string) => Promise<string[]>, maxFetchBytes: number, timeoutMs: number, now: () => string): Promise<ToolExecutionResult> {
  const rawUrl = stringArg(args, 'url')
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }

  const childSignal = createChildSignal(context.signal, timeoutMs)
  try {
    const addresses = await resolvePublicHttpTarget(parsed, resolveHostname, childSignal.signal)
    const fetched = await requestHttp(parsed, addresses, childSignal.signal, timeoutMs, maxFetchBytes)
    return {
      content: fetched.text,
      details: {
        toolId: tool.id,
        url: parsed.toString(),
        status: fetched.status,
        contentType: fetched.contentType,
        bytesRead: fetched.bytesRead,
        truncated: fetched.truncated,
        fetchedAt: now()
      }
    }
  } finally {
    childSignal.dispose()
  }
}

async function showNotification(tool: ToolDefinition, args: unknown, showNotificationImpl: ((message: string) => Promise<void> | void) | undefined): Promise<ToolExecutionResult> {
  const message = stringArg(args, 'message')
  if (!showNotificationImpl) {
    return {
      content: 'Desktop notification support is not available in this runtime.',
      details: { code: 'not_available', toolId: tool.id },
      isError: true
    }
  }
  await showNotificationImpl(message)
  return {
    content: `Notification: ${message}`,
    details: { toolId: tool.id, message }
  }
}

function workerAgentNotImplemented(tool: ToolDefinition): ToolExecutionResult {
  return {
    content: 'Worker Agent execution is not available yet.',
    details: { code: 'not_implemented', toolId: tool.id },
    isError: true
  }
}

export function createBuiltinToolExecutor(options: BuiltinToolExecutorOptions = {}): ToolExecutor {
  const maxReadBytes = options.maxReadBytes ?? defaultMaxReadBytes
  const maxFetchBytes = options.maxFetchBytes ?? defaultMaxFetchBytes
  const gitTimeoutMs = options.gitTimeoutMs ?? defaultGitTimeoutMs
  const fetchTimeoutMs = options.fetchTimeoutMs ?? defaultFetchTimeoutMs
  const runGitStatus = options.runGitStatus ?? defaultRunGitStatus
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname
  const requestHttp = options.requestHttp ?? fetchPinnedHttpUrl
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async execute(tool, args, context) {
      switch (tool.id) {
        case 'filesystem.read-file':
          return readTextFile(tool, args, context, maxReadBytes)
        case 'filesystem.write-file':
          return writeTextFile(tool, args, context)
        case 'git.status':
          return gitStatus(tool, context, runGitStatus, gitTimeoutMs)
        case 'web.fetch-url':
          return fetchUrl(tool, args, context, requestHttp, resolveHostname, maxFetchBytes, fetchTimeoutMs, now)
        case 'system.show-notification':
          return showNotification(tool, args, options.showNotification)
        case 'agent.spawn-subagent':
          // Legacy compatibility path: the tool is no longer exposed by default.
          return workerAgentNotImplemented(tool)
        default:
          throw new Error(`No builtin executor registered for tool: ${tool.id}`)
      }
    }
  }
}
