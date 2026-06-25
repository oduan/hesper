import { describe, expect, it } from 'vitest'
import type { AgentRun, Message, RunStep } from '@hesper/shared'
import { buildRunContextItem } from '../context-item'

function createRun(input: Partial<AgentRun> & Pick<AgentRun, 'id' | 'sessionId'>): AgentRun {
  return {
    status: 'succeeded',
    modelId: 'mock/hesper-fast',
    retryCount: 0,
    maxRetries: 3,
    ...input
  }
}

function createMessage(input: Partial<Message> & Pick<Message, 'id' | 'role' | 'content' | 'createdAt'>): Message {
  return {
    sessionId: 'session-1',
    contentType: 'plain',
    runId: 'run-1',
    ...input
  }
}

function createStep(input: Partial<RunStep> & Pick<RunStep, 'id' | 'type' | 'status' | 'title' | 'createdAt'>): RunStep {
  return {
    runId: 'run-1',
    ...input
  }
}

describe('buildRunContextItem', () => {
  it('creates deterministic run summary context items with stable metadata', () => {
    const input = {
      run: createRun({ id: 'run-1', sessionId: 'session-1', endedAt: '2026-06-25T04:00:10.000Z' }),
      createdAt: '2026-06-25T04:00:11.000Z',
      messages: [
        createMessage({ id: 'msg-user', role: 'user', content: '请读取文件', createdAt: '2026-06-25T04:00:00.000Z' }),
        createMessage({ id: 'msg-assistant', role: 'assistant', content: '读取完成', createdAt: '2026-06-25T04:00:09.000Z' })
      ],
      steps: [
        createStep({
          id: 'step-read',
          type: 'tool_call',
          status: 'succeeded',
          title: 'Read File',
          detail: '{"path":"README.md","apiKey":"secret-value"}',
          createdAt: '2026-06-25T04:00:03.000Z'
        })
      ]
    }

    const first = buildRunContextItem(input)
    const second = buildRunContextItem(input)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      id: 'context-item-run-1-run-summary-v1',
      sessionId: 'session-1',
      runId: 'run-1',
      kind: 'run_summary',
      version: 1,
      createdAt: '2026-06-25T04:00:11.000Z'
    })
    expect(first?.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first?.tokenEstimate).toBe(Math.ceil((first?.content.length ?? 0) / 4))
    expect(first?.content).toContain('<hesper_run_context run_id="run-1">')
    expect(first?.content).toContain('purpose: previous_run_continuity_not_new_user_request')
    expect(first?.content).toContain('Read File')
    expect(first?.content).toContain('[redacted-sensitive-value]')
    expect(first?.content).not.toContain('secret-value')
    expect(first?.content).not.toContain('sourceHash')
    expect(first?.content).not.toContain('tokenEstimate')
    expect(first?.content).not.toContain('2026-06-25T04:00:11.000Z')
  })

  it('normalizes message and step input order before hashing and rendering', () => {
    const run = createRun({ id: 'run-ordered', sessionId: 'session-1' })
    const createdAt = '2026-06-25T04:00:11.000Z'
    const messages = [
      createMessage({ id: 'msg-user-1', role: 'user', content: 'first', createdAt: '2026-06-25T04:00:00.000Z' }),
      createMessage({ id: 'msg-user-2', role: 'user', content: 'second', createdAt: '2026-06-25T04:00:02.000Z' })
    ]
    const steps = [
      createStep({ id: 'step-a', type: 'tool_call', status: 'succeeded', title: 'A', detail: '{"value":"a"}', createdAt: '2026-06-25T04:00:03.000Z' }),
      createStep({ id: 'step-b', type: 'tool_call', status: 'succeeded', title: 'B', detail: '{"value":"b"}', createdAt: '2026-06-25T04:00:04.000Z' })
    ]

    const ordered = buildRunContextItem({ run, createdAt, messages, steps })
    const shuffled = buildRunContextItem({ run, createdAt, messages: [...messages].reverse(), steps: [...steps].reverse() })

    expect(shuffled).toEqual(ordered)
  })

  it('changes the source hash when source material changes without changing the stable id', () => {
    const base = {
      run: createRun({ id: 'run-1', sessionId: 'session-1' }),
      createdAt: '2026-06-25T04:00:11.000Z',
      messages: [createMessage({ id: 'msg-user', role: 'user', content: 'first', createdAt: '2026-06-25T04:00:00.000Z' })],
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read File', detail: '{"path":"README.md"}', createdAt: '2026-06-25T04:00:03.000Z' })]
    }

    const first = buildRunContextItem(base)
    const changed = buildRunContextItem({
      ...base,
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read File', detail: '{"path":"CHANGELOG.md"}', createdAt: '2026-06-25T04:00:03.000Z' })]
    })

    expect(first?.id).toBe('context-item-run-1-run-summary-v1')
    expect(changed?.id).toBe('context-item-run-1-run-summary-v1')
    expect(first?.sourceHash).not.toBe(changed?.sourceHash)
  })

  it('returns undefined when the run has no useful context content', () => {
    expect(buildRunContextItem({
      run: createRun({ id: 'run-empty', sessionId: 'session-1' }),
      createdAt: '2026-06-25T04:00:11.000Z',
      messages: [],
      steps: []
    })).toBeUndefined()
  })
})
