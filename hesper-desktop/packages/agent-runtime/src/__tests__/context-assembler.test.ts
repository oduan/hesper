import { describe, expect, it } from 'vitest'
import type { AgentRun, Message, RunContextItem, RunStep } from '@hesper/shared'
import { assembleHistoryMessages } from '../context-assembler'

const baseRun = (id: string, patch: Partial<AgentRun> = {}): AgentRun => ({
  id,
  sessionId: 'session-1',
  status: 'succeeded',
  modelId: 'mock/hesper-fast',
  retryCount: 0,
  maxRetries: 0,
  ...patch
})

const message = (id: string, runId: string, role: Message['role'], content: string, createdAt: string): Message => ({
  id,
  sessionId: 'session-1',
  runId,
  role,
  content,
  contentType: role === 'assistant' ? 'markdown' : 'plain',
  createdAt
})

const step = (runId: string): RunStep => ({
  id: `step-${runId}`,
  runId,
  type: 'tool_call',
  status: 'succeeded',
  title: 'Read File',
  detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', input: { path: 'README.md' }, output: 'hello' }),
  createdAt: '2026-06-25T02:00:02.000Z',
  completedAt: '2026-06-25T02:00:03.000Z'
})

const contextItem = (runId: string, content = `<hesper_run_context run_id="${runId}">\npersisted ${runId}\n</hesper_run_context>`): RunContextItem => ({
  id: `context-item-${runId}-run-summary-v1`,
  sessionId: 'session-1',
  runId,
  kind: 'run_summary',
  version: 1,
  content,
  tokenEstimate: Math.ceil(content.length / 4),
  sourceHash: `hash-${runId}`,
  createdAt: '2026-06-25T02:00:04.000Z'
})

