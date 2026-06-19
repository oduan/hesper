import type { ToolDefinition } from '@hesper/shared'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
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

  it('fetches http urls through an injectable pinned request implementation', async () => {
    const requestHttp = vi.fn(async () => ({ text: 'Example page', status: 200, contentType: 'text/plain', bytesRead: 12, truncated: false }))
    const executor = createBuiltinToolExecutor({ requestHttp, resolveHostname: async () => ['93.184.216.34'], now: () => timestamp })

    const result = await executor.execute(tool('web.fetch-url'), { url: 'https://example.com' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })

    expect(requestHttp).toHaveBeenCalledWith(new URL('https://example.com/'), ['93.184.216.34'], expect.any(AbortSignal), 15_000, 256 * 1024)
    expect(result.content).toBe('Example page')
    expect(result.details).toMatchObject({ url: 'https://example.com/', status: 200, contentType: 'text/plain', fetchedAt: timestamp })
  })

  it('blocks private network web urls before fetching', async () => {
    const requestHttp = vi.fn(async () => ({ text: 'should not fetch', status: 200, bytesRead: 16, truncated: false }))
    const executor = createBuiltinToolExecutor({ requestHttp, resolveHostname: async () => ['127.0.0.1'] })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://private.example' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Private network URLs are not allowed')
    expect(requestHttp).not.toHaveBeenCalled()
  })

  it('blocks IPv6-mapped private addresses before fetching', async () => {
    const requestHttp = vi.fn(async () => ({ text: 'should not fetch', status: 200, bytesRead: 16, truncated: false }))
    const executor = createBuiltinToolExecutor({ requestHttp, resolveHostname: async () => ['::ffff:172.16.0.1'] })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://mapped-private.example' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Private network URLs are not allowed')
    expect(requestHttp).not.toHaveBeenCalled()
  })

  it('blocks hex IPv6-mapped private addresses before fetching', async () => {
    const requestHttp = vi.fn(async () => ({ text: 'should not fetch', status: 200, bytesRead: 16, truncated: false }))
    const executor = createBuiltinToolExecutor({ requestHttp, resolveHostname: async () => ['::ffff:7f00:1'] })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://mapped-private-hex.example' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Private network URLs are not allowed')
    expect(requestHttp).not.toHaveBeenCalled()
  })

  it('blocks IPv6 link-local addresses before fetching', async () => {
    const requestHttp = vi.fn(async () => ({ text: 'should not fetch', status: 200, bytesRead: 16, truncated: false }))
    const executor = createBuiltinToolExecutor({ requestHttp, resolveHostname: async () => ['fe81::1'] })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://link-local.example' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Private network URLs are not allowed')
    expect(requestHttp).not.toHaveBeenCalled()
  })

  it('blocks expanded IPv6 loopback and mapped private addresses before fetching', async () => {
    const requestHttp = vi.fn(async () => ({ text: 'should not fetch', status: 200, bytesRead: 16, truncated: false }))
    const executor = createBuiltinToolExecutor({
      requestHttp,
      resolveHostname: async (hostname) => hostname.includes('loopback') ? ['0:0:0:0:0:0:0:1'] : ['0:0:0:0:0:ffff:7f00:1']
    })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://expanded-loopback.example' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Private network URLs are not allowed')
    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://expanded-mapped.example' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Private network URLs are not allowed')
    expect(requestHttp).not.toHaveBeenCalled()
  })

  it('times out hostname resolution before fetching', async () => {
    const requestHttp = vi.fn(async () => ({ text: 'should not fetch', status: 200, bytesRead: 16, truncated: false }))
    const executor = createBuiltinToolExecutor({
      requestHttp,
      fetchTimeoutMs: 1,
      resolveHostname: async () => new Promise<string[]>(() => {})
    })

    await expect(executor.execute(tool('web.fetch-url'), { url: 'https://slow-dns.example' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('URL resolution timed out or was aborted')
    expect(requestHttp).not.toHaveBeenCalled()
  })

  it('blocks non-http web urls', async () => {
    const executor = createBuiltinToolExecutor()

    await expect(executor.execute(tool('web.fetch-url'), { url: 'file:///etc/passwd' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['web.fetch-url']
    })).rejects.toThrow('Only http and https URLs are allowed')
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
