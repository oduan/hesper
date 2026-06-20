import type { ToolDefinition } from '@hesper/shared'
import type { ToolRunner } from '@hesper/tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPiToolRunState, createPiAgentTools } from '../pi-tools'

const readTool: ToolDefinition = {
  id: 'filesystem.read-file',
  name: 'Read File',
  description: 'Read a file',
  category: 'filesystem',
  icon: '📖',
  inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
}

const workerTool: ToolDefinition = {
  id: 'agent.spawn-worker-agent',
  name: 'Spawn Worker Agent',
  description: 'Spawn',
  category: 'agent',
  inputSchema: { type: 'object', properties: {} }
}

const trackedRunIds = ['run-1', 'run-parent', 'run-other']

beforeEach(() => {
  for (const runId of trackedRunIds) {
    clearPiToolRunState(runId)
  }
})

afterEach(() => {
  for (const runId of trackedRunIds) {
    clearPiToolRunState(runId)
  }
})

describe('createPiAgentTools', () => {
  it('maps Hesper tool definitions to pi AgentTool metadata', () => {
    const runner: ToolRunner = { run: vi.fn() }
    const [tool] = createPiAgentTools({
      tools: [readTool],
      runner,
      context: { runId: 'run-1', sessionId: 'session-1', allowedToolIds: ['filesystem.read-file'] }
    })

    expect(tool).toMatchObject({
      name: 'filesystem_read-file',
      label: 'Read File',
      description: 'Read a file',
      parameters: {
        type: 'object',
        required: ['path', 'purpose'],
        properties: {
          path: { type: 'string' },
          purpose: expect.objectContaining({ type: 'string' })
        }
      }
    })
    expect(tool!.name).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('executes through ToolRunner with run context and returns text content', async () => {
    const signal = new AbortController().signal
    const run = vi.fn(async () => ({ content: 'file content', details: { bytes: 12 } }))
    const [tool] = createPiAgentTools({
      tools: [readTool],
      runner: { run },
      context: { runId: 'run-1', sessionId: 'session-1', workspacePath: 'C:/workspace', allowedToolIds: ['filesystem.read-file'] }
    })

    const result = await tool!.execute('tool-call-1', { path: 'README.md', purpose: '读取 README 了解项目结构' }, signal)

    expect(run).toHaveBeenCalledWith(readTool, { path: 'README.md' }, {
      runId: 'run-1',
      sessionId: 'session-1',
      workspacePath: 'C:/workspace',
      allowedToolIds: ['filesystem.read-file'],
      toolCallId: 'tool-call-1',
      parentStepId: 'step-run-1-tool-tool-call-1',
      signal
    })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'file content' }],
      details: { toolId: 'filesystem.read-file', toolCallId: 'tool-call-1', toolIcon: '📖', result: { bytes: 12 } }
    })
  })

  it('passes toolCallId and parentStepId to ToolRunner context', async () => {
    const run = vi.fn(async () => ({ content: 'ok' }))
    const [tool] = createPiAgentTools({
      tools: [workerTool],
      runner: { run },
      context: { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: ['agent.spawn-worker-agent'] }
    })

    await tool!.execute('tool-1', { purpose: 'delegate work' }, new AbortController().signal)

    expect(run).toHaveBeenCalledWith(expect.any(Object), {}, expect.objectContaining({
      toolCallId: 'tool-1',
      parentStepId: 'step-run-parent-tool-tool-1'
    }))
  })

  it('disambiguates repeated toolCallId parent step ids within a run', async () => {
    const run = vi.fn(async () => ({ content: 'ok' }))
    const [tool] = createPiAgentTools({
      tools: [workerTool],
      runner: { run },
      context: { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: ['agent.spawn-worker-agent'] }
    })

    await tool!.execute('tool-1', { purpose: 'delegate work' }, new AbortController().signal)
    await tool!.execute('tool-1', { purpose: 'delegate work again' }, new AbortController().signal)

    const firstCall = run.mock.calls[0] as unknown as [unknown, unknown, { parentStepId: string }]
    const secondCall = run.mock.calls[1] as unknown as [unknown, unknown, { parentStepId: string }]

    expect(firstCall[2]).toMatchObject({
      parentStepId: 'step-run-parent-tool-tool-1'
    })
    expect(secondCall[2]).toMatchObject({
      parentStepId: 'step-run-parent-tool-tool-1-2'
    })
  })

  it('keeps repeated toolCallId parent step ids across recreated tools for the same run', async () => {
    const run = vi.fn(async () => ({ content: 'ok' }))
    const toolInput = {
      tools: [workerTool],
      runner: { run },
      context: { runId: 'run-parent', sessionId: 'session-1', allowedToolIds: ['agent.spawn-worker-agent'] }
    }

    const [firstTool] = createPiAgentTools(toolInput)
    await firstTool!.execute('tool-1', { purpose: 'delegate work' }, new AbortController().signal)

    const [secondTool] = createPiAgentTools(toolInput)
    await secondTool!.execute('tool-1', { purpose: 'delegate work again' }, new AbortController().signal)

    const [otherTool] = createPiAgentTools({
      tools: [workerTool],
      runner: { run },
      context: { runId: 'run-other', sessionId: 'session-1', allowedToolIds: ['agent.spawn-worker-agent'] }
    })
    await otherTool!.execute('tool-1', { purpose: 'delegate work elsewhere' }, new AbortController().signal)

    const firstCall = run.mock.calls[0] as unknown as [unknown, unknown, { parentStepId: string }]
    const secondCall = run.mock.calls[1] as unknown as [unknown, unknown, { parentStepId: string }]
    const thirdCall = run.mock.calls[2] as unknown as [unknown, unknown, { parentStepId: string }]

    expect(firstCall[2]).toMatchObject({ parentStepId: 'step-run-parent-tool-tool-1' })
    expect(secondCall[2]).toMatchObject({ parentStepId: 'step-run-parent-tool-tool-1-2' })
    expect(thirdCall[2]).toMatchObject({ parentStepId: 'step-run-other-tool-tool-1' })
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
      details: {
        toolId: 'filesystem.read-file',
        toolCallId: 'tool-call-1',
        toolIcon: '📖',
        result: { code: 'permission_denied' }
      }
    })
  })
})