describe('assembleHistoryMessages', () => {
  it('inserts a synthetic context summary after the previous run messages', () => {
    const result = assembleHistoryMessages({
      currentRunId: 'run-2',
      runs: [baseRun('run-1', { startedAt: '2026-06-25T02:00:00.000Z' }), baseRun('run-2', { status: 'running', startedAt: '2026-06-25T02:00:04.000Z' })],
      messages: [
        message('m1', 'run-1', 'user', 'first', '2026-06-25T02:00:00.000Z'),
        message('m2', 'run-1', 'assistant', 'answer', '2026-06-25T02:00:01.000Z'),
        message('m3', 'run-2', 'user', 'second', '2026-06-25T02:00:04.000Z')
      ],
      stepsByRunId: new Map([['run-1', [step('run-1')]]])
    })

    expect(result.map((item) => [item.id, item.role, item.content.includes('<hesper_run_context')])).toEqual([
      ['m1', 'user', false],
      ['m2', 'assistant', false],
      ['context-summary-run-1', 'user', true]
    ])
    expect(result[2]?.content).toContain('previous_run_continuity_not_new_user_request')
    expect(result[2]?.content).toContain('version="2"')
    expect(result[2]?.content).toContain('"category":"success"')
    expect(result[2]?.content).toContain('README.md')
    expect(result[2]?.content).toContain('hello')
    expect(result[2]?.content).not.toContain('filesystem.read-file')
  })

  it('uses persisted run context items before falling back to dynamic step summaries', () => {
    const result = assembleHistoryMessages({
      currentRunId: 'run-3',
      runs: [
        baseRun('run-1', { startedAt: '2026-06-25T02:00:00.000Z' }),
        baseRun('run-2', { startedAt: '2026-06-25T02:00:05.000Z' }),
        baseRun('run-3', { status: 'running', startedAt: '2026-06-25T02:00:09.000Z' })
      ],
      messages: [
        message('m1', 'run-1', 'user', 'first', '2026-06-25T02:00:00.000Z'),
        message('m2', 'run-2', 'user', 'second', '2026-06-25T02:00:05.000Z')
      ],
      contextItemsByRunId: new Map([['run-1', [contextItem('run-1', '<hesper_run_context run_id="run-1">\npersisted context\n</hesper_run_context>')]]]),
      stepsByRunId: new Map([
        ['run-1', [{ ...step('run-1'), detail: JSON.stringify({ output: 'dynamic should not appear' }) }]],
        ['run-2', [step('run-2')]]
      ])
    })

    const summaries = result.filter((item) => item.id.startsWith('context-summary-'))
    expect(summaries.map((item) => item.id)).toEqual(['context-summary-run-1', 'context-summary-run-2'])
    expect(summaries[0]?.content).toContain('persisted context')
    expect(summaries[0]?.content).not.toContain('dynamic should not appear')
    expect(summaries[1]?.content).toContain('version="2"')
    expect(summaries[1]?.content).toContain('"category":"success"')
    expect(summaries[1]?.content).toContain('README.md')
    expect(summaries[1]?.content).toContain('hello')
    expect(summaries[1]?.content).not.toContain('filesystem.read-file')
  })

  it('chooses the highest-version newest persisted run summary deterministically', () => {
    const olderV2 = {
      ...contextItem('run-1', '<hesper_run_context run_id="run-1">\nolder v2\n</hesper_run_context>'),
      id: 'context-item-run-1-run-summary-v2-a',
      version: 2,
      createdAt: '2026-06-25T02:00:02.000Z'
    }
    const newerV2 = {
      ...contextItem('run-1', '<hesper_run_context run_id="run-1">\nnewer v2\n</hesper_run_context>'),
      id: 'context-item-run-1-run-summary-v2-b',
      version: 2,
      createdAt: '2026-06-25T02:00:03.000Z'
    }
    const latestVersionWins = {
      ...contextItem('run-1', '<hesper_run_context run_id="run-1">\nv3\n</hesper_run_context>'),
      id: 'context-item-run-1-run-summary-v3',
      version: 3,
      createdAt: '2026-06-25T02:00:01.000Z'
    }

    const result = assembleHistoryMessages({
      currentRunId: 'run-2',
      runs: [baseRun('run-1', { startedAt: '2026-06-25T02:00:00.000Z' }), baseRun('run-2', { status: 'running' })],
      messages: [message('m1', 'run-1', 'user', 'first', '2026-06-25T02:00:00.000Z')],
      stepsByRunId: new Map(),
      contextItemsByRunId: new Map([['run-1', [olderV2, newerV2, latestVersionWins]]])
    })

    expect(result.find((item) => item.id === 'context-summary-run-1')?.content).toContain('v3')
    expect(result.find((item) => item.id === 'context-summary-run-1')?.content).not.toContain('newer v2')
  })

  it('chooses the newest same-version persisted run summary deterministically', () => {
    const older = {
      ...contextItem('run-1', '<hesper_run_context run_id="run-1">\nolder\n</hesper_run_context>'),
      id: 'context-item-run-1-run-summary-v1-a',
      createdAt: '2026-06-25T02:00:02.000Z'
    }
    const newer = {
      ...contextItem('run-1', '<hesper_run_context run_id="run-1">\nnewer\n</hesper_run_context>'),
      id: 'context-item-run-1-run-summary-v1-b',
      createdAt: '2026-06-25T02:00:03.000Z'
    }

    const result = assembleHistoryMessages({
      currentRunId: 'run-2',
      runs: [baseRun('run-1', { startedAt: '2026-06-25T02:00:00.000Z' }), baseRun('run-2', { status: 'running' })],
      messages: [message('m1', 'run-1', 'user', 'first', '2026-06-25T02:00:00.000Z')],
      stepsByRunId: new Map(),
      contextItemsByRunId: new Map([['run-1', [older, newer]]])
    })

    expect(result.find((item) => item.id === 'context-summary-run-1')?.content).toContain('newer')
    expect(result.find((item) => item.id === 'context-summary-run-1')?.content).not.toContain('older')
  })

  it('uses a stable anchor plus recent context budget instead of pure sliding-window trimming', () => {
    const runs = [
      baseRun('run-1', { startedAt: '2026-06-25T02:00:00.000Z' }),
      baseRun('run-2', { startedAt: '2026-06-25T02:00:02.000Z' }),
      baseRun('run-3', { startedAt: '2026-06-25T02:00:04.000Z' }),
      baseRun('run-4', { startedAt: '2026-06-25T02:00:06.000Z' }),
      baseRun('run-5', { status: 'running', startedAt: '2026-06-25T02:00:08.000Z' })
    ]
    const items = ['run-1', 'run-2', 'run-3', 'run-4'].map((runId) => contextItem(runId, `<hesper_run_context run_id="${runId}">\n${runId}\n</hesper_run_context>`))
    const result = assembleHistoryMessages({
      currentRunId: 'run-5',
      runs,
      messages: [
        message('m1', 'run-1', 'user', 'one', '2026-06-25T02:00:00.000Z'),
        message('m2', 'run-2', 'user', 'two', '2026-06-25T02:00:02.000Z'),
        message('m3', 'run-3', 'user', 'three', '2026-06-25T02:00:04.000Z'),
        message('m4', 'run-4', 'user', 'four', '2026-06-25T02:00:06.000Z')
      ],
      stepsByRunId: new Map(),
      contextItemsByRunId: new Map(items.map((item) => [item.runId, [item]])),
      anchorRunCount: 1,
      recentRunCount: 1,
      maxContextItemChars: items[0]!.content.length + items[3]!.content.length
    })

    expect(result.filter((item) => item.id.startsWith('context-summary-')).map((item) => item.id)).toEqual([
      'context-summary-run-1',
      'context-summary-run-4'
    ])
    expect(result.map((item) => item.id)).toEqual([
      'm1',
      'context-summary-run-1',
      'm2',
      'm3',
      'm4',
      'context-summary-run-4'
    ])
  })

  it('excludes current run messages to avoid duplicating the active prompt', () => {
    const result = assembleHistoryMessages({
      currentRunId: 'run-2',
      runs: [baseRun('run-1'), baseRun('run-2', { status: 'running' })],
      messages: [message('m-current', 'run-2', 'user', 'current prompt', '2026-06-25T02:00:04.000Z')],
      stepsByRunId: new Map()
    })

    expect(result).toEqual([])
  })

  it('does not include child run summaries in the parent session transcript', () => {
    const result = assembleHistoryMessages({
      currentRunId: 'run-2',
      runs: [baseRun('run-1'), baseRun('child-1', { parentRunId: 'run-1' }), baseRun('run-2')],
      messages: [message('m1', 'run-1', 'user', 'parent', '2026-06-25T02:00:00.000Z')],
      stepsByRunId: new Map([['child-1', [step('child-1')]]])
    })

    expect(result.map((item) => item.id)).toEqual(['m1'])
  })

  it('keeps prefix stable when a later run is appended', () => {
    const previous = assembleHistoryMessages({
      currentRunId: 'run-2',
      runs: [baseRun('run-1', { startedAt: '2026-06-25T02:00:00.000Z' }), baseRun('run-2', { startedAt: '2026-06-25T02:00:05.000Z' })],
      messages: [message('m1', 'run-1', 'user', 'first', '2026-06-25T02:00:00.000Z')],
      stepsByRunId: new Map([['run-1', [step('run-1')]]])
    })
    const later = assembleHistoryMessages({
      currentRunId: 'run-3',
      runs: [baseRun('run-1', { startedAt: '2026-06-25T02:00:00.000Z' }), baseRun('run-2', { startedAt: '2026-06-25T02:00:05.000Z' }), baseRun('run-3', { startedAt: '2026-06-25T02:00:09.000Z' })],
      messages: [
        message('m1', 'run-1', 'user', 'first', '2026-06-25T02:00:00.000Z'),
        message('m2', 'run-2', 'user', 'second', '2026-06-25T02:00:05.000Z')
      ],
      stepsByRunId: new Map([['run-1', [step('run-1')]]])
    })

    expect(later.slice(0, previous.length).map((item) => item.content)).toEqual(previous.map((item) => item.content))
  })
})
