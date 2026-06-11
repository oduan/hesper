import type { ToolDefinition } from '@hesper/shared'
import type { ToolRunner } from '@hesper/tools'
import { describe, expect, it, vi } from 'vitest'
import { createPiAgentTools } from '../pi-tools'

const readTool: ToolDefinition = {
  id: 'filesystem.read-file',
  name: 'Read File',
  description: 'Read a file',
  category: 'filesystem',
  inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
}

describe('createPiAgentTools', () => {
  it('maps Hesper tool definitions to pi AgentTool metadata', () => {
    const runner: ToolRunner = { run: vi.fn() }
    const [tool] = createPiAgentTools({
      tools: [readTool],
      runner,
      context: { runId: 'run-1', sessionId: 'session-1', allowedToolIds: ['filesystem.read-file'] }
    })

    expect(tool).toMatchObject({
      name: 'filesystem.read-file',
      label: 'Read File',
      description: 'Read a file',
      parameters: readTool.inputSchema
    })
  })

  it('executes through ToolRunner with run context and returns text content', async () => {
    const signal = new AbortController().signal
    const run = vi.fn(async () => ({ content: 'file content', details: { bytes: 12 } }))
    const [tool] = createPiAgentTools({
      tools: [readTool],
      runner: { run },
      context: { runId: 'run-1', sessionId: 'session-1', workspacePath: 'C:/workspace', allowedToolIds: ['filesystem.read-file'] }
    })

    const result = await tool!.execute('tool-call-1', { path: 'README.md' }, signal)

    expect(run).toHaveBeenCalledWith(readTool, { path: 'README.md' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: 'C:/workspace',
      allowedToolIds: ['filesystem.read-file'],
      signal
    })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'file content' }],
      details: { toolId: 'filesystem.read-file', toolCallId: 'tool-call-1', result: { bytes: 12 } }
    })
  })

  it('throws with structured details when ToolRunner returns an error result', async () => {
    const runner: ToolRunner = {
      run: vi.fn(async () => ({ content: 'Tool blocked by permission policy', details: { code: 'permission_denied' }, isError: true }))
    }
    const [tool] = createPiAgentTools({
      tools: [readTool],
      runner,
      context: { runId: 'run-1', sessionId: 'session-1', allowedToolIds: [] }
    })

    await expect(tool!.execute('tool-call-1', { path: 'README.md' })).rejects.toMatchObject({
      message: 'Tool blocked by permission policy',
      details: { code: 'permission_denied' }
    })
  })
})
