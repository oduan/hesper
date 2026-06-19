import type { ToolDefinition } from '@hesper/shared'
import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { lstat, mkdir, open, readdir, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
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
  readToolApiKey?: (toolId: string) => Promise<string | undefined>
  fetch?: typeof fetch
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
const defaultCommandTimeoutMs = 30_000
const defaultFetchTimeoutMs = 15_000
const defaultSearchMaxFileBytes = 256 * 1024
const tinyFishSearchEndpoint = 'https://api.search.tinyfish.ai'

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

function optionalStringArg(args: unknown, key: string, fallback?: string): string | undefined {
  const value = argsObject(args)[key]
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new Error(`Tool argument must be a string: ${key}`)
  const trimmed = value.trim()
  return trimmed || fallback
}

function booleanArg(args: unknown, key: string, fallback = false): boolean {
  const value = argsObject(args)[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`Tool argument must be a boolean: ${key}`)
  return value
}

function numberArg(args: unknown, key: string, fallback: number, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  const value = argsObject(args)[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Tool argument must be a finite number: ${key}`)
  const normalized = options.integer ? Math.floor(value) : value
  if (options.min !== undefined && normalized < options.min) throw new Error(`Tool argument ${key} must be >= ${options.min}`)
  if (options.max !== undefined && normalized > options.max) throw new Error(`Tool argument ${key} must be <= ${options.max}`)
  return normalized
}

function stringArrayArg(args: unknown, key: string): string[] {
  const value = argsObject(args)[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Tool argument must be an array of non-empty strings: ${key}`)
  }
  return value
}

function jsonContent(value: unknown): string {
  return JSON.stringify(value, null, 2)
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
  const targetPath = await resolveExistingWorkspacePath(context, requestedPath)
  const info = await stat(targetPath)
  if (!info.isFile()) {
    throw new Error(`Path is not a file: ${targetPath}`)
  }
  return targetPath
}

async function resolveExistingWorkspacePath(context: ToolExecutionContext, requestedPath: string): Promise<string> {
  const lexicalPath = lexicalWorkspacePath(context, requestedPath)
  const workspacePath = await realWorkspacePath(context)
  const targetPath = await realpath(lexicalPath)
  if (!isWithinWorkspace(workspacePath, targetPath)) {
    throw new Error(`Tool path is outside the selected workspace: ${requestedPath}`)
  }
  return targetPath
}

