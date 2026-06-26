import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import type {
  GitActionResultDto,
  GitCheckoutInput,
  GitCommitDetailDto,
  GitCommitFileChangeDto,
  GitCommitInput,
  GitCreateBranchInput,
  GitCreateTagInput,
  GitGraphRowDto,
  GitLogInput,
  GitLogResultDto,
  GitRefDto,
  GitRepositoryStateDto,
  GitSessionInput
} from './ipc-contract'

const execFileAsync = promisify(execFile)
const DEFAULT_LOG_LIMIT = 100
const FIELD_SEPARATOR = '\x00'
const RECORD_SEPARATOR = '\x1e'

type SessionWithWorkspace = {
  id: string
  workspacePath?: string
}

type SessionServiceLike = {
  getSession(id: string): SessionWithWorkspace | undefined | Promise<SessionWithWorkspace | undefined>
}

type GitServiceOptions = {
  sessionService: SessionServiceLike
}

type GitCommandError = Error & {
  stdout?: string | Buffer
  stderr?: string | Buffer
}

type ResolvedWorkspace = {
  sessionId: string
  workspacePath?: string
}

type RequiredWorkspace = {
  sessionId: string
  workspacePath: string
}

export class GitService {
  private readonly sessionService: SessionServiceLike

  constructor(options: GitServiceOptions) {
    this.sessionService = options.sessionService
  }

  async getState(input: GitSessionInput): Promise<GitRepositoryStateDto> {
    const workspace = await this.resolveWorkspace(input.sessionId)
    const baseState = this.createNonRepositoryState(workspace)

    if (!workspace.workspacePath || !(await isExistingDirectory(workspace.workspacePath))) {
      return baseState
    }

    if (!(await this.isGitRepository(workspace.workspacePath))) {
      return baseState
    }

    const [currentBranch, headCommit, statusOutput, refs] = await Promise.all([
      this.optionalGit(workspace.workspacePath, ['branch', '--show-current']),
      this.optionalGit(workspace.workspacePath, ['rev-parse', 'HEAD']),
      this.git(workspace.workspacePath, ['status', '--porcelain=v1']),
      this.listRepositoryRefs(workspace.workspacePath)
    ])

    const changedFiles = countChangedFiles(statusOutput.stdout)
    const state: GitRepositoryStateDto = {
      sessionId: input.sessionId,
      workspacePath: workspace.workspacePath,
      isGitRepository: true,
      ...(currentBranch.stdout.trim() ? { currentBranch: currentBranch.stdout.trim() } : {}),
      ...(headCommit.stdout.trim() ? { headCommit: headCommit.stdout.trim() } : {}),
      dirty: changedFiles > 0,
      changedFiles,
      refs
    }

    if (state.headCommit && !state.refs.some((ref) => ref.type === 'head')) {
      state.refs.unshift({ name: 'HEAD', shortName: 'HEAD', type: 'head', targetCommit: state.headCommit })
    }

    return state
  }

  async listLog(input: GitLogInput): Promise<GitLogResultDto> {
    const { workspacePath } = await this.requireRepository(input.sessionId)
    const limit = input.limit ?? DEFAULT_LOG_LIMIT
    const requestedCount = limit + 1
    const output = await this.git(workspacePath, [
      'log',
      `--max-count=${requestedCount}`,
      '--date=iso-strict',
      '--decorate=full',
      `--pretty=format:%H%x00%h%x00%P%x00%s%x00%an%x00%ae%x00%aI%x00%D%x1e`
    ])
    const allRows = parseLogRows(output.stdout)
    return {
      rows: allRows.slice(0, limit),
      limit,
      hasMore: allRows.length > limit
    }
  }

