import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverProjectContextFiles } from '../project-context-service'

const tempDirectories: string[] = []

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hesper-project-context-'))
  tempDirectories.push(directory)
  return directory
}

async function writeWorkspaceFile(workspacePath: string, relativePath: string, content = '# context'): Promise<void> {
  const absolutePath = path.join(workspacePath, ...relativePath.split('/'))
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('discoverProjectContextFiles', () => {
  it('returns root files first, then sorts by directory depth and alphabetically', async () => {
    const workspacePath = await createWorkspace()
    await writeWorkspaceFile(workspacePath, 'src/deep/CLAUDE.md')
    await writeWorkspaceFile(workspacePath, 'b/AGENTS.md')
    await writeWorkspaceFile(workspacePath, 'AGENTS.md')
    await writeWorkspaceFile(workspacePath, 'a/CLAUDE.md')
    await writeWorkspaceFile(workspacePath, 'CLAUDE.md')

    await expect(discoverProjectContextFiles({ workspacePath })).resolves.toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'a/CLAUDE.md',
      'b/AGENTS.md',
      'src/deep/CLAUDE.md'
    ])
  })

  it('ignores generated, dependency, cache, vendor, and git directories', async () => {
    const workspacePath = await createWorkspace()
    await writeWorkspaceFile(workspacePath, 'src/AGENTS.md')
    await writeWorkspaceFile(workspacePath, '.git/AGENTS.md')
    await writeWorkspaceFile(workspacePath, 'node_modules/CLAUDE.md')
    await writeWorkspaceFile(workspacePath, 'dist/AGENTS.md')
    await writeWorkspaceFile(workspacePath, 'build/AGENTS.md')
    await writeWorkspaceFile(workspacePath, '.next/AGENTS.md')
    await writeWorkspaceFile(workspacePath, 'coverage/AGENTS.md')
    await writeWorkspaceFile(workspacePath, 'vendor/AGENTS.md')
    await writeWorkspaceFile(workspacePath, '.cache/AGENTS.md')
    await writeWorkspaceFile(workspacePath, '.turbo/AGENTS.md')
    await writeWorkspaceFile(workspacePath, 'out/AGENTS.md')
    await writeWorkspaceFile(workspacePath, '.output/AGENTS.md')

    await expect(discoverProjectContextFiles({ workspacePath })).resolves.toEqual(['src/AGENTS.md'])
  })

  it('matches AGENTS.md and CLAUDE.md case-insensitively', async () => {
    const workspacePath = await createWorkspace()
    await writeWorkspaceFile(workspacePath, 'Agents.MD')
    await writeWorkspaceFile(workspacePath, 'pkg/claude.md')
    await writeWorkspaceFile(workspacePath, 'pkg/notes.md')

    await expect(discoverProjectContextFiles({ workspacePath })).resolves.toEqual([
      'Agents.MD',
      'pkg/claude.md'
    ])
  })

  it('limits results to 30 relative paths', async () => {
    const workspacePath = await createWorkspace()
    await Promise.all(Array.from({ length: 35 }, async (_, index) => {
      await writeWorkspaceFile(workspacePath, `pkg-${String(index).padStart(2, '0')}/AGENTS.md`)
    }))

    const results = await discoverProjectContextFiles({ workspacePath })

    expect(results).toHaveLength(30)
    expect(results[0]).toBe('pkg-00/AGENTS.md')
    expect(results[29]).toBe('pkg-29/AGENTS.md')
  })
})