function toWorkspaceRelativePath(workspacePath: string, targetPath: string): string {
  const value = relative(workspacePath, targetPath).replace(/\\/g, '/')
  return value || '.'
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

type DirectoryEntryType = 'file' | 'directory'

type MetadataOptions = {
  includeSize: boolean
  includeCreatedAt: boolean
  includeModifiedAt: boolean
  includeOwner: boolean
}

type FileSystemEntryInfo = {
  name: string
  type: DirectoryEntryType
  path?: string
  size?: number
  createdAt?: string
  modifiedAt?: string
  owner?: { uid: number; gid: number }
}

function metadataOptions(args: unknown): MetadataOptions {
  return {
    includeSize: booleanArg(args, 'includeSize'),
    includeCreatedAt: booleanArg(args, 'includeCreatedAt'),
    includeModifiedAt: booleanArg(args, 'includeModifiedAt'),
    includeOwner: booleanArg(args, 'includeOwner')
  }
}

function entryTypeFromStats(info: Awaited<ReturnType<typeof lstat>>): DirectoryEntryType | undefined {
  if (info.isFile()) return 'file'
  if (info.isDirectory()) return 'directory'
  return undefined
}

function createEntryInfo(name: string, type: DirectoryEntryType, info: Awaited<ReturnType<typeof lstat>>, options: MetadataOptions, path?: string): FileSystemEntryInfo {
  return {
    name,
    type,
    ...(path !== undefined ? { path } : {}),
    ...(options.includeSize ? { size: type === 'directory' ? 0 : Number(info.size) } : {}),
    ...(options.includeCreatedAt ? { createdAt: info.birthtime.toISOString() } : {}),
    ...(options.includeModifiedAt ? { modifiedAt: info.mtime.toISOString() } : {}),
    ...(options.includeOwner ? { owner: { uid: Number(info.uid), gid: Number(info.gid) } } : {})
  }
}

async function deleteFile(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const filePath = await resolveExistingWorkspaceFile(context, stringArg(args, 'path'))
  await unlink(filePath)
  return {
    content: `Deleted file: ${filePath}`,
    details: { toolId: tool.id, path: filePath }
  }
}

async function deleteDirectory(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const directoryPath = await resolveExistingWorkspacePath(context, stringArg(args, 'path'))
  const workspacePath = await realWorkspacePath(context)
  if (directoryPath === workspacePath) {
    throw new Error('Refusing to delete the selected workspace root')
  }
  const info = await stat(directoryPath)
  if (!info.isDirectory()) {
    throw new Error(`Path is not a directory: ${directoryPath}`)
  }
  const recursive = booleanArg(args, 'recursive')
  await rm(directoryPath, { recursive, force: false })
  return {
    content: `Deleted directory${recursive ? ' recursively' : ''}: ${directoryPath}`,
    details: { toolId: tool.id, path: directoryPath, recursive }
  }
}

async function listDirectory(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const requestedPath = optionalStringArg(args, 'path', '.') ?? '.'
  const directoryPath = await resolveExistingWorkspacePath(context, requestedPath)
  const workspacePath = await realWorkspacePath(context)
  const info = await stat(directoryPath)
  if (!info.isDirectory()) {
    throw new Error(`Path is not a directory: ${directoryPath}`)
  }

  const options = metadataOptions(args)
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const items: FileSystemEntryInfo[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = resolve(directoryPath, entry.name)
    const entryInfo = await lstat(fullPath)
    const type = entryTypeFromStats(entryInfo)
    if (!type) continue
    items.push(createEntryInfo(entry.name, type, entryInfo, options))
  }

  const result = { path: toWorkspaceRelativePath(workspacePath, directoryPath), entries: items }
  return {
    content: jsonContent(result),
    details: { toolId: tool.id, ...result }
  }
}

async function walkWorkspaceDirectory(rootPath: string, options: { maxEntries?: number } = {}): Promise<{ path: string; info: Awaited<ReturnType<typeof lstat>>; type: DirectoryEntryType }[]> {
  const maxEntries = options.maxEntries ?? 10_000
  const results: { path: string; info: Awaited<ReturnType<typeof lstat>>; type: DirectoryEntryType }[] = []
  const stack = [rootPath]
  while (stack.length > 0 && results.length < maxEntries) {
    const directory = stack.pop()!
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
      if (results.length >= maxEntries) break
      const fullPath = resolve(directory, entry.name)
      const info = await lstat(fullPath)
      const type = entryTypeFromStats(info)
      if (!type) continue
      results.push({ path: fullPath, info, type })
      if (type === 'directory') stack.push(fullPath)
    }
  }
  return results
}

