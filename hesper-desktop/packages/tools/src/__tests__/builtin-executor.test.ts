import type { ToolDefinition } from '@hesper/shared'
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createBuiltinToolExecutor } from '../builtin-executor'

const timestamp = '2026-06-11T00:00:00.000Z'

function tool(id: string): ToolDefinition {
  return {
    id,
    name: id,
    description: id,
    category: id.startsWith('filesystem') ? 'filesystem' : id.startsWith('git') ? 'git' : id.startsWith('web') ? 'web' : id.startsWith('agent') ? 'agent' : 'system',
    inputSchema: { type: 'object', properties: {} }
  }
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hesper-tools-'))
}

describe('createBuiltinToolExecutor', () => {
  it('reads files inside the selected workspace', async () => {
    const root = await workspace()
    await writeFile(join(root, 'README.md'), 'Hello from workspace', 'utf8')
    const executor = createBuiltinToolExecutor()

    const result = await executor.execute(tool('filesystem.read-file'), { path: 'README.md' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.read-file']
    })

    expect(result.content).toBe('Hello from workspace')
    expect(result.details).toMatchObject({ path: expect.stringContaining('README.md'), bytes: 20, truncated: false })
  })

  it('writes files inside the selected workspace', async () => {
    const root = await workspace()
    const executor = createBuiltinToolExecutor()

    const result = await executor.execute(tool('filesystem.write-file'), { path: 'notes/out.txt', content: 'Saved by tool' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.write-file']
    })

    expect(await readFile(join(root, 'notes/out.txt'), 'utf8')).toBe('Saved by tool')
    expect(result.content).toContain('Wrote 13 bytes')
    expect(result.details).toMatchObject({ bytes: 13 })
  })

  it('edits multiple line ranges using original line numbers without drift', async () => {
    const root = await workspace()
    await writeFile(join(root, 'notes.txt'), 'one\ntwo\nthree\nfour\nfive\n', 'utf8')
    const executor = createBuiltinToolExecutor()

    const result = await executor.execute(tool('filesystem.edit-file'), {
      path: 'notes.txt',
      edits: [
        { startLine: 1, content: 'zero\none' },
        { startLine: 2, content: 'TWO' },
        { startLine: 4, endLine: 5, content: 'FOUR' }
      ]
    }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.edit-file']
    })

    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('zero\none\nTWO\nthree\nFOUR\n')
    expect(result.content).toContain('Edited 3 line range')
    expect(result.details).toMatchObject({ edits: 3, linesBefore: 5, linesAfter: 5 })
  })

  it('blocks symlinks or junctions that resolve outside the workspace', async () => {
    const root = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, 'secret.txt'), 'outside secret', 'utf8')
    try {
      await symlink(outside, join(root, 'linked-outside'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) return
      throw error
    }
    const executor = createBuiltinToolExecutor()

    await expect(executor.execute(tool('filesystem.read-file'), { path: 'linked-outside/secret.txt' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.read-file']
    })).rejects.toThrow('outside the selected workspace')
  })

  it('blocks writes through symlinked or junction parent directories outside the workspace', async () => {
    const root = await workspace()
    const outside = await workspace()
    await mkdir(join(outside, 'target'), { recursive: true })
    try {
      await symlink(join(outside, 'target'), join(root, 'linked-target'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) return
      throw error
    }
    const executor = createBuiltinToolExecutor()

    await expect(executor.execute(tool('filesystem.write-file'), { path: 'linked-target/out.txt', content: 'outside' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.write-file']
    })).rejects.toThrow('outside the selected workspace')
  })

  it('blocks filesystem paths outside the workspace', async () => {
    const root = await workspace()
    const executor = createBuiltinToolExecutor()

    await expect(executor.execute(tool('filesystem.read-file'), { path: '../outside.txt' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.read-file']
    })).rejects.toThrow('outside the selected workspace')
  })

  it('deletes files and directories inside the selected workspace', async () => {
    const root = await workspace()
    await writeFile(join(root, 'old.txt'), 'delete me', 'utf8')
    await mkdir(join(root, 'old-dir', 'nested'), { recursive: true })
    await writeFile(join(root, 'old-dir', 'nested', 'child.txt'), 'delete me too', 'utf8')
    const executor = createBuiltinToolExecutor()

    await expect(executor.execute(tool('filesystem.delete-file'), { path: 'old.txt' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.delete-file']
    })).resolves.toMatchObject({ details: expect.objectContaining({ toolId: 'filesystem.delete-file' }) })
    await expect(readFile(join(root, 'old.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(executor.execute(tool('filesystem.delete-directory'), { path: 'old-dir', recursive: true }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.delete-directory']
    })).resolves.toMatchObject({ details: expect.objectContaining({ recursive: true }) })
    await expect(stat(join(root, 'old-dir'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to delete the selected workspace root directory', async () => {
    const root = await workspace()
    const executor = createBuiltinToolExecutor()

    await expect(executor.execute(tool('filesystem.delete-directory'), { path: '.', recursive: true }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.delete-directory']
    })).rejects.toThrow('Refusing to delete')
  })

  it('lists, finds, and searches workspace files with metadata and line context', async () => {
    const root = await workspace()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'README.md'), 'alpha\nbeta needle\ngamma\ndelta\n', 'utf8')
    await writeFile(join(root, 'src', 'app.ts'), 'one\ntwo needle\nthree\nfour\n', 'utf8')
    const executor = createBuiltinToolExecutor()

    const listed = await executor.execute(tool('filesystem.list-directory'), { path: '.', includeSize: true, includeModifiedAt: true }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.list-directory']
    })
    expect(JSON.parse(listed.content)).toMatchObject({
      path: '.',
      entries: expect.arrayContaining([
        expect.objectContaining({ name: 'README.md', type: 'file', size: expect.any(Number), modifiedAt: expect.any(String) }),
        expect.objectContaining({ name: 'src', type: 'directory', size: 0 })
      ])
    })

    const found = await executor.execute(tool('filesystem.find'), { pattern: 'readme', includeSize: true }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.find']
    })
    expect(JSON.parse(found.content)).toMatchObject({ matches: [expect.objectContaining({ path: 'README.md', type: 'file', size: expect.any(Number) })] })

    const searched = await executor.execute(tool('filesystem.search'), { condition: { all: [{ nameGlob: '*.ts' }, { contentContains: 'needle' }] } }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['filesystem.search']
    })
    expect(JSON.parse(searched.content)).toMatchObject({
      results: [expect.objectContaining({
        path: 'src/app.ts',
        matches: [expect.objectContaining({ lineNumber: 2, line: 'two needle', before: [{ lineNumber: 1, line: 'one' }], after: expect.arrayContaining([expect.objectContaining({ lineNumber: 3, line: 'three' })]) })]
      })]
    })
  })

  it('runs git status through an injectable command runner', async () => {
    const root = await workspace()
    const runGitStatus = vi.fn(async () => '## main\n M README.md\n')
    const executor = createBuiltinToolExecutor({ runGitStatus })

    const result = await executor.execute(tool('git.status'), {}, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['git.status']
    })

    expect(runGitStatus).toHaveBeenCalledWith(root, expect.objectContaining({ timeoutMs: 10_000 }))
    expect(result.content).toBe('## main\n M README.md\n')
    expect(result.details).toMatchObject({ workspacePath: root })
  })

  it('runs git arguments from the selected workspace and rejects repo-escaping arguments', async () => {
    const root = await workspace()
    const executor = createBuiltinToolExecutor()

    const result = await executor.execute(tool('git.run'), { args: ['--version'] }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['git.run']
    })
    expect(result.details).toMatchObject({ toolId: 'git.run', workspacePath: root, args: ['--version'], exitCode: 0 })
    expect(result.content).toContain('git')

    await expect(executor.execute(tool('git.run'), { args: ['git', 'status'] }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['git.run']
    })).rejects.toThrow('do not include the git command')

    await expect(executor.execute(tool('git.run'), { args: ['--work-tree=..', 'status'] }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['git.run']
    })).rejects.toThrow('not allowed')
  })

  it('executes a platform shell command from the selected workspace', async () => {
    const root = await workspace()
    const executor = createBuiltinToolExecutor()
    const command = process.platform === 'win32' ? 'Write-Output hello' : 'printf hello'

    const result = await executor.execute(tool('system.execute-command'), { command }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: root,
      allowedToolIds: ['system.execute-command']
    })

    expect(result.isError).toBe(false)
    expect(result.content).toContain('hello')
    expect(result.details).toMatchObject({ toolId: 'system.execute-command', workspacePath: root, exitCode: 0, platform: process.platform })
  })

  it('fetches URLs through TinyFish Fetch with a stored tool API key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          url: 'https://example.com/',
          final_url: 'https://example.com/article',
          title: 'Example Article',
          description: 'An example page',
          language: 'en',
          text: '# Example Article\n\nExtracted page content.',
          format: 'markdown',
          links: ['https://example.com/about'],
          image_links: ['https://example.com/image.png'],
          latency_ms: 123
        }
      ],
      errors: []
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const readToolApiKey = vi.fn(async () => 'tinyfish-key')
    const executor = createBuiltinToolExecutor({ fetch: fetchImpl as unknown as typeof fetch, readToolApiKey, now: () => timestamp })

    const result = await executor.execute(tool('web.fetch-url'), {
      url: 'https://example.com',
      format: 'markdown',
      links: true,
      imageLinks: true,
      ttl: 0,
      perUrlTimeoutMs: 30_000
    }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })

    expect(readToolApiKey).toHaveBeenCalledWith('web.fetch-url')
    expect(fetchImpl).toHaveBeenCalledWith('https://api.fetch.tinyfish.ai', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': 'tinyfish-key' },
      body: JSON.stringify({
        urls: ['https://example.com/'],
        format: 'markdown',
        links: true,
        image_links: true,
        per_url_timeout_ms: 30_000,
        ttl: 0
      })
    }))
    expect(result.content).toBe('# Example Article\n\nExtracted page content.')
    expect(result.details).toMatchObject({
      toolId: 'web.fetch-url',
      endpoint: 'https://api.fetch.tinyfish.ai',
      url: 'https://example.com/',
      finalUrl: 'https://example.com/article',
      title: 'Example Article',
      format: 'markdown',
      links: ['https://example.com/about'],
      imageLinks: ['https://example.com/image.png'],
      latencyMs: 123,
      fetchedAt: timestamp
    })
  })

  it('requires a TinyFish API key before URL fetch can run', async () => {
    const fetchImpl = vi.fn()
    const executor = createBuiltinToolExecutor({ fetch: fetchImpl as unknown as typeof fetch, readToolApiKey: async () => undefined })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://example.com' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('TinyFish API key is required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('redacts TinyFish Fetch API keys from upstream errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad tinyfish-key error', { status: 401, statusText: 'Unauthorized' }))
    const executor = createBuiltinToolExecutor({ fetch: fetchImpl as unknown as typeof fetch, readToolApiKey: async () => 'tinyfish-key' })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://example.com' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('bad [redacted] error')
  })

  it('blocks non-http web urls', async () => {
    const executor = createBuiltinToolExecutor()

    await expect(executor.execute(tool('web.fetch-url'), { url: 'file:///etc/passwd' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Only http and https URLs are allowed')
  })

  it('searches the web through TinyFish with a stored tool API key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      query: 'web automation',
      results: [
        { position: 1, title: 'TinyFish', snippet: 'Automate websites', url: 'https://tinyfish.ai' },
        { position: 2, title: 'Example', snippet: 'Second result', url: 'https://example.com' }
      ],
      total_results: 2,
      page: 0
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const readToolApiKey = vi.fn(async () => 'tinyfish-key')
    const executor = createBuiltinToolExecutor({ fetch: fetchImpl as unknown as typeof fetch, readToolApiKey, now: () => timestamp })

    const result = await executor.execute(tool('web.search'), { query: 'web automation', limit: 1, location: 'US', language: 'en' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.search']
    })

    expect(readToolApiKey).toHaveBeenCalledWith('web.search')
    expect(fetchImpl).toHaveBeenCalledWith(expect.objectContaining({ href: expect.stringContaining('https://api.search.tinyfish.ai/?query=web+automation') }), expect.objectContaining({
      method: 'GET',
      headers: { 'X-API-Key': 'tinyfish-key' }
    }))
    expect(JSON.parse(result.content)).toMatchObject({ query: 'web automation', results: [expect.objectContaining({ title: 'TinyFish' })], totalResults: 2, fetchedAt: timestamp })
    expect(result.details).toMatchObject({ toolId: 'web.search', endpoint: 'https://api.search.tinyfish.ai', resultCount: 1 })
  })

  it('requires a TinyFish API key before web search can run', async () => {
    const executor = createBuiltinToolExecutor({ readToolApiKey: async () => undefined })

    await expect(executor.execute(tool('web.search'), { query: 'web automation' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.search']
    })).rejects.toThrow('TinyFish API key is required')
  })

  it('returns a controlled error when notifications are not available', async () => {
    const executor = createBuiltinToolExecutor()

    const result = await executor.execute(tool('system.show-notification'), { message: 'Hello' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['system.show-notification']
    })

    expect(result).toEqual({
      content: 'Desktop notification support is not available in this runtime.',
      details: { code: 'not_available', toolId: 'system.show-notification' },
      isError: true
    })
  })

  it('returns a controlled error for agent.spawn-worker-agent until Worker Agent child runs are implemented', async () => {
    const executor = createBuiltinToolExecutor()

    const result = await executor.execute(tool('agent.spawn-worker-agent'), { task: 'review' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['agent.spawn-worker-agent']
    })

    expect(result).toEqual({
      content: 'Worker Agent execution is not available yet.',
      details: { code: 'not_implemented', toolId: 'agent.spawn-worker-agent' },
      isError: true
    })
  })
})