  async getCommit(input: GitCommitInput): Promise<GitCommitDetailDto> {
    validateRevision(input.commit, 'commit')
    const { workspacePath } = await this.requireRepository(input.sessionId)
    const details = await this.git(workspacePath, [
      'show',
      '-s',
      '--date=iso-strict',
      `--format=%H%x00%h%x00%P%x00%s%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B`,
      input.commit
    ])
    const fields = details.stdout.split(FIELD_SEPARATOR)
    if (fields.length < 11) {
      throw new Error(`Unable to parse Git commit details for: ${input.commit}`)
    }

    const commitHash = fields[0]!.trim()
    const files = await this.listCommitFiles(workspacePath, input.commit)
    const refs = await this.listRefsPointingAt(workspacePath, commitHash)

    return {
      commitHash,
      shortHash: fields[1]!.trim(),
      parents: splitParents(fields[2] ?? ''),
      subject: fields[3] ?? '',
      body: fields.slice(10).join(FIELD_SEPARATOR).trimEnd(),
      authorName: fields[4] ?? '',
      authorEmail: fields[5] ?? '',
      authoredAt: toIsoString(fields[6] ?? ''),
      committerName: fields[7] ?? '',
      committerEmail: fields[8] ?? '',
      committedAt: toIsoString(fields[9] ?? ''),
      refs,
      files
    }
  }

  async createBranch(input: GitCreateBranchInput): Promise<GitActionResultDto> {
    validateRefName(input.branchName, 'branch name')
    validateRevision(input.commit, 'commit')
    const { workspacePath } = await this.requireRepository(input.sessionId)

    if (input.checkout === true) {
      await this.git(workspacePath, ['switch', '-c', input.branchName, input.commit])
      return {
        success: true,
        message: `Created and checked out branch ${input.branchName}`,
        state: await this.getState({ sessionId: input.sessionId })
      }
    }

    await this.git(workspacePath, ['branch', input.branchName, input.commit])
    return {
      success: true,
      message: `Created branch ${input.branchName}`,
      state: await this.getState({ sessionId: input.sessionId })
    }
  }

  async createTag(input: GitCreateTagInput): Promise<GitActionResultDto> {
    validateRefName(input.tagName, 'tag name')
    validateRevision(input.commit, 'commit')
    const { workspacePath } = await this.requireRepository(input.sessionId)

    await this.git(workspacePath, ['tag', input.tagName, input.commit])
    return {
      success: true,
      message: `Created tag ${input.tagName}`,
      state: await this.getState({ sessionId: input.sessionId })
    }
  }

  async checkout(input: GitCheckoutInput): Promise<GitActionResultDto> {
    validateRevision(input.ref, 'ref')
    const { workspacePath } = await this.requireRepository(input.sessionId)
    const state = await this.getState({ sessionId: input.sessionId })
    if (state.dirty) {
      throw new Error('Cannot checkout ref with a dirty workspace. Commit, stash, or discard changes first.')
    }

    await this.git(workspacePath, ['switch', input.ref])
    return {
      success: true,
      message: `Checked out ${input.ref}`,
      state: await this.getState({ sessionId: input.sessionId })
    }
  }

  private async resolveWorkspace(sessionId: string): Promise<ResolvedWorkspace> {
    const session = await this.sessionService.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return {
      sessionId,
      ...(session.workspacePath ? { workspacePath: session.workspacePath } : {})
    }
  }

  private async requireRepository(sessionId: string): Promise<RequiredWorkspace> {
    const workspace = await this.resolveWorkspace(sessionId)
    if (!workspace.workspacePath) {
      throw new Error(`Session has no workspacePath: ${sessionId}`)
    }
    if (!(await isExistingDirectory(workspace.workspacePath))) {
      throw new Error(`Workspace path does not exist or is not a directory: ${workspace.workspacePath}`)
    }
    if (!(await this.isGitRepository(workspace.workspacePath))) {
      throw new Error(`Workspace is not a Git repository: ${workspace.workspacePath}`)
    }
    return { sessionId, workspacePath: workspace.workspacePath }
  }

  private createNonRepositoryState(workspace: ResolvedWorkspace): GitRepositoryStateDto {
    return {
      sessionId: workspace.sessionId,
      ...(workspace.workspacePath ? { workspacePath: workspace.workspacePath } : {}),
      isGitRepository: false,
      dirty: false,
      changedFiles: 0,
      refs: []
    }
  }