async function findFileSystemEntries(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const requestedPath = optionalStringArg(args, 'path', '.') ?? '.'
  const rootPath = await resolveExistingWorkspacePath(context, requestedPath)
  const workspacePath = await realWorkspacePath(context)
  const rootInfo = await stat(rootPath)
  if (!rootInfo.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootPath}`)
  }

  const flags = booleanArg(args, 'caseSensitive') ? '' : 'i'
  const pattern = new RegExp(stringArg(args, 'pattern'), flags)
  const options = metadataOptions(args)
  const maxResults = numberArg(args, 'maxResults', 200, { min: 1, max: 1000, integer: true })
  const walked = await walkWorkspaceDirectory(rootPath, { maxEntries: 25_000 })
  const matches = walked.flatMap((entry) => {
    const name = basename(entry.path)
    if (!pattern.test(name)) return []
    return [createEntryInfo(name, entry.type, entry.info, options, toWorkspaceRelativePath(workspacePath, entry.path))]
  }).slice(0, maxResults)
  const result = { path: toWorkspaceRelativePath(workspacePath, rootPath), pattern: stringArg(args, 'pattern'), matches, truncated: matches.length >= maxResults }
  return {
    content: jsonContent(result),
    details: { toolId: tool.id, ...result }
  }
}

type SearchCondition =
  | { all: SearchCondition[] }
  | { any: SearchCondition[] }
  | { not: SearchCondition }
  | { nameGlob: string }
  | { nameRegex: string }
  | { contentContains: string }
  | { contentRegex: string }

type SearchFileContext = {
  name: string
  relativePath: string
  lines?: string[]
  caseSensitive: boolean
}

type SearchLineMatch = {
  lineNumber: number
  line: string
  before: Array<{ lineNumber: number; line: string }>
  after: Array<{ lineNumber: number; line: string }>
}

function isSearchCondition(value: unknown): value is SearchCondition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Array.isArray(record.all)) return record.all.every(isSearchCondition)
  if (Array.isArray(record.any)) return record.any.every(isSearchCondition)
  if (record.not !== undefined) return isSearchCondition(record.not)
  return typeof record.nameGlob === 'string' || typeof record.nameRegex === 'string' || typeof record.contentContains === 'string' || typeof record.contentRegex === 'string'
}

function parseSearchCondition(args: unknown): SearchCondition {
  const condition = argsObject(args).condition
  if (!isSearchCondition(condition)) {
    throw new Error('Tool argument condition must be a valid search condition')
  }
  return condition
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

function globToRegExp(glob: string, caseSensitive: boolean): RegExp {
  const source = glob.split('').map((char) => {
    if (char === '*') return '.*'
    if (char === '?') return '.'
    return escapeRegExp(char)
  }).join('')
  return new RegExp(`^${source}$`, caseSensitive ? '' : 'i')
}

function normalizeForCase(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase()
}

function conditionNeedsContent(condition: SearchCondition): boolean {
  if ('contentContains' in condition || 'contentRegex' in condition) return true
  if ('all' in condition) return condition.all.some(conditionNeedsContent)
  if ('any' in condition) return condition.any.some(conditionNeedsContent)
  if ('not' in condition) return conditionNeedsContent(condition.not)
  return false
}

function findLineMatches(lines: string[], matcher: (line: string) => boolean): SearchLineMatch[] {
  const matches: SearchLineMatch[] = []
  for (const [index, line] of lines.entries()) {
    if (!matcher(line)) continue
    const start = Math.max(0, index - 2)
    const end = Math.min(lines.length - 1, index + 2)
    matches.push({
      lineNumber: index + 1,
      line,
      before: lines.slice(start, index).map((contextLine, offset) => ({ lineNumber: start + offset + 1, line: contextLine })),
      after: lines.slice(index + 1, end + 1).map((contextLine, offset) => ({ lineNumber: index + offset + 2, line: contextLine }))
    })
  }
  return matches
}

function evaluateSearchCondition(condition: SearchCondition, file: SearchFileContext): boolean {
  if ('all' in condition) return condition.all.every((child) => evaluateSearchCondition(child, file))
  if ('any' in condition) return condition.any.some((child) => evaluateSearchCondition(child, file))
  if ('not' in condition) return !evaluateSearchCondition(condition.not, file)
  if ('nameGlob' in condition) return globToRegExp(condition.nameGlob, file.caseSensitive).test(file.name)
  if ('nameRegex' in condition) return new RegExp(condition.nameRegex, file.caseSensitive ? '' : 'i').test(file.name)
  const lines = file.lines ?? []
  if ('contentContains' in condition) {
    const needle = normalizeForCase(condition.contentContains, file.caseSensitive)
    return lines.some((line) => normalizeForCase(line, file.caseSensitive).includes(needle))
  }
  return findLineMatches(lines, (line) => new RegExp(condition.contentRegex, file.caseSensitive ? '' : 'i').test(line)).length > 0
}

function collectPositiveContentMatches(condition: SearchCondition, file: SearchFileContext): SearchLineMatch[] {
  if ('all' in condition) return condition.all.flatMap((child) => collectPositiveContentMatches(child, file))
  if ('any' in condition) return condition.any.flatMap((child) => evaluateSearchCondition(child, file) ? collectPositiveContentMatches(child, file) : [])
  if ('not' in condition) return []
  const lines = file.lines ?? []
  if ('contentContains' in condition) {
    const needle = normalizeForCase(condition.contentContains, file.caseSensitive)
    return findLineMatches(lines, (line) => normalizeForCase(line, file.caseSensitive).includes(needle))
  }
  if ('contentRegex' in condition) {
    const regex = new RegExp(condition.contentRegex, file.caseSensitive ? '' : 'i')
    return findLineMatches(lines, (line) => regex.test(line))
  }
  return []
}

async function readLimitedUtf8File(filePath: string, maxBytes: number): Promise<{ lines: string[]; truncated: boolean }> {
  const info = await stat(filePath)
  const handle = await open(filePath, 'r')
  try {
    const readLimit = Math.min(info.size, maxBytes + 1)
    const buffer = Buffer.alloc(readLimit)
    const { bytesRead } = await handle.read(buffer, 0, readLimit, 0)
    const truncated = info.size > maxBytes || bytesRead > maxBytes
    const content = buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8')
    if (content.includes('\u0000')) return { lines: [], truncated }
    return { lines: content.split(/\r?\n/), truncated }
  } finally {
    await handle.close()
  }
}

async function searchFiles(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const requestedPath = optionalStringArg(args, 'path', '.') ?? '.'
  const rootPath = await resolveExistingWorkspacePath(context, requestedPath)
  const workspacePath = await realWorkspacePath(context)
  const rootInfo = await stat(rootPath)
  if (!rootInfo.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootPath}`)
  }

  const condition = parseSearchCondition(args)
  const needsContent = conditionNeedsContent(condition)
  const caseSensitive = booleanArg(args, 'caseSensitive')
  const maxResults = numberArg(args, 'maxResults', 50, { min: 1, max: 500, integer: true })
  const maxFileBytes = numberArg(args, 'maxFileBytes', defaultSearchMaxFileBytes, { min: 1, max: 1024 * 1024, integer: true })
  const walked = await walkWorkspaceDirectory(rootPath, { maxEntries: 25_000 })
  const results: Array<{ path: string; name: string; type: 'file'; matches: SearchLineMatch[]; truncated?: boolean }> = []
  for (const entry of walked) {
    if (results.length >= maxResults) break
    if (entry.type !== 'file') continue
    const relativePath = toWorkspaceRelativePath(workspacePath, entry.path)
    const fileContext: SearchFileContext = { name: basename(entry.path), relativePath, caseSensitive }
    let truncated = false
    if (needsContent) {
      const content = await readLimitedUtf8File(entry.path, maxFileBytes)
      fileContext.lines = content.lines
      truncated = content.truncated
    }
    if (!evaluateSearchCondition(condition, fileContext)) continue
    results.push({
      path: relativePath,
      name: basename(entry.path),
      type: 'file',
      matches: collectPositiveContentMatches(condition, fileContext),
      ...(truncated ? { truncated } : {})
    })
  }
  const result = { path: toWorkspaceRelativePath(workspacePath, rootPath), results, truncated: results.length >= maxResults }
  return {
    content: jsonContent(result),
    details: { toolId: tool.id, ...result }
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

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
  signal?: string
}

