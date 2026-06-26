import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { GitService } from '../electron/git-service'
import { createServiceContainer } from '../electron/service-container'

const execFileAsync = promisify(execFile)

type TestSession = {
  id: string
  workspacePath?: string
}

function createSessionService(session: TestSession) {
  return {
    async getSession(id: string) {
      return id === session.id ? session : undefined
    }
  }
}

async function git(workspacePath: string, args: string[]) {
  return execFileAsync('git', ['-C', workspacePath, ...args], { encoding: 'utf8' })
}

async function withTempDir<T>(run: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hesper-git-service-'))
  try {
    return await run(workspacePath)
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true })
  }
}

async function initGitRepo(workspacePath: string) {
  await execFileAsync('git', ['init', workspacePath], { encoding: 'utf8' })
  await git(workspacePath, ['config', 'user.name', 'Test User'])
  await git(workspacePath, ['config', 'user.email', 'test@example.com'])

  await fs.writeFile(path.join(workspacePath, 'README.md'), 'Initial\n')
  await git(workspacePath, ['add', 'README.md'])
  await git(workspacePath, ['commit', '-m', 'Initial commit', '-m', 'Initial body'])
  await git(workspacePath, ['branch', '-M', 'main'])
  const firstCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await fs.writeFile(path.join(workspacePath, 'README.md'), 'Initial\nUpdated\n')
  await fs.writeFile(path.join(workspacePath, 'app.ts'), 'export const answer = 42\n')
  await git(workspacePath, ['add', 'README.md', 'app.ts'])
  await git(workspacePath, ['commit', '-m', 'Second commit', '-m', 'Second body line'])
  const secondCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()
  await git(workspacePath, ['tag', 'v1.0.0', secondCommit])
  await git(workspacePath, ['branch', 'stable', secondCommit])

  return { firstCommit, secondCommit }
}

function createGitService(session: TestSession) {
  return new GitService({ sessionService: createSessionService(session) })
}