  private async isGitRepository(workspacePath: string): Promise<boolean> {
    try {
      const result = await this.git(workspacePath, ['rev-parse', '--is-inside-work-tree'])
      return result.stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  private async listRepositoryRefs(workspacePath: string): Promise<GitRefDto[]> {
    const refsOutput = await this.optionalGit(workspacePath, [
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)%00%(objectname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ])
    const refs = parseForEachRefs(refsOutput.stdout)
    const headCommit = (await this.optionalGit(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()
    if (headCommit) {
      refs.unshift({ name: 'HEAD', shortName: 'HEAD', type: 'head', targetCommit: headCommit })
    }
    return refs
  }

  private async listRefsPointingAt(workspacePath: string, commit: string): Promise<GitRefDto[]> {
    const refsOutput = await this.optionalGit(workspacePath, [
      'for-each-ref',
      '--points-at',
      commit,
      '--format=%(refname)%00%(refname:short)%00%(objectname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ])
    const refs = parseForEachRefs(refsOutput.stdout)
    const headCommit = (await this.optionalGit(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()
    if (headCommit === commit) {
      refs.unshift({ name: 'HEAD', shortName: 'HEAD', type: 'head', targetCommit: commit })
    }
    return refs
  }

  private async listCommitFiles(workspacePath: string, commit: string): Promise<GitCommitFileChangeDto[]> {
    const [statusOutput, numstatOutput] = await Promise.all([
      this.git(workspacePath, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-M', '-C', commit]),
      this.git(workspacePath, ['show', '--format=', '--numstat', '-M', '-C', commit])
    ])
    const stats = parseNumstat(numstatOutput.stdout)
    return parseNameStatus(statusOutput.stdout).map((change) => ({
      ...change,
      ...stats.get(change.path)
    }))
  }

  private async git(workspacePath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync('git', ['-C', workspacePath, ...args], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      })
      return { stdout: result.stdout, stderr: result.stderr }
    } catch (error) {
      const gitError = error as GitCommandError
      const stderr = bufferToString(gitError.stderr).trim()
      const stdout = bufferToString(gitError.stdout).trim()
      const detail = stderr || stdout || gitError.message
      throw new Error(`Git command failed: git -C <workspace> ${args.join(' ')}${detail ? `: ${detail}` : ''}`)
    }
  }

  private async optionalGit(workspacePath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.git(workspacePath, args)
    } catch {
      return { stdout: '', stderr: '' }
    }
  }
}

async function isExistingDirectory(workspacePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(workspacePath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function bufferToString(value: string | Buffer | undefined): string {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return ''
}

function countChangedFiles(statusOutput: string): number {
  return statusOutput.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

function parseLogRows(output: string): GitGraphRowDto[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const fields = record.split(FIELD_SEPARATOR)
      const commitHash = fields[0]!.trim()
      return {
        commitHash,
        shortHash: fields[1]!.trim(),
        parents: splitParents(fields[2] ?? ''),
        subject: fields[3] ?? '',
        authorName: fields[4] ?? '',
        authorEmail: fields[5] ?? '',
        authoredAt: toIsoString(fields[6] ?? ''),
        refs: parseDecorations(fields[7] ?? '', commitHash),
        graph: {
          lanes: [{ id: 'lane-0', color: '#7c3aed', active: true }],
          nodeLaneId: 'lane-0',
          edges: []
        }
      }
    })
}

function splitParents(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean)
}

function toIsoString(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Git datetime: ${value}`)
  }
  return date.toISOString()
}

function parseForEachRefs(output: string): GitRefDto[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', shortName = '', targetCommit = ''] = line.split(FIELD_SEPARATOR)
      return toGitRef(name, shortName, targetCommit)
    })
    .filter((ref): ref is GitRefDto => ref !== undefined)
}

function parseDecorations(value: string, targetCommit: string): GitRefDto[] {
  const refs: GitRefDto[] = []
  for (const rawToken of value.split(',')) {
    const token = rawToken.trim()
    if (!token) continue
    if (token.startsWith('HEAD -> ')) {
      refs.push({ name: 'HEAD', shortName: 'HEAD', type: 'head', targetCommit })
      const pointedRef = token.slice('HEAD -> '.length).trim()
      const ref = refFromDecoratedName(pointedRef, targetCommit)
      if (ref) refs.push(ref)
      continue
    }
    const normalizedToken = token.startsWith('tag: ') ? token.slice('tag: '.length).trim() : token
    const ref = normalizedToken === 'HEAD'
      ? { name: 'HEAD', shortName: 'HEAD', type: 'head' as const, targetCommit }
      : refFromDecoratedName(normalizedToken, targetCommit)
    if (ref) refs.push(ref)
  }
  return dedupeRefs(refs)
}

function refFromDecoratedName(name: string, targetCommit: string): GitRefDto | undefined {
  if (name.startsWith('refs/heads/')) {
    return { name, shortName: name.slice('refs/heads/'.length), type: 'local-branch', targetCommit }
  }
  if (name.startsWith('refs/remotes/')) {
    return { name, shortName: name.slice('refs/remotes/'.length), type: 'remote-branch', targetCommit }
  }
  if (name.startsWith('refs/tags/')) {
    return { name, shortName: name.slice('refs/tags/'.length), type: 'tag', targetCommit }
  }
  return undefined
}

function toGitRef(name: string, shortName: string, targetCommit: string): GitRefDto | undefined {
  const decorated = refFromDecoratedName(name, targetCommit)
  if (!decorated) return undefined
  return { ...decorated, shortName: shortName || decorated.shortName }
}

function dedupeRefs(refs: GitRefDto[]): GitRefDto[] {
  const seen = new Set<string>()
  const result: GitRefDto[] = []
  for (const ref of refs) {
    const key = `${ref.type}:${ref.name}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(ref)
  }
  return result
}

function parseNameStatus(output: string): Array<Omit<GitCommitFileChangeDto, 'additions' | 'deletions'>> {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t')
      const statusCode = fields[0] ?? ''
      const status = toFileStatus(statusCode)
      if (status === 'renamed' || status === 'copied') {
        return {
          path: fields[2] ?? fields[1] ?? '',
          ...(fields[1] ? { oldPath: fields[1] } : {}),
          status
        }
      }
      return { path: fields[1] ?? '', status }
    })
    .filter((change) => change.path.length > 0)
}

function parseNumstat(output: string): Map<string, Pick<GitCommitFileChangeDto, 'additions' | 'deletions'>> {
  const stats = new Map<string, Pick<GitCommitFileChangeDto, 'additions' | 'deletions'>>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const fields = line.split('\t')
    const additions = parseOptionalNonNegativeInt(fields[0])
    const deletions = parseOptionalNonNegativeInt(fields[1])
    const filePath = normalizeNumstatPath(fields.slice(2).join('\t'))
    if (!filePath) continue
    stats.set(filePath, {
      ...(additions !== undefined ? { additions } : {}),
      ...(deletions !== undefined ? { deletions } : {})
    })
  }
  return stats
}

function normalizeNumstatPath(value: string): string {
  const match = value.match(/^(.+) => (.+)$/)
  return (match?.[2] ?? value).trim()
}

function parseOptionalNonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '-') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function toFileStatus(statusCode: string): GitCommitFileChangeDto['status'] {
  const first = statusCode[0]
  switch (first) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'type-change'
    case 'U': return 'unmerged'
    default: return 'unknown'
  }
}

function validateRefName(value: string, label: string): void {
  validateCommonGitToken(value, label)
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: contains unsupported characters`)
  }
}

function validateRevision(value: string, label: string): void {
  validateCommonGitToken(value, label)
  if (!/^[A-Za-z0-9._~^-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: contains unsupported characters`)
  }
}

function validateCommonGitToken(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`Invalid ${label}: must not be empty`)
  }
  if (value !== value.trim() || /\s/.test(value)) {
    throw new Error(`Invalid ${label}: whitespace is not allowed`)
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid ${label}: control characters are not allowed`)
  }
  if (value.includes('..')) {
    throw new Error(`Invalid ${label}: '..' is not allowed`)
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${label}: path separators are not allowed`)
  }
  if (value.startsWith('-')) {
    throw new Error(`Invalid ${label}: must not start with '-'`)
  }
  if (value.includes('@{')) {
    throw new Error(`Invalid ${label}: '@{' is not allowed`)
  }
}