function commandErrorToResult(error: unknown): CommandResult {
  if (error && typeof error === 'object') {
    const record = error as { stdout?: unknown; stderr?: unknown; code?: unknown; signal?: unknown; message?: unknown }
    return {
      stdout: typeof record.stdout === 'string' ? record.stdout : '',
      stderr: typeof record.stderr === 'string' && record.stderr ? record.stderr : typeof record.message === 'string' ? record.message : String(error),
      exitCode: typeof record.code === 'number' ? record.code : 1,
      ...(typeof record.signal === 'string' ? { signal: record.signal } : {})
    }
  }
  return { stdout: '', stderr: String(error), exitCode: 1 }
}

async function execFileCommand(file: string, args: string[], options: { cwd?: string; timeoutMs: number; signal?: AbortSignal; maxBuffer?: number }): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, args, {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      ...(options.signal !== undefined ? { signal: options.signal } : {})
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    return commandErrorToResult(error)
  }
}

function formatCommandResult(command: string, result: CommandResult): string {
  const parts = [`Command: ${command}`, `Exit code: ${result.exitCode}`]
  if (result.signal) parts.push(`Signal: ${result.signal}`)
  if (result.stdout.trim()) parts.push(`\nstdout:\n${result.stdout}`)
  if (result.stderr.trim()) parts.push(`\nstderr:\n${result.stderr}`)
  return parts.join('\n')
}

