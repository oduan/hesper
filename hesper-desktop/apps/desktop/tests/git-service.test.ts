import { execFile, spawn } from 'node:child_process'
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

async function gitAt(workspacePath: string, date: string, args: string[]) {
  return execFileAsync('git', ['-C', workspacePath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  })
}

async function gitWithInput(workspacePath: string, args: string[], input: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', workspacePath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`git ${args.join(' ')} failed with code ${code}: ${stderr || stdout}`))
    })
    child.stdin.end(input)
  })
}

async function writeBlob(workspacePath: string, content: string): Promise<string> {
  return (await gitWithInput(workspacePath, ['hash-object', '-w', '--stdin'], content)).stdout.trim()
}

async function createTreeWithSingleBlob(workspacePath: string, filePath: string, blobHash: string): Promise<string> {
  return (await gitWithInput(workspacePath, ['mktree', '-z'], `100644 blob ${blobHash}\t${filePath}\0`)).stdout.trim()
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

async function initBranchingRepo(workspacePath: string) {
  await execFileAsync('git', ['init', workspacePath], { encoding: 'utf8' })
  await git(workspacePath, ['config', 'user.name', 'Test User'])
  await git(workspacePath, ['config', 'user.email', 'test@example.com'])

  await fs.writeFile(path.join(workspacePath, 'base.txt'), 'base\n')
  await git(workspacePath, ['add', 'base.txt'])
  await git(workspacePath, ['commit', '-m', 'Base commit'])
  await git(workspacePath, ['branch', '-M', 'main'])
  const baseCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await git(workspacePath, ['switch', '-c', 'feature'])
  await fs.writeFile(path.join(workspacePath, 'feature.txt'), 'feature\n')
  await git(workspacePath, ['add', 'feature.txt'])
  await git(workspacePath, ['commit', '-m', 'Feature commit'])
  const featureCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await git(workspacePath, ['switch', 'main'])
  await fs.writeFile(path.join(workspacePath, 'main.txt'), 'main\n')
  await git(workspacePath, ['add', 'main.txt'])
  await git(workspacePath, ['commit', '-m', 'Main commit'])
  const mainCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await git(workspacePath, ['merge', '--no-ff', 'feature', '-m', 'Merge feature'])
  const mergeCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  return { baseCommit, featureCommit, mainCommit, mergeCommit }
}

async function initDisconnectedRepo(workspacePath: string) {
  await execFileAsync('git', ['init', workspacePath], { encoding: 'utf8' })
  await git(workspacePath, ['config', 'user.name', 'Test User'])
  await git(workspacePath, ['config', 'user.email', 'test@example.com'])

  await fs.writeFile(path.join(workspacePath, 'main.txt'), 'main\n')
  await git(workspacePath, ['add', 'main.txt'])
  await git(workspacePath, ['commit', '-m', 'Main root'])
  await git(workspacePath, ['branch', '-M', 'topic-a'])
  const mainCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await git(workspacePath, ['switch', '--orphan', 'docs'])
  await git(workspacePath, ['rm', '-rf', '.']).catch(() => undefined)
  await fs.writeFile(path.join(workspacePath, 'docs.txt'), 'docs\n')
  await git(workspacePath, ['add', 'docs.txt'])
  await git(workspacePath, ['commit', '-m', 'Docs root'])
  const docsCommit = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()
  await git(workspacePath, ['switch', '--detach', docsCommit])

  return { docsCommit, mainCommit }
}

async function initSshLikeMergeRepo(workspacePath: string) {
  await execFileAsync('git', ['init', workspacePath], { encoding: 'utf8' })
  await git(workspacePath, ['config', 'user.name', 'Test User'])
  await git(workspacePath, ['config', 'user.email', 'test@example.com'])

  await fs.writeFile(path.join(workspacePath, 'base.txt'), 'base\n')
  await git(workspacePath, ['add', 'base.txt'])
  await gitAt(workspacePath, '2026-01-01T00:00:00+0000', ['commit', '-m', 'fix: reduce connection onboarding typography'])
  await git(workspacePath, ['branch', '-M', 'main'])
  const base = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await fs.writeFile(path.join(workspacePath, 'timeline.txt'), 'timeline\n')
  await git(workspacePath, ['add', 'timeline.txt'])
  await gitAt(workspacePath, '2026-01-02T00:00:00+0000', ['commit', '-m', 'feat: improve tool step display and empty chat cleanup'])
  const mainOne = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await fs.writeFile(path.join(workspacePath, 'timeline.txt'), 'timeline\nhide resource\n')
  await git(workspacePath, ['add', 'timeline.txt'])
  await gitAt(workspacePath, '2026-01-03T00:00:00+0000', ['commit', '-m', 'fix: hide tool step resource in timeline'])
  const mainTwo = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await git(workspacePath, ['switch', '-c', 'ssh-tools', base])
  const branchCommits: string[] = []
  for (const [index, subject] of [
    'docs: design ssh tools',
    'feat(shared): add ssh domain schemas',
    'feat(persistence): store ssh metadata and executions',
    'feat(app-core): manage ssh servers and executions',
    'fix(app-core): align ssh service contract'
  ].entries()) {
    await fs.writeFile(path.join(workspacePath, `ssh-${index}.txt`), `${subject}\n`)
    await git(workspacePath, ['add', '.'])
    await gitAt(workspacePath, `2026-01-0${index + 4}T00:00:00+0000`, ['commit', '-m', subject])
    branchCommits.push((await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim())
  }
  const branchTip = branchCommits.at(-1)!

  await git(workspacePath, ['switch', 'main'])
  await gitAt(workspacePath, '2026-01-09T00:00:00+0000', ['merge', '--no-ff', 'ssh-tools', '-m', 'merge: ssh tools'])
  const merge = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await fs.writeFile(path.join(workspacePath, 'settings.txt'), 'settings\n')
  await git(workspacePath, ['add', 'settings.txt'])
  await gitAt(workspacePath, '2026-01-10T00:00:00+0000', ['commit', '-m', 'feat(renderer): move ssh management to settings'])
  const postMerge = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await git(workspacePath, ['switch', '-c', 'side', base])
  await fs.writeFile(path.join(workspacePath, 'side.txt'), 'side\n')
  await git(workspacePath, ['add', 'side.txt'])
  await gitAt(workspacePath, '2026-12-01T00:00:00+0000', ['commit', '-m', 'side: active unrelated branch'])
  const side = (await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()

  return { base, mainOne, mainTwo, branchCommits, branchTip, merge, postMerge, side }
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
        repositoryName: path.basename(workspacePath),
        commitCount: 2,
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

  it('supports offset pagination while preserving graph context', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.listLog({ sessionId: 'session-1', limit: 1, offset: 1 })

      expect(result.limit).toBe(1)
      expect(result.hasMore).toBe(false)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        commitHash: firstCommit,
        subject: 'Initial commit',
        graph: expect.objectContaining({ lanes: expect.any(Array), nodeLaneId: expect.any(String) })
      })
    })
  })

  it('builds graph lanes and edges from branching history', async () => {
    await withTempDir(async (workspacePath) => {
      const { baseCommit, mergeCommit } = await initBranchingRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.listLog({ sessionId: 'session-1', limit: 10 })

      expect(result.rows.map((row) => row.commitHash)).toContain(mergeCommit)
      expect(Math.max(...result.rows.map((row) => row.graph.lanes.length))).toBeGreaterThan(1)
      expect(new Set(result.rows.map((row) => row.graph.nodeLaneId)).size).toBeGreaterThan(1)
      expect(result.rows.some((row) => (row.graph.edges ?? []).length > 0)).toBe(true)
      expect(result.rows.some((row) => row.graph.lanes.some((lane) => lane.topActive !== undefined || lane.bottomActive !== undefined))).toBe(true)
      expect(result.rows.find((row) => row.commitHash === mergeCommit)?.graph.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ fromLaneId: expect.any(String), toLaneId: expect.any(String) })
      ]))
      expect(result.rows.find((row) => row.commitHash === baseCommit)?.graph.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ fromPosition: 'top', toPosition: 'center' })
      ]))
      const colors = result.rows.flatMap((row) => row.graph.lanes.map((lane) => lane.color))
      expect(colors).toContain('#dc2626')
      expect(colors).toContain('#2563eb')
    })
  })


  it('keeps ssh-like merge nodes on native lanes with stable lane colors', async () => {
    await withTempDir(async (workspacePath) => {
      const history = await initSshLikeMergeRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.listLog({ sessionId: 'session-1', limit: 20 })
      const rowByHash = new Map(result.rows.map((row) => [row.commitHash, row]))
      const nodeLane = (hash: string) => rowByHash.get(hash)?.graph.nodeLaneId
      const nodeColor = (hash: string) => {
        const row = rowByHash.get(hash)
        return row?.graph.lanes.find((lane) => lane.id === row.graph.nodeLaneId)?.color
      }

      const sideRow = rowByHash.get(history.side)
      expect(sideRow?.graph.lanes[0]).toMatchObject({ active: false, topActive: false, bottomActive: false })
      expect(nodeLane(history.postMerge)).toBe('lane-0')
      expect(nodeLane(history.merge)).toBe('lane-0')
      expect(nodeLane(history.mainTwo)).toBe('lane-0')
      expect(nodeLane(history.mainOne)).toBe('lane-0')
      expect(nodeLane(history.base)).toBe('lane-0')
      expect(nodeLane(history.side)).toBe('lane-1')
      expect(history.branchCommits.map(nodeLane)).toEqual(history.branchCommits.map(() => 'lane-2'))
      expect(new Set(history.branchCommits.map(nodeColor))).toEqual(new Set([nodeColor(history.branchTip)]))
      expect(nodeColor(history.branchTip)).not.toBe(nodeColor(history.mainTwo))
    })
  })

  it('recycles classic graph colors after disconnected lines end', async () => {
    await withTempDir(async (workspacePath) => {
      await initDisconnectedRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.listLog({ sessionId: 'session-1', limit: 10 })
      const rootNodeColors = result.rows
        .filter((row) => row.parents.length === 0)
        .map((row) => row.graph.lanes.find((lane) => lane.id === row.graph.nodeLaneId)?.color)

      expect(rootNodeColors).toHaveLength(2)
      expect(rootNodeColors).toEqual(['#dc2626', '#dc2626'])
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

  it('parses commit file changes with tab characters in paths', async () => {
    await withTempDir(async (workspacePath) => {
      const { secondCommit } = await initGitRepo(workspacePath)
      const tabbedPath = 'has\ttab.txt'
      const blob = await writeBlob(workspacePath, 'tabbed\n')
      const tree = await createTreeWithSingleBlob(workspacePath, tabbedPath, blob)
      const tabbedCommit = (await git(workspacePath, ['commit-tree', tree, '-p', secondCommit, '-m', 'Add tabbed path'])).stdout.trim()
      await git(workspacePath, ['update-ref', 'refs/heads/main', tabbedCommit])
      const service = createGitService({ id: 'session-1', workspacePath })

      const commit = await service.getCommit({ sessionId: 'session-1', commit: tabbedCommit })

      expect(commit.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: tabbedPath, status: 'added', additions: 1, deletions: 0 })
      ]))
    })
  })

  it('parses renamed file changes and numstat by the new path', async () => {
    await withTempDir(async (workspacePath) => {
      const { secondCommit } = await initGitRepo(workspacePath)
      const oldPath = 'old\tname.txt'
      const newPath = 'new\tname.txt'
      const oldBlob = await writeBlob(workspacePath, 'line one\nline two\n')
      const oldTree = await createTreeWithSingleBlob(workspacePath, oldPath, oldBlob)
      const oldCommit = (await git(workspacePath, ['commit-tree', oldTree, '-p', secondCommit, '-m', 'Add old tabbed path'])).stdout.trim()
      const newBlob = await writeBlob(workspacePath, 'line one\nline two\nline three\n')
      const newTree = await createTreeWithSingleBlob(workspacePath, newPath, newBlob)
      const renameCommit = (await git(workspacePath, ['commit-tree', newTree, '-p', oldCommit, '-m', 'Rename tabbed path'])).stdout.trim()
      await git(workspacePath, ['update-ref', 'refs/heads/main', renameCommit])
      const service = createGitService({ id: 'session-1', workspacePath })

      const commit = await service.getCommit({ sessionId: 'session-1', commit: renameCommit })

      expect(commit.files).toEqual([
        expect.objectContaining({ path: newPath, oldPath, status: 'renamed', additions: 1, deletions: 0 })
      ])
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

  it('allows slash-separated branch names', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.createBranch({ sessionId: 'session-1', branchName: 'feature/login', commit: firstCommit })

      expect(result.success).toBe(true)
      expect(result.state?.currentBranch).toBe('main')
      expect((await git(workspacePath, ['rev-parse', 'feature/login'])).stdout.trim()).toBe(firstCommit)
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

  it('rejects branch creation with checkout when the workspace is dirty', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      await fs.writeFile(path.join(workspacePath, 'dirty.txt'), 'not staged\n')
      const service = createGitService({ id: 'session-1', workspacePath })

      await expect(service.createBranch({ sessionId: 'session-1', branchName: 'dirty-checkout', commit: firstCommit, checkout: true })).rejects.toThrow(/dirty workspace/i)
      expect((await git(workspacePath, ['branch', '--show-current'])).stdout.trim()).toBe('main')
      await expect(git(workspacePath, ['rev-parse', '--verify', 'dirty-checkout'])).rejects.toThrow()
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

  it('points annotated tag refs at the peeled commit', async () => {
    await withTempDir(async (workspacePath) => {
      const { secondCommit } = await initGitRepo(workspacePath)
      await git(workspacePath, ['tag', '-a', 'annotated/v1', '-m', 'Annotated release', secondCommit])
      const tagObject = (await git(workspacePath, ['rev-parse', 'annotated/v1^{tag}'])).stdout.trim()
      const service = createGitService({ id: 'session-1', workspacePath })

      const state = await service.getState({ sessionId: 'session-1' })
      const tagRef = state.refs.find((ref) => ref.type === 'tag' && ref.shortName === 'annotated/v1')

      expect(tagObject).not.toBe(secondCommit)
      expect(tagRef).toEqual(expect.objectContaining({ targetCommit: secondCommit }))
    })
  })

  it('allows slash-separated tag names', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.createTag({ sessionId: 'session-1', tagName: 'release/v1.2.0', commit: firstCommit })

      expect(result.success).toBe(true)
      expect((await git(workspacePath, ['rev-parse', 'release/v1.2.0'])).stdout.trim()).toBe(firstCommit)
    })
  })

  it('checks out a historical commit hash in a clean workspace', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.checkout({ sessionId: 'session-1', ref: firstCommit })

      expect(result.success).toBe(true)
      expect(result.state?.headCommit).toBe(firstCommit)
      expect((await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(firstCommit)
      expect((await git(workspacePath, ['branch', '--show-current'])).stdout.trim()).toBe('')
    })
  })

  it('checks out a slash-separated local branch', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      await git(workspacePath, ['branch', 'feature/login', firstCommit])
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.checkout({ sessionId: 'session-1', ref: 'feature/login' })

      expect(result.success).toBe(true)
      expect(result.state?.currentBranch).toBe('feature/login')
      expect((await git(workspacePath, ['branch', '--show-current'])).stdout.trim()).toBe('feature/login')
      expect((await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(firstCommit)
    })
  })

  it('allows checkout of slash-separated remote refs', async () => {
    await withTempDir(async (workspacePath) => {
      const { firstCommit } = await initGitRepo(workspacePath)
      await git(workspacePath, ['update-ref', 'refs/remotes/origin/main', firstCommit])
      const service = createGitService({ id: 'session-1', workspacePath })

      const result = await service.checkout({ sessionId: 'session-1', ref: 'origin/main' })

      expect(result.success).toBe(true)
      expect(result.state?.headCommit).toBe(firstCommit)
      expect((await git(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(firstCommit)
      expect((await git(workspacePath, ['branch', '--show-current'])).stdout.trim()).toBe('')
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
      await expect(service.createBranch({ sessionId: 'session-1', branchName: 'feature..bad', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createBranch({ sessionId: 'session-1', branchName: '-bad', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createBranch({ sessionId: 'session-1', branchName: 'bad name', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createBranch({ sessionId: 'session-1', branchName: 'bad@{name', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createBranch({ sessionId: 'session-1', branchName: 'bad\\name', commit: secondCommit })).rejects.toThrow(/invalid branch name/i)
      await expect(service.createTag({ sessionId: 'session-1', tagName: '../escape', commit: secondCommit })).rejects.toThrow(/invalid tag name/i)
      await expect(service.createTag({ sessionId: 'session-1', tagName: 'bad\\tag', commit: secondCommit })).rejects.toThrow(/invalid tag name/i)
      await expect(service.checkout({ sessionId: 'session-1', ref: 'main..stable' })).rejects.toThrow(/invalid ref/i)
      await expect(service.checkout({ sessionId: 'session-1', ref: 'bad\\ref' })).rejects.toThrow(/invalid ref/i)
    })
  })

  it('is returned by createServiceContainer', async () => {
    const persistence = await createInMemoryPersistence()
    const container = createServiceContainer({ persistence, agentMode: 'mock' })

    expect(container.gitService).toBeDefined()
    expect(container.gitService).toBeInstanceOf(GitService)
  })
})
