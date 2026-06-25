import { describe, expect, it } from 'vitest'
import type { AgentRun, Message, RunStep } from '@hesper/shared'
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
    expect(result[2]?.content).toContain('filesystem.read-file')
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
