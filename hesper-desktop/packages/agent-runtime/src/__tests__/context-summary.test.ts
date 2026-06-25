import type { Message, RunStep } from '@hesper/shared'
import { describe, expect, it } from 'vitest'
import { buildRunContextSummary } from '../context-summary'

const run = { id: 'run-ctx-1' }

function createMessage(input: { id: string, role: Message['role'], content: string, createdAt: string }): Message {
  return {
    id: input.id,
    sessionId: 'session-1',
    role: input.role,
    content: input.content,
    contentType: 'plain',
    runId: run.id,
    createdAt: input.createdAt
  }
}

function createStep(input: {
  id: string
  type: RunStep['type']
  status: RunStep['status']
  title: string
  createdAt: string
  summary?: string
  detail?: string
}): RunStep {
  return {
    id: input.id,
    runId: run.id,
    type: input.type,
    status: input.status,
    title: input.title,
    createdAt: input.createdAt,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {})
  }
}

describe('buildRunContextSummary', () => {
  it('returns undefined when there is no meaningful context', () => {
    expect(buildRunContextSummary({ run, messages: [], steps: [], maxChars: 500 })).toBeUndefined()
  })

  it('builds a stable bounded summary with redaction and sorted tool JSON', () => {
    const summary = buildRunContextSummary({
      run,
      maxChars: 4000,
      messages: [
        createMessage({
          id: 'msg-latest-assistant',
          role: 'assistant',
          content: '最新结果：已经完成整理，输出包含 github_pat_zzzzzzzzzzzzzzzzzzzz 和 xoxb-1234567890-abcdefghi',
          createdAt: '2026-06-25T03:03:00.000Z'
        }),
        createMessage({
          id: 'msg-old-user',
          role: 'user',
          content: '旧请求：请忽略这些内容',
          createdAt: '2026-06-25T03:01:00.000Z'
        }),
        createMessage({
          id: 'msg-latest-user',
          role: 'user',
          content: [
            '最新请求：请整理以下敏感值',
            'Bearer abcdefghijklmnop',
            'eyJabcdefghij.klmnopqrst.uvwxyzABCDE',
            'github_pat_1234567890abcdefghijkl',
            'xoxb-1234567890-abcdefghi',
            'npm_1234567890abcdef1234',
            'hf_1234567890abcdef1234',
            'AKIAABCDEFGHIJKLMNOP',
            'AIza1234567890abcdef123456',
            'sk-live-12345678',
            'pk-test-12345678',
            'rk-prod-12345678',
            'api-key: supersecretvalue',
            'secret=topsecretvalue',
            'token: tokensecretvalue',
            'password=password123'
          ].join(' | '),
          createdAt: '2026-06-25T03:02:00.000Z'
        }),
        createMessage({
          id: 'msg-old-assistant',
          role: 'assistant',
          content: '旧结果：Bearer old-secret-token',
          createdAt: '2026-06-25T03:00:00.000Z'
        })
      ],
      steps: [
        createStep({
          id: 'step-tool-result',
          type: 'tool_result',
          status: 'succeeded',
          title: 'Write file',
          summary: 'npm_1234567890abcdef1234',
          detail: 'api key: supersecretvalue',
          createdAt: '2026-06-25T03:04:00.000Z'
        }),
        createStep({
          id: 'step-tool-call',
          type: 'tool_call',
          status: 'running',
          title: 'Search repo',
          summary: 'Bearer tool-summary-secret',
          detail: 'password = tool-password-value',
          createdAt: '2026-06-25T03:01:30.000Z'
        })
      ]
    })

    expect(summary).toBeDefined()
    expect(summary).toMatch(/^<hesper_run_context run_id="run-ctx-1">/)
    expect(summary).toContain('latest_user_request:')
    expect(summary).toContain('最新请求：请整理以下敏感值')
    expect(summary).toContain('latest_assistant_result:')
    expect(summary).toContain('最新结果：已经完成整理，输出包含 [redacted-sensitive-value] 和 [redacted-sensitive-value]')
    expect(summary).toContain('tool_activity:')
    expect(summary).toContain('{"detail":"[redacted-sensitive-value]","status":"running","summary":"[redacted-sensitive-value]","title":"Search repo","type":"tool_call"}')
    expect(summary).toContain('{"detail":"[redacted-sensitive-value]","status":"succeeded","summary":"[redacted-sensitive-value]","title":"Write file","type":"tool_result"}')
    expect(summary).toContain('[redacted-sensitive-value]')
    expect(summary).toContain('Search repo')
    expect(summary).toContain('Write file')
    expect(summary).not.toContain('旧请求')
    expect(summary).not.toContain('旧结果')
    expect(summary).not.toContain('msg-old-assistant')
    expect(summary).not.toContain('msg-old-user')
    expect(summary).not.toContain('msg-latest-user')
    expect(summary).not.toContain('msg-latest-assistant')
    expect(summary).not.toContain('step-tool-result')
    expect(summary).not.toContain('step-tool-call')
    expect(summary).not.toContain('2026-06-25')
    expect(summary).not.toContain('11:48')
    expect((summary?.indexOf('"title":"Search repo"') ?? -1)).toBeLessThan(summary?.indexOf('"title":"Write file"') ?? -1)
    for (const token of ['Bearer abcdefghijklmnop', 'eyJabcdefghij.klmnopqrst.uvwxyzABCDE', 'github_pat_1234567890abcdefghijkl', 'xoxb-1234567890-abcdefghi', 'npm_1234567890abcdef1234', 'hf_1234567890abcdef1234', 'AKIAABCDEFGHIJKLMNOP', 'AIza1234567890abcdef123456', 'sk-live-12345678', 'pk-test-12345678', 'rk-prod-12345678', 'api-key: supersecretvalue', 'secret=topsecretvalue', 'token: tokensecretvalue', 'password=password123']) {
      expect(summary).not.toContain(token)
    }
    expect(summary?.endsWith('</hesper_run_context>')).toBe(true)
  })

  it('serializes structured tool details with stable key order and redaction', () => {
    const summary = buildRunContextSummary({
      run: { id: 'run-ctx-3' },
      maxChars: 4000,
      messages: [
        createMessage({
          id: 'msg-json-user',
          role: 'user',
          content: '请检查工具详情',
          createdAt: '2026-06-25T05:00:00.000Z'
        })
      ],
      steps: [
        createStep({
          id: 'step-json',
          type: 'tool_call',
          status: 'succeeded',
          title: 'Inspect detail',
          detail: '{"z":3,"apiKey":"should-not-leak","a":{"d":4,"b":2}}',
          createdAt: '2026-06-25T05:01:00.000Z'
        })
      ]
    })

    expect(summary).toContain('tool_activity:')
    expect(summary).toContain('{"detail":{"a":{"b":2,"d":4},"apiKey":"[redacted-sensitive-value]","z":3},"status":"succeeded","title":"Inspect detail","type":"tool_call"}')
    expect(summary).not.toContain('should-not-leak')
  })

  it('truncates deterministically and keeps the wrapper stable', () => {
    const longText = '长'.repeat(2000)
    const input = {
      run: { id: 'run-ctx-2' },
      maxChars: 260,
      messages: [
        createMessage({
          id: 'msg-long-user',
          role: 'user',
          content: longText,
          createdAt: '2026-06-25T04:00:00.000Z'
        }),
        createMessage({
          id: 'msg-long-assistant',
          role: 'assistant',
          content: longText,
          createdAt: '2026-06-25T04:01:00.000Z'
        })
      ],
      steps: [
        createStep({
          id: 'step-long',
          type: 'tool_call',
          status: 'running',
          title: 'Do something',
          summary: longText,
          detail: longText,
          createdAt: '2026-06-25T04:02:00.000Z'
        })
      ]
    }

    const first = buildRunContextSummary(input)
    const second = buildRunContextSummary(input)

    expect(first).toBe(second)
    expect(first).toMatch(/^<hesper_run_context run_id="run-ctx-2">/)
    expect(first).toMatch(/\[truncated \d+ chars\]/)
    expect(first).toMatch(/<\/hesper_run_context>$/)
    expect(first?.length ?? 0).toBeLessThanOrEqual(260)
    expect(first).not.toContain('msg-long-user')
    expect(first).not.toContain('msg-long-assistant')
    expect(first).not.toContain('step-long')
    expect(first).not.toContain('2026-06-25')
  })
})