describe('GitService', () => {
  it('returns isGitRepository false for a non-Git directory', async () => {
    await withTempDir(async (workspacePath) => {
      const service = createGitService({ id: 'session-1', workspacePath })

      await expect(service.getState({ sessionId: 'session-1' })).resolves.toEqual({
        sessionId: 'session-1',
        workspacePath,
        isGitRepository: false,
        dirty: false,
        changedFiles: 0,
        refs: []
      })
    })
  })

  it('returns current branch, HEAD, dirty state, and refs for a Git directory', async () => {
    await withTempDir(async (workspacePath) => {
      const { secondCommit } = await initGitRepo(workspacePath)
      await fs.writeFile(path.join(workspacePath, 'dirty.txt'), 'not staged\n')
      const service = createGitService({ id: 'session-1', workspacePath })

      const state = await service.getState({ sessionId: 'session-1' })

      expect(state).toMatchObject({
        sessionId: 'session-1',
        workspacePath,
        isGitRepository: true,
        currentBranch: 'main',
        headCommit: secondCommit,
        dirty: true,
        changedFiles: 1
      })
      expect(state.refs).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'HEAD', shortName: 'HEAD', type: 'head', targetCommit: secondCommit }),
        expect.objectContaining({ name: 'refs/heads/main', shortName: 'main', type: 'local-branch', targetCommit: secondCommit }),
        expect.objectContaining({ name: 'refs/heads/stable', shortName: 'stable', type: 'local-branch', targetCommit: secondCommit }),
        expect.objectContaining({ name: 'refs/tags/v1.0.0', shortName: 'v1.0.0', type: 'tag', targetCommit: secondCommit })
      ]))
    })
  })

  it('lists commit rows with refs, author, dates, short hash, limit, and hasMore', async () => {
    await withTempDir(async (workspacePath) => {
      const { secondCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.listLog({ sessionId: 'session-1', limit: 1 })

      expect(result.limit).toBe(1)
      expect(result.hasMore).toBe(true)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        commitHash: secondCommit,
        shortHash: secondCommit.slice(0, 7),
        subject: 'Second commit',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        parents: [expect.stringMatching(/^[a-f0-9]{40}$/)],
        graph: expect.objectContaining({ lanes: expect.any(Array), nodeLaneId: expect.any(String) })
      })
      expect(result.rows[0]?.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      expect(result.rows[0]?.refs).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'head', shortName: 'HEAD' }),
        expect.objectContaining({ type: 'local-branch', shortName: 'main' }),
        expect.objectContaining({ type: 'tag', shortName: 'v1.0.0' })
      ]))
    })
  })

  it('returns commit details with full hash, parents, full message, and file changes', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit, secondCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const commit = await service.getCommit({ sessionId: 'session-1', commit: secondCommit })

      expect(commit).toMatchObject({
        commitHash: secondCommit,
        shortHash: secondCommit.slice(0, 7),
        parents: [firstCommit],
        subject: 'Second commit',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committerName: 'Test User',
        committerEmail: 'test@example.com'
      })
      expect(commit.body).toContain('Second commit')
      expect(commit.body).toContain('Second body line')
      expect(commit.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      expect(commit.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      expect(commit.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', status: 'modified', additions: 1, deletions: 0 }),
        expect.objectContaining({ path: 'app.ts', status: 'added', additions: 1, deletions: 0 })
      ]))
      expect(commit.refs).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'local-branch', shortName: 'main' }),
        expect.objectContaining({ type: 'tag', shortName: 'v1.0.0' })
      ]))
    })
  })

  it('creates a branch without checking it out', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.createBranch({ sessionId: 'session-1', branchName: 'worktree-test', commit: firstCommit })

      expect(result.success).toBe(true)
      expect(result.state?.currentBranch).toBe('main')
      expect((await git(workspacePath, ['rev-parse', 'worktree-test'])).stdout.trim()).toBe(firstCommit)
      expect((await git(workspacePath, ['branch', '--show-current'])).stdout.trim()).toBe('main')
    })
  })

  it('creates a branch and checks it out when requested', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.createBranch({ sessionId: 'session-1', branchName: 'checked-out', commit: firstCommit, checkout: true })

      expect(result.success).toBe(true)
      expect(result.state?.currentBranch).toBe('checked-out')
      expect((await git(workspacePath, ['branch', '--show-current'])).stdout.trim()).toBe('checked-out')
      expect((await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(firstCommit)
    })
  })

  it('creates a tag', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.createTag({ sessionId: 'session-1', tagName: 'v0.1.0', commit: firstCommit })

      expect(result.success).toBe(true)
      expect((await git(workspacePath, ['rev-parse', 'v0.1.0'])).stdout.trim()).toBe(firstCommit)
    })
  })

  it('rejects checkout when the workspace is dirty', async () => {
    await withTempDir(async (workspacePath) => {
      await initGitRepo(workspacePath)
      await fs.writeFile(path.join(workspacePath, 'dirty.txt'), 'not staged\n')
      const service = createGitService({ id: 'session-1', workspacePath })

      await expect(service.checkout({ sessionId: 'session-1', ref: 'stable' })).rejects.toThrow(/dirty workspace/i)
      expect((await git(workspacePath, ['branch', '--show-current'])).stdout.trim()).toBe('main')
    })
  })

  it('rejects dangerous branch, tag, and ref names', async () => {
    await withTempDir(async (workspacePath) => {
      const { secondCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      await expect(service.createBranch({ sessionId: 'session-1', branchName: '../escape', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createBranch({ sessionId: 'session-1', branchName: '-bad', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createBranch({ sessionId: 'session-1', branchName: 'bad name', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createBranch({ sessionId: 'session-1', branchName: 'bad@{name', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createTag({ sessionId: 'session-1', tagName: 'bad/tag', commit: secondCommit })).rejects.toThrow(/invalid tag name/i)
      await expect(service.checkout({ sessionId: 'session-1', ref: 'main..stable' })).rejects.toThrow(/invalid ref/i)
    })
  })

  it('is returned by createServiceContainer', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })

    expect(container.gitService).toBeDefined()
    expect(container.gitService).toBeInstanceOf(GitService)
  })
})
