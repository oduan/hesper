import type { ModelRef, ToolDefinition } from '@hesper/shared'
import { execFile } from 'node:child_process'
import { lstat, mkdir, open, readFile, readdir, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { ToolExecutionContext, ToolExecutionResult, ToolExecutor } from './tool-runner'

const execFileAsync = promisify(execFile)

export type GitStatusOptions = {
  timeoutMs: number
  signal?: AbortSignal
}

type RoleToolInput = {
  id?: string
  name?: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
  defaultModelId?: string
  defaultModelRef?: ModelRef
}

type RoleToolRecord = {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultToolIds: string[]
  defaultModelId: string
  defaultModelRef?: ModelRef
}

export type RoleToolHandlers = {
  listRoles(): Promise<RoleToolRecord[]>
  createRole(input: Omit<RoleToolInput, 'id'> & { name: string }): Promise<unknown>
  updateRole(input: RoleToolInput & { id: string }): Promise<unknown>
}

export type WorkerAgentToolHandlers = {
  spawn(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  list(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  get(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  wait(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  cancel(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
}

export type SshToolHandlers = {
  listServers(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  runCommands(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  listExecutions(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
  getExecutionOutput(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>
}

export type ModelToolHandlers = {
  listAvailableModels(): Promise<unknown>
}

export type SleepOptions = {
  signal?: AbortSignal
}

export type BuiltinToolExecutorOptions = {
  maxReadBytes?: number
  gitTimeoutMs?: number
  fetchTimeoutMs?: number
  runGitStatus?: (workspacePath: string, options: GitStatusOptions) => Promise<string>
  readToolApiKey?: (toolId: string) => Promise<string | undefined>
  fetch?: typeof fetch
  showNotification?: (message: string) => Promise<void> | void
  roleTools?: RoleToolHandlers
  workerAgentTools?: WorkerAgentToolHandlers
  sshTools?: SshToolHandlers
  modelTools?: ModelToolHandlers
  now?: () => string
  sleep?: (durationMs: number, options?: SleepOptions) => Promise<void>
}

const defaultMaxReadBytes = 256 * 1024
const defaultGitTimeoutMs = 10_000
const defaultCommandTimeoutMs = 30_000
const defaultFetchTimeoutMs = 15_000
const defaultTinyFishFetchPerUrlTimeoutMs = 45_000
const defaultSearchMaxFileBytes = 256 * 1024
const tinyFishFetchEndpoint = 'https://api.fetch.tinyfish.ai'
const tinyFishSearchEndpoint = 'https://api.search.tinyfish.ai'
const maxTimerMs = 2_147_483_647

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

function requiredNumberArg(args: unknown, key: string, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  const value = argsObject(args)[key]
  if (value === undefined) throw new Error(`Tool argument is required: ${key}`)
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

function optionalStringArrayArg(args: unknown, key: string): string[] | undefined {
  const value = argsObject(args)[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Tool argument must be an array of non-empty strings: ${key}`)
  }
  return value
}

function jsonContent(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function optionalRoleStringArg(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Tool argument must be a string: ${key}`)
  return value
}

function optionalDefaultModelRefArg(record: Record<string, unknown>): ModelRef | undefined {
  const value = record.defaultModelRef
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool argument must be an object: defaultModelRef')
  }

  const modelRef = value as Record<string, unknown>
  if (typeof modelRef.providerId !== 'string' || modelRef.providerId.trim() === '') {
    throw new Error('Tool argument defaultModelRef.providerId must be a non-empty string')
  }
  if (typeof modelRef.modelId !== 'string' || modelRef.modelId.trim() === '') {
    throw new Error('Tool argument defaultModelRef.modelId must be a non-empty string')
  }

  return { providerId: modelRef.providerId, modelId: modelRef.modelId }
}

function createRoleToolInput(args: unknown): Omit<RoleToolInput, 'id'> & { name: string } {
  const record = argsObject(args)
  const description = optionalRoleStringArg(record, 'description')
  const systemPrompt = optionalRoleStringArg(record, 'systemPrompt')
  const defaultToolIds = optionalStringArrayArg(args, 'defaultToolIds')
  const defaultModelId = optionalRoleStringArg(record, 'defaultModelId')
  const defaultModelRef = optionalDefaultModelRefArg(record)
  return {
    name: stringArg(args, 'name'),
    ...(description !== undefined ? { description } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(defaultToolIds !== undefined ? { defaultToolIds } : {}),
    ...(defaultModelId !== undefined ? { defaultModelId } : {}),
    ...(defaultModelRef !== undefined ? { defaultModelRef } : {})
  }
}

function updateRoleToolInput(args: unknown): RoleToolInput & { id: string } {
  const record = argsObject(args)
  const name = optionalRoleStringArg(record, 'name')
  const description = optionalRoleStringArg(record, 'description')
  const systemPrompt = optionalRoleStringArg(record, 'systemPrompt')
  const defaultToolIds = optionalStringArrayArg(args, 'defaultToolIds')
  const defaultModelId = optionalRoleStringArg(record, 'defaultModelId')
  const defaultModelRef = optionalDefaultModelRefArg(record)
  return {
    id: stringArg(args, 'id'),
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(defaultToolIds !== undefined ? { defaultToolIds } : {}),
    ...(defaultModelId !== undefined ? { defaultModelId } : {}),
    ...(defaultModelRef !== undefined ? { defaultModelRef } : {})
  }
}

function roleFindInput(args: unknown): { query: string; limit: number } {
  return {
    query: stringArg(args, 'query').trim(),
    limit: numberArg(args, 'limit', 20, { min: 1, max: 100, integer: true })
  }
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase()
}

function roleMatchesQuery(role: RoleToolRecord, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query)
  const haystacks = [role.id, role.name, role.description, role.systemPrompt, ...role.defaultToolIds]
  return haystacks.some((value) => normalizeSearchText(value).includes(normalizedQuery))
}

function roleToolsUnavailable(tool: ToolDefinition): ToolExecutionResult {
  return {
    content: 'Role management tools are not available in this runtime.',
    details: { code: 'not_available', toolId: tool.id },
    isError: true
  }
}

async function listRolesTool(tool: ToolDefinition, roleTools: RoleToolHandlers | undefined): Promise<ToolExecutionResult> {
  if (!roleTools) return roleToolsUnavailable(tool)
  const roles = await roleTools.listRoles()
  return { content: jsonContent(roles), details: { toolId: tool.id, roles, count: roles.length } }
}

async function findRolesTool(tool: ToolDefinition, args: unknown, roleTools: RoleToolHandlers | undefined): Promise<ToolExecutionResult> {
  if (!roleTools) return roleToolsUnavailable(tool)
  const { query, limit } = roleFindInput(args)
  const roles = await roleTools.listRoles()
  const matches = roles.filter((role) => roleMatchesQuery(role, query)).slice(0, limit)
  return { content: jsonContent(matches), details: { toolId: tool.id, query, roles: matches, count: matches.length } }
}

async function createRoleTool(tool: ToolDefinition, args: unknown, roleTools: RoleToolHandlers | undefined): Promise<ToolExecutionResult> {
  if (!roleTools) return roleToolsUnavailable(tool)
  const role = await roleTools.createRole(createRoleToolInput(args))
  return { content: jsonContent(role), details: { toolId: tool.id, role } }
}

async function updateRoleTool(tool: ToolDefinition, args: unknown, roleTools: RoleToolHandlers | undefined): Promise<ToolExecutionResult> {
  if (!roleTools) return roleToolsUnavailable(tool)
  const role = await roleTools.updateRole(updateRoleToolInput(args))
  return { content: jsonContent(role), details: { toolId: tool.id, role } }
}

function workerAgentToolsUnavailable(tool: ToolDefinition): ToolExecutionResult {
  return {
    content: 'Worker Agent tools are not available in this runtime.',
    details: { code: 'not_available', toolId: tool.id },
    isError: true
  }
}

async function runWorkerAgentTool(
  tool: ToolDefinition,
  args: unknown,
  context: ToolExecutionContext,
  handlers: WorkerAgentToolHandlers | undefined,
  method: keyof WorkerAgentToolHandlers
): Promise<ToolExecutionResult> {
  if (!handlers) return workerAgentToolsUnavailable(tool)
  const input = argsObject(args)
  const result = await handlers[method](input, context)
  const details = { toolId: tool.id, workerAgent: result }
  return { content: jsonContent(result), details }
}

function sshToolsUnavailable(tool: ToolDefinition): ToolExecutionResult {
  return {
    content: 'SSH tools are not available in this runtime.',
    details: { code: 'not_available', toolId: tool.id },
    isError: true
  }
}

function modelToolsUnavailable(tool: ToolDefinition): ToolExecutionResult {
  return {
    content: 'Model listing tools are not available in this runtime.',
    details: { code: 'not_available', toolId: tool.id },
    isError: true
  }
}

async function runSshTool(
  tool: ToolDefinition,
  args: unknown,
  context: ToolExecutionContext,
  handlers: SshToolHandlers | undefined,
  method: keyof SshToolHandlers
): Promise<ToolExecutionResult> {
  if (!handlers) return sshToolsUnavailable(tool)
  const input = argsObject(args)
  const result = await handlers[method](input, context)
  const details = { toolId: tool.id, ssh: result }
  return { content: jsonContent(result), details }
}

async function listAvailableModelsTool(tool: ToolDefinition, modelTools: ModelToolHandlers | undefined): Promise<ToolExecutionResult> {
  if (!modelTools) return modelToolsUnavailable(tool)
  const catalog = await modelTools.listAvailableModels()
  return { content: jsonContent(catalog), details: { toolId: tool.id, catalog } }
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

type LineEdit = {
  startLine: number
  endLine: number
  content: string
}

function integerLineArg(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Tool argument ${key} must be an integer`)
  }
  if (value < 1) {
    throw new Error(`Tool argument ${key} must be >= 1`)
  }
  return value
}

function lineEditsArg(args: unknown): LineEdit[] {
  const value = argsObject(args).edits
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Tool argument edits must be a non-empty array')
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Tool argument edits[${index}] must be an object`)
    }
    const record = entry as Record<string, unknown>
    const startLine = integerLineArg(record.startLine, `edits[${index}].startLine`)
    const endLine = record.endLine === undefined ? startLine : integerLineArg(record.endLine, `edits[${index}].endLine`)
    if (endLine < startLine) {
      throw new Error(`Tool argument edits[${index}].endLine must be >= startLine`)
    }
    if (typeof record.content !== 'string') {
      throw new Error(`Tool argument edits[${index}].content must be a string`)
    }
    return { startLine, endLine, content: record.content }
  })
}

function splitEditableLines(content: string): { lines: string[]; newline: string; hasFinalNewline: boolean } {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const hasFinalNewline = content.endsWith('\n')
  if (content === '') return { lines: [], newline, hasFinalNewline: false }
  const lines = content.split(/\r\n|\n/)
  if (hasFinalNewline) lines.pop()
  return { lines, newline, hasFinalNewline }
}

function replacementLines(content: string): string[] {
  if (content === '') return []
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) lines.pop()
  return lines
}

function validateLineEdits(edits: LineEdit[], lineCount: number): LineEdit[] {
  const sorted = [...edits].sort((left, right) => left.startLine - right.startLine)
  for (const [index, edit] of sorted.entries()) {
    if (edit.endLine > lineCount) {
      throw new Error(`Line edit range ${edit.startLine}-${edit.endLine} is outside the file; file has ${lineCount} line${lineCount === 1 ? '' : 's'}`)
    }
    const previous = sorted[index - 1]
    if (previous && edit.startLine <= previous.endLine) {
      throw new Error(`Line edit ranges must not overlap: ${previous.startLine}-${previous.endLine} overlaps ${edit.startLine}-${edit.endLine}`)
    }
  }
  return sorted
}

async function editTextFile(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const filePath = await resolveExistingWorkspaceFile(context, stringArg(args, 'path'))
  const edits = lineEditsArg(args)
  const originalContent = await readFile(filePath, 'utf8')
  const editable = splitEditableLines(originalContent)
  const linesBefore = editable.lines.length
  const sortedEdits = validateLineEdits(edits, linesBefore)

  for (const edit of [...sortedEdits].reverse()) {
    editable.lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...replacementLines(edit.content))
  }

  const nextContent = `${editable.lines.join(editable.newline)}${editable.hasFinalNewline && editable.lines.length > 0 ? editable.newline : ''}`
  await writeFile(filePath, nextContent, 'utf8')
  const bytes = Buffer.byteLength(nextContent, 'utf8')
  return {
    content: `Edited ${edits.length} line range${edits.length === 1 ? '' : 's'} in ${filePath}`,
    details: { toolId: tool.id, path: filePath, edits: edits.length, linesBefore, linesAfter: editable.lines.length, bytes }
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


function enumStringArg(args: unknown, key: string, fallback: string, allowed: readonly string[]): string {
  const value = optionalStringArg(args, key, fallback) ?? fallback
  if (!allowed.includes(value)) {
    throw new Error(`Tool argument ${key} must be one of: ${allowed.join(', ')}`)
  }
  return value
}

async function readRequiredToolApiKey(tool: ToolDefinition, readToolApiKey: ((toolId: string) => Promise<string | undefined>) | undefined): Promise<string> {
  const apiKey = (await readToolApiKey?.(tool.id))?.trim()
  if (!apiKey) {
    throw new Error('TinyFish API key is required. Save an API key in Tools settings before enabling or using this tool.')
  }
  return apiKey
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

function parseJsonResponse(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${label} returned a non-JSON response`)
  }
}

function responseRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}

function tinyFishContentText(value: unknown): string {
  if (typeof value === 'string') return value
  return jsonContent(value ?? {})
}

async function tinyFishFetchUrl(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, fetchImpl: typeof fetch, readToolApiKey: ((toolId: string) => Promise<string | undefined>) | undefined, now: () => string): Promise<ToolExecutionResult> {
  const rawUrl = stringArg(args, 'url')
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }

  const apiKey = await readRequiredToolApiKey(tool, readToolApiKey)
  const format = enumStringArg(args, 'format', 'markdown', ['markdown', 'html', 'json'])
  const links = booleanArg(args, 'links')
  const imageLinks = booleanArg(args, 'imageLinks')
  const perUrlTimeoutMs = numberArg(args, 'perUrlTimeoutMs', defaultTinyFishFetchPerUrlTimeoutMs, { min: 1, max: 110_000, integer: true })
  const ttlValue = argsObject(args).ttl
  const body: Record<string, unknown> = {
    urls: [parsed.toString()],
    format,
    links,
    image_links: imageLinks,
    per_url_timeout_ms: perUrlTimeoutMs
  }
  if (ttlValue !== undefined) {
    body.ttl = numberArg(args, 'ttl', 0, { min: 0, integer: true })
  }

  const clientTimeoutMs = Math.min(perUrlTimeoutMs + 40_000, 150_000)
  const childSignal = createChildSignal(context.signal, clientTimeoutMs)
  try {
    const response = await fetchImpl(tinyFishFetchEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
      signal: childSignal.signal
    })
    const text = await responseText(response)
    if (!response.ok) {
      throw new Error(`TinyFish Fetch API returned HTTP ${response.status}: ${redactSecret(text || response.statusText, apiKey)}`)
    }

    const payload = responseRecord(parseJsonResponse(text, 'TinyFish Fetch API'))
    const results = Array.isArray(payload.results) ? payload.results : []
    const errors = Array.isArray(payload.errors) ? payload.errors : []
    const firstResult = responseRecord(results[0])
    if (!results.length) {
      throw new Error(`TinyFish Fetch API did not return extracted content: ${redactSecret(jsonContent({ errors }), apiKey)}`)
    }

    const extractedText = tinyFishContentText(firstResult.text)
    const fetchedAt = now()
    return {
      content: extractedText,
      details: {
        toolId: tool.id,
        endpoint: tinyFishFetchEndpoint,
        url: firstResult.url ?? parsed.toString(),
        finalUrl: firstResult.final_url,
        title: firstResult.title,
        description: firstResult.description,
        language: firstResult.language,
        author: firstResult.author,
        publishedDate: firstResult.published_date,
        format: firstResult.format ?? format,
        links: firstResult.links,
        imageLinks: firstResult.image_links,
        latencyMs: firstResult.latency_ms,
        errors,
        fetchedAt
      }
    }
  } finally {
    childSignal.dispose()
  }
}

async function tinyFishSearch(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, fetchImpl: typeof fetch, readToolApiKey: ((toolId: string) => Promise<string | undefined>) | undefined, timeoutMs: number, now: () => string): Promise<ToolExecutionResult> {
  const apiKey = await readRequiredToolApiKey(tool, readToolApiKey)

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

    const record = responseRecord(parseJsonResponse(text, 'TinyFish Search API'))
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

function padDatePart(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  return `${sign}${padDatePart(hours)}:${padDatePart(minutes)}`
}

function formatLocalIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  return [
    `${padDatePart(date.getFullYear(), 4)}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
    `T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}.${padDatePart(date.getMilliseconds(), 3)}`,
    formatUtcOffset(offsetMinutes)
  ].join('')
}

function createDateFromNow(now: () => string): Date {
  const value = now()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Current time provider returned an invalid timestamp: ${value}`)
  return date
}

function timezoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
}

async function defaultSleep(durationMs: number, options: SleepOptions = {}): Promise<void> {
  let remainingMs = Math.max(0, Math.ceil(durationMs))
  while (remainingMs > 0) {
    if (options.signal?.aborted) throw new Error('Tool execution was aborted')
    const chunkMs = Math.min(remainingMs, maxTimerMs)
    await new Promise<void>((resolvePromise, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      let abort: (() => void) | undefined
      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        if (abort) options.signal?.removeEventListener('abort', abort)
      }
      abort = () => {
        cleanup()
        reject(new Error('Tool execution was aborted'))
      }
      timeout = setTimeout(() => {
        cleanup()
        resolvePromise()
      }, chunkMs)
      options.signal?.addEventListener('abort', abort, { once: true })
    })
    remainingMs -= chunkMs
  }
}

function currentTimeTool(tool: ToolDefinition, now: () => string): ToolExecutionResult {
  const date = createDateFromNow(now)
  const utcOffsetMinutes = -date.getTimezoneOffset()
  const output = {
    now: date.toISOString(),
    localTime: formatLocalIsoWithOffset(date),
    timezone: timezoneName(),
    utcOffset: formatUtcOffset(utcOffsetMinutes),
    utcOffsetMinutes
  }
  return { content: jsonContent(output), details: { toolId: tool.id, ...output } }
}

function sleepOptions(context: ToolExecutionContext): SleepOptions {
  return context.signal ? { signal: context.signal } : {}
}

async function sleepTool(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, now: () => string, sleep: (durationMs: number, options?: SleepOptions) => Promise<void>): Promise<ToolExecutionResult> {
  const seconds = requiredNumberArg(args, 'seconds', { min: 0 })
  const durationMs = Math.ceil(seconds * 1000)
  const startedAt = createDateFromNow(now).toISOString()
  await sleep(durationMs, sleepOptions(context))
  const wokeAt = createDateFromNow(now).toISOString()
  const output = { status: 'completed', seconds, durationMs, startedAt, wokeAt }
  return { content: jsonContent(output), details: { toolId: tool.id, ...output } }
}

async function waitUntilTool(tool: ToolDefinition, args: unknown, context: ToolExecutionContext, now: () => string, sleep: (durationMs: number, options?: SleepOptions) => Promise<void>): Promise<ToolExecutionResult> {
  const wakeAt = stringArg(args, 'wakeAt')
  const target = new Date(wakeAt)
  if (Number.isNaN(target.getTime())) throw new Error(`Tool argument wakeAt must be a valid timestamp: ${wakeAt}`)
  const startedDate = createDateFromNow(now)
  const waitMs = Math.max(0, target.getTime() - startedDate.getTime())
  await sleep(waitMs, sleepOptions(context))
  const wokeAt = createDateFromNow(now).toISOString()
  const output = {
    status: 'completed',
    wakeAt,
    targetTime: target.toISOString(),
    waitedMs: waitMs,
    startedAt: startedDate.toISOString(),
    wokeAt
  }
  return { content: jsonContent(output), details: { toolId: tool.id, ...output } }
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

export function createBuiltinToolExecutor(options: BuiltinToolExecutorOptions = {}): ToolExecutor {
  const maxReadBytes = options.maxReadBytes ?? defaultMaxReadBytes
  const gitTimeoutMs = options.gitTimeoutMs ?? defaultGitTimeoutMs
  const fetchTimeoutMs = options.fetchTimeoutMs ?? defaultFetchTimeoutMs
  const runGitStatus = options.runGitStatus ?? defaultRunGitStatus
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date().toISOString())
  const sleep = options.sleep ?? defaultSleep

  return {
    async execute(tool, args, context) {
      switch (tool.id) {
        case 'filesystem.read-file':
          return readTextFile(tool, args, context, maxReadBytes)
        case 'filesystem.write-file':
          return writeTextFile(tool, args, context)
        case 'filesystem.edit-file':
          return editTextFile(tool, args, context)
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
          return tinyFishFetchUrl(tool, args, context, fetchImpl, options.readToolApiKey, now)
        case 'web.search':
          return tinyFishSearch(tool, args, context, fetchImpl, options.readToolApiKey, fetchTimeoutMs, now)
        case 'roles.list':
          return listRolesTool(tool, options.roleTools)
        case 'roles.find':
          return findRolesTool(tool, args, options.roleTools)
        case 'roles.create':
          return createRoleTool(tool, args, options.roleTools)
        case 'roles.update':
          return updateRoleTool(tool, args, options.roleTools)
        case 'models.list-available':
          return listAvailableModelsTool(tool, options.modelTools)
        case 'ssh.list-servers':
          return runSshTool(tool, args, context, options.sshTools, 'listServers')
        case 'ssh.run-commands':
          return runSshTool(tool, args, context, options.sshTools, 'runCommands')
        case 'ssh.list-executions':
          return runSshTool(tool, args, context, options.sshTools, 'listExecutions')
        case 'ssh.get-execution-output':
          return runSshTool(tool, args, context, options.sshTools, 'getExecutionOutput')
        case 'time.current':
          return currentTimeTool(tool, now)
        case 'time.sleep':
          return sleepTool(tool, args, context, now, sleep)
        case 'time.wait-until':
          return waitUntilTool(tool, args, context, now, sleep)
        case 'system.execute-command':
          return executeCommand(tool, args, context)
        case 'system.show-notification':
          return showNotification(tool, args, options.showNotification)
        case 'agent.spawn-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'spawn')
        case 'agent.list-worker-agents':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'list')
        case 'agent.get-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'get')
        case 'agent.wait-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'wait')
        case 'agent.cancel-worker-agent':
          return runWorkerAgentTool(tool, args, context, options.workerAgentTools, 'cancel')
        default:
          throw new Error(`No builtin executor registered for tool: ${tool.id}`)
      }
    }
  }
}
