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

function extractToolActivity(summary: string): Array<Record<string, unknown>> {
  const lines = summary.split('\n')
  const toolActivityIndex = lines.indexOf('tool_activity:')
  if (toolActivityIndex === -1) return []

  const entries: Array<Record<string, unknown>> = []
  for (let index = toolActivityIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || !line.startsWith('{')) break
    entries.push(JSON.parse(line) as Record<string, unknown>)
  }
  return entries
}

describe('buildRunContextItem', () => {
  it('creates deterministic v2 run summary context items with stable metadata', () => {
    const input = {
      run: createRun({ id: 'run-1', sessionId: 'session-1', endedAt: '2026-06-25T04:00:10.000Z' }),
      createdAt: '2026-06-25T04:00:11.000Z',
      messages: [
        createMessage({ id: 'msg-user', role: 'user', content: '请部署新版本', createdAt: '2026-06-25T04:00:00.000Z' }),
        createMessage({ id: 'msg-assistant', role: 'assistant', content: '正在部署', createdAt: '2026-06-25T04:00:09.000Z' })
      ],
      steps: [
        createStep({
          id: 'step-deploy',
          type: 'tool_call',
          status: 'succeeded',
          title: 'Deploy release',
          detail: [
            'Command: deploy --token supersecret --password hunter2 --api-key abc123',
            'Exit code: 0'
          ].join('\n'),
          createdAt: '2026-06-25T04:00:03.000Z'
        })
      ]
    }

    const first = buildRunContextItem(input)
    const second = buildRunContextItem(input)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      id: 'context-item-run-1-run-summary-v2',
      sessionId: 'session-1',
      runId: 'run-1',
      kind: 'run_summary',
      version: 2,
      createdAt: '2026-06-25T04:00:11.000Z'
    })
    expect(first?.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first?.tokenEstimate).toBe(Math.ceil((first?.content.length ?? 0) / 4))
    expect(first?.content).toContain('<hesper_run_context run_id="run-1" version="2">')
    expect(first?.content).toContain('purpose: previous_run_continuity_not_new_user_request')
    expect(extractToolActivity(first?.content ?? '')).toEqual([
      {
        category: 'success',
        command: 'deploy --token [redacted-sensitive-value] --password [redacted-sensitive-value] --api-key [redacted-sensitive-value]',
        exitCode: 0,
        outputSummary: [
          'Command: deploy --token [redacted-sensitive-value] --password [redacted-sensitive-value] --api-key [redacted-sensitive-value]',
          'Exit code: 0'
        ].join('\n'),
        status: 'succeeded',
        title: 'Deploy release'
      }
    ])
    expect(first?.content).not.toContain('supersecret')
    expect(first?.content).not.toContain('hunter2')
    expect(first?.content).not.toContain('abc123')
    expect(first?.content).not.toContain('sourceHash')
    expect(first?.content).not.toContain('tokenEstimate')
    expect(first?.content).not.toContain('step-deploy')
    expect(first?.content).not.toContain('msg-user')
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
      createStep({ id: 'step-a', type: 'tool_call', status: 'succeeded', title: 'A', detail: 'Command: alpha\nExit code: 0', createdAt: '2026-06-25T04:00:03.000Z' }),
      createStep({ id: 'step-b', type: 'tool_call', status: 'succeeded', title: 'B', detail: 'Command: beta\nExit code: 0', createdAt: '2026-06-25T04:00:04.000Z' })
    ]

    const ordered = buildRunContextItem({ run, createdAt, messages, steps })
    const shuffled = buildRunContextItem({ run, createdAt, messages: [...messages].reverse(), steps: [...steps].reverse() })

    expect(shuffled).toEqual(ordered)
  })

  it('keeps content and source hash stable when only legacy step summary or completedAt changes', () => {
    const base = {
      run: createRun({ id: 'run-1', sessionId: 'session-1' }),
      createdAt: '2026-06-25T04:00:11.000Z',
      messages: [createMessage({ id: 'msg-user', role: 'user', content: 'first', createdAt: '2026-06-25T04:00:00.000Z' })],
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read File', detail: 'Command: cat README.md\nExit code: 0', createdAt: '2026-06-25T04:00:03.000Z', summary: 'legacy one', completedAt: '2026-06-25T04:00:04.000Z' })]
    }

    const first = buildRunContextItem(base)
    const changedLegacy = buildRunContextItem({
      ...base,
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read File', detail: 'Command: cat README.md\nExit code: 0', createdAt: '2026-06-25T04:00:03.000Z', summary: 'legacy two', completedAt: '2026-06-25T04:00:09.000Z' })]
    })

    expect(first?.id).toBe('context-item-run-1-run-summary-v2')
    expect(changedLegacy?.id).toBe('context-item-run-1-run-summary-v2')
    expect(first?.content).toBe(changedLegacy?.content)
    expect(first?.sourceHash).toBe(changedLegacy?.sourceHash)
  })

  it('changes the source hash when v2-rendered tool fields change while keeping the v2 stable id', () => {
    const base = {
      run: createRun({ id: 'run-1', sessionId: 'session-1' }),
      createdAt: '2026-06-25T04:00:11.000Z',
      messages: [createMessage({ id: 'msg-user', role: 'user', content: 'first', createdAt: '2026-06-25T04:00:00.000Z' })],
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read File', detail: 'Command: cat README.md\nExit code: 0', createdAt: '2026-06-25T04:00:03.000Z' })]
    }

    const first = buildRunContextItem(base)
    const changedDetail = buildRunContextItem({
      ...base,
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read File', detail: 'Command: cat CHANGELOG.md\nExit code: 0', createdAt: '2026-06-25T04:00:03.000Z' })]
    })
    const changedTitle = buildRunContextItem({
      ...base,
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read Docs', detail: 'Command: cat README.md\nExit code: 0', createdAt: '2026-06-25T04:00:03.000Z' })]
    })
    const changedStatus = buildRunContextItem({
      ...base,
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'failed', title: 'Read File', detail: 'Command: cat README.md\nExit code: 1\n\nstderr:\nboom', createdAt: '2026-06-25T04:00:03.000Z' })]
    })

    expect(first?.id).toBe('context-item-run-1-run-summary-v2')
    expect(changedDetail?.id).toBe('context-item-run-1-run-summary-v2')
    expect(changedTitle?.id).toBe('context-item-run-1-run-summary-v2')
    expect(changedStatus?.id).toBe('context-item-run-1-run-summary-v2')
    expect(first?.sourceHash).not.toBe(changedDetail?.sourceHash)
    expect(first?.sourceHash).not.toBe(changedTitle?.sourceHash)
    expect(first?.sourceHash).not.toBe(changedStatus?.sourceHash)
  })

  it('keeps the source hash stable when only maxChars changes but rendered content stays the same', () => {
    const base = {
      run: createRun({ id: 'run-max-chars', sessionId: 'session-1' }),
      createdAt: '2026-06-25T04:00:11.000Z',
      messages: [createMessage({ id: 'msg-user', role: 'user', content: 'short request', createdAt: '2026-06-25T04:00:00.000Z' })],
      steps: [createStep({ id: 'step-read', type: 'tool_call', status: 'succeeded', title: 'Read File', detail: 'Command: cat README.md\nExit code: 0', createdAt: '2026-06-25T04:00:03.000Z' })]
    }

    const wide = buildRunContextItem({ ...base, maxChars: 1000 })
    const wider = buildRunContextItem({ ...base, maxChars: 2000 })

    expect(wide?.id).toBe('context-item-run-max-chars-run-summary-v2')
    expect(wider?.id).toBe('context-item-run-max-chars-run-summary-v2')
    expect(wide?.content).toBe(wider?.content)
    expect(wide?.sourceHash).toBe(wider?.sourceHash)
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