function isRelativePathEscape(value: string): boolean {
  return value === '..' || value.startsWith('../') || value.startsWith('..\\')
}

async function validateGitArgumentPath(value: string, workspacePath: string): Promise<void> {
  if (isRelativePathEscape(value)) {
    throw new Error(`git.run path argument is outside the selected workspace: ${value}`)
  }
  if (!isAbsolute(value)) return

  const candidatePath = resolve(value)
  if (!isWithinWorkspace(workspacePath, candidatePath)) {
    throw new Error(`git.run path argument is outside the selected workspace: ${value}`)
  }

  try {
    const realCandidatePath = await realpath(candidatePath)
    if (!isWithinWorkspace(workspacePath, realCandidatePath)) {
      throw new Error(`git.run path argument is outside the selected workspace: ${value}`)
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
}

async function validateGitRunArgs(args: string[], workspacePath: string): Promise<void> {
  if (args[0]?.toLowerCase() === 'git') {
    throw new Error('Pass only arguments after git; do not include the git command itself')
  }

  const blockedArgs = new Set(['-c', '--git-dir', '--work-tree', '--exec-path', '--global', '--system', '--file', '-f', '--config-env'])
  for (const arg of args) {
    const lowerArg = arg.toLowerCase()
    if (blockedArgs.has(lowerArg) || lowerArg.startsWith('-c') || lowerArg.startsWith('--git-dir=') || lowerArg.startsWith('--work-tree=') || lowerArg.startsWith('--exec-path=') || lowerArg.startsWith('--config-env=')) {
      throw new Error(`git.run argument is not allowed: ${arg}`)
    }

    const optionValue = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : undefined
    for (const value of [arg, optionValue].filter((entry): entry is string => typeof entry === 'string' && entry !== '')) {
      await validateGitArgumentPath(value, workspacePath)
    }
  }
}

async function gitRun(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, defaultTimeoutMs: number): Promise<ToolExecutionResult> {
  const workspacePath = await realWorkspacePath(context)
  const gitArgs = stringArrayArg(args, 'args')
  await validateGitRunArgs(gitArgs, workspacePath)
  const timeoutMs = numberArg(args, 'timeoutMs', defaultTimeoutMs, { min: 1, max: 60_000, integer: true })
  const result = await execFileCommand('git', ['-C', workspacePath, ...gitArgs], { cwd: workspacePath, timeoutMs, ...(context.signal !== undefined ? { signal: context.signal } : {}) })
  return {
    content: formatCommandResult(`git ${gitArgs.join(' ')}`, result),
    details: { toolId: tool.id, workspacePath, args: gitArgs, ...result },
    isError: result.exitCode !== 0
  }
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function bashSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function shellCommandForWorkspace(workspacePath: string, command: string): { file: string; args: string[]; displayShell: string; displayCommand: string } {
  if (process.platform === 'win32') {
    const displayCommand = `Set-Location -LiteralPath ${powershellSingleQuoted(workspacePath)}; ${command}`
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', displayCommand],
      displayShell: 'PowerShell',
      displayCommand
    }
  }

  const displayCommand = `cd ${bashSingleQuoted(workspacePath)} && ${command}`
  return {
    file: 'bash',
    args: ['-lc', displayCommand],
    displayShell: 'bash',
    displayCommand
  }
}

async function executeCommand(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const workspacePath = await realWorkspacePath(context)
  const command = stringArg(args, 'command')
  if (command.includes('\0')) {
    throw new Error('Tool argument must not contain null bytes: command')
  }
  const timeoutMs = numberArg(args, 'timeoutMs', defaultCommandTimeoutMs, { min: 1, max: 120_000, integer: true })
  const shell = shellCommandForWorkspace(workspacePath, command)
  const result = await execFileCommand(shell.file, shell.args, { cwd: workspacePath, timeoutMs, ...(context.signal !== undefined ? { signal: context.signal } : {}), maxBuffer: 1024 * 1024 })
  return {
    content: formatCommandResult(command, result),
    details: { toolId: tool.id, workspacePath, platform: process.platform, shell: shell.displayShell, command, executedCommand: shell.displayCommand, ...result },
    isError: result.exitCode !== 0
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

function redactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join('[redacted]') : value
}

async function responseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function tinyFishSearch(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, fetchImpl: typeof fetch, readToolApiKey: ((toolId: string) => Promise<string | undefined>) | undefined, timeoutMs: number, now: () => string): Promise<ToolExecutionResult> {
  const apiKey = (await readToolApiKey?.(tool.id))?.trim()
  if (!apiKey) {
    throw new Error('TinyFish API key is required. Save an API key in Tools settings before enabling or using this tool.')
  }

  const query = stringArg(args, 'query')
  const url = new URL(tinyFishSearchEndpoint)
  url.searchParams.set('query', query)
  const location = optionalStringArg(args, 'location')
  if (location) url.searchParams.set('location', location)
  const language = optionalStringArg(args, 'language')
  if (language) url.searchParams.set('language', language)
  const page = numberArg(args, 'page', 0, { min: 0, max: 100, integer: true })
  if (page > 0) url.searchParams.set('page', String(page))
  const limit = numberArg(args, 'limit', 10, { min: 1, max: 20, integer: true })

  const childSignal = createChildSignal(context.signal, timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      signal: childSignal.signal
    })
    const text = await responseText(response)
    if (!response.ok) {
      throw new Error(`TinyFish Search API returned HTTP ${response.status}: ${redactSecret(text || response.statusText, apiKey)}`)
    }

    let payload: unknown
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new Error('TinyFish Search API returned a non-JSON response')
    }

    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawResults = Array.isArray(record.results) ? record.results : []
    const results = rawResults.slice(0, limit)
    const output = {
      query: typeof record.query === 'string' ? record.query : query,
      results,
      totalResults: typeof record.total_results === 'number' ? record.total_results : rawResults.length,
      page: typeof record.page === 'number' ? record.page : page,
      fetchedAt: now()
    }
    return {
      content: jsonContent(output),
      details: { toolId: tool.id, endpoint: tinyFishSearchEndpoint, query, resultCount: results.length, totalResults: output.totalResults, page: output.page, fetchedAt: output.fetchedAt }
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
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async execute(tool, args, context) {
      switch (tool.id) {
        case 'filesystem.read-file':
          return readTextFile(tool, args, context, maxReadBytes)
        case 'filesystem.write-file':
          return writeTextFile(tool, args, context)
        case 'filesystem.delete-file':
          return deleteFile(tool, args, context)
        case 'filesystem.delete-directory':
          return deleteDirectory(tool, args, context)
        case 'filesystem.list-directory':
          return listDirectory(tool, args, context)
        case 'filesystem.find':
          return findFileSystemEntries(tool, args, context)
        case 'filesystem.search':
          return searchFiles(tool, args, context)
        case 'git.status':
          return gitStatus(tool, context, runGitStatus, gitTimeoutMs)
        case 'git.run':
          return gitRun(tool, args, context, gitTimeoutMs)
        case 'web.fetch-url':
          return fetchUrl(tool, args, context, requestHttp, resolveHostname, maxFetchBytes, fetchTimeoutMs, now)
        case 'web.search':
          return tinyFishSearch(tool, args, context, fetchImpl, options.readToolApiKey, fetchTimeoutMs, now)
        case 'system.execute-command':
          return executeCommand(tool, args, context)
        case 'system.show-notification':
          return showNotification(tool, args, options.showNotification)
        case 'agent.spawn-worker-agent':
          // Legacy compatibility path: the tool is no longer exposed by default.
          return workerAgentNotImplemented(tool)
        default:
          throw new Error(`No builtin executor registered for tool: ${tool.id}`)
      }
    }
  }
}
