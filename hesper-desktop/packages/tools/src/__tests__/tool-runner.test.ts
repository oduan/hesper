import type { ToolDefinition } from '@hesper/shared'
import { describe, expect, it, vi } from 'vitest'
import { createAllowlistPermissionPolicy, createToolRunner, type ToolExecutor } from '../tool-runner'

const readTool: ToolDefinition = {
  id: 'filesystem.read-file',
  name: 'Read File',
  description: 'Read a file',
  category: 'filesystem',
  inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
}

const writeTool: ToolDefinition = {
  id: 'filesystem.write-file',
  name: 'Write File',
  description: 'Write a file',
  category: 'filesystem',
  inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } }
}

describe('ToolRunner', () => {
  it('executes allowed tools through the executor', async () => {
    const execute = vi.fn(async () => ({ content: 'file content', details: { bytes: 12 } }))
    const executor: ToolExecutor = { execute }
    const runner = createToolRunner({ policy: createAllowlistPermissionPolicy(), executor })

    const result = await runner.run(readTool, { path: 'README.md' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['filesystem.read-file']
    })

    expect(result).toEqual({ content: 'file content', details: { bytes: 12 } })
    expect(execute).toHaveBeenCalledWith(readTool, { path: 'README.md' }, expect.objectContaining({ runId: 'run-1' }))
  })

  it('checks permission before executor and returns a tool error when blocked', async () => {
    const execute = vi.fn(async () => ({ content: 'should not run' }))
    const executor: ToolExecutor = { execute }
    const runner = createToolRunner({ policy: createAllowlistPermissionPolicy(), executor })

    const result = await runner.run(writeTool, { path: 'README.md', content: 'x' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['filesystem.read-file']
    })

    expect(result).toEqual({
      content: 'Tool blocked by permission policy: Tool is not allowed for this run: filesystem.write-file',
      details: { code: 'permission_denied', toolId: 'filesystem.write-file' },
      isError: true
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails closed when permission policy throws', async () => {
    const execute = vi.fn(async () => ({ content: 'should not run' }))
    const runner = createToolRunner({
      policy: { evaluate: vi.fn(async () => { throw new Error('policy unavailable') }) },
      executor: { execute }
    })

    const result = await runner.run(readTool, { path: 'README.md' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['filesystem.read-file']
    })

    expect(result).toEqual({
      content: 'Tool blocked by permission policy: Permission policy failed closed: policy unavailable',
      details: { code: 'permission_policy_error', toolId: 'filesystem.read-file' },
      isError: true
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns a standard tool error when executor throws', async () => {
    const runner = createToolRunner({
      policy: createAllowlistPermissionPolicy(),
      executor: { execute: vi.fn(async () => { throw new Error('disk failed') }) }
    })

    const result = await runner.run(readTool, { path: 'README.md' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: ['filesystem.read-file']
    })

    expect(result).toEqual({
      content: 'Tool execution failed: disk failed',
      details: { code: 'tool_execution_error', toolId: 'filesystem.read-file' },
      isError: true
    })
  })

  it('fails closed when no run allowlist is present', async () => {
    const execute = vi.fn(async () => ({ content: 'should not run' }))
    const runner = createToolRunner({ policy: createAllowlistPermissionPolicy(), executor: { execute } })

    const result = await runner.run(readTool, { path: 'README.md' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      allowedToolIds: []
    })

    expect(result.isError).toBe(true)
    expect(result.details).toEqual({ code: 'permission_denied', toolId: 'filesystem.read-file' })
    expect(execute).not.toHaveBeenCalled()
  })
})
